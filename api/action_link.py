import json
import time
import re
from flask import Response, stream_with_context, current_app 
from Pan123 import Pan123
from utils import getStringHash, loadSettings
from api.api_utils import custom_secure_filename_part, handle_database_storage

DEBUG = loadSettings("DEBUG")

def handle_link_request(data):
    parent_file_id_str = data.get('parentFileId', '0') # 默认为 '0' 如果未提供
    share_key = data.get('shareKey')
    share_pwd = data.get('sharePwd', '') 
    user_specified_base_name_raw = data.get('userSpecifiedBaseName', '').strip()
    generate_short_code_flag = data.get('generateShortCode', False) 
    share_project_flag = data.get('shareProject', False)

    # --- 参数校验 ---
    if not share_key:
        return Response(json.dumps({"isFinish": False, "message": "分享链接 Key 不能为空。"}),
                        mimetype='application/x-ndjson', status=400)
    # parentFileId 允许为空字符串或'0'，Pan123.py内部处理
    
    if share_project_flag and not user_specified_base_name_raw:
        return Response(json.dumps({"isFinish": False, "message": "加入资源共享计划时，必须填写根目录名 (分享名)。"}),
                        mimetype='application/x-ndjson', status=400)
    
    if share_project_flag: # 强制生成短码
        generate_short_code_flag = True
        
    try:
        parent_file_id_internal = int(parent_file_id_str)
    except ValueError:
        parent_file_id_internal = parent_file_id_str 

    cleaned_db_root_name = custom_secure_filename_part(user_specified_base_name_raw)
    if generate_short_code_flag and not cleaned_db_root_name:
        # 为链接分享生成一个更具描述性的默认名
        safe_share_key = re.sub(r'[^a-zA-Z0-9_-]', '_', share_key) # 清理 shareKey 用于文件名
        cleaned_db_root_name = f"链接分享_{safe_share_key[:20]}_{int(time.time())}"

    def generate_link_export_stream():
        driver = Pan123(debug=DEBUG) 
        final_b64_string_data = None
        short_share_code_result = None
        pan123_op_successful = False

        try:
            yield f"{json.dumps({'isFinish': None, 'message': '开始从分享链接导出文件列表...'})}\n"
            
            for state in driver.exportShare(
                parentFileId=parent_file_id_internal, 
                shareKey=share_key, 
                sharePwd=share_pwd
            ):
                if state.get("isFinish") is True:
                    final_b64_string_data = state["message"]
                    pan123_op_successful = True
                    yield f"{json.dumps({'isFinish': None, 'message': '文件列表从分享链接导出成功。'})}\n"
                    break 
                elif state.get("isFinish") is False:
                    yield f"{json.dumps(state)}\n"
                    pan123_op_successful = False # 标记失败
                    break # 提前退出循环
                else: 
                    yield f"{json.dumps(state)}\n"

            if not pan123_op_successful or final_b64_string_data is None:
                if not final_b64_string_data and pan123_op_successful is not False: # 避免重复发送False消息
                     yield f"{json.dumps({'isFinish': False, 'message': '未能从分享链接获取文件数据。'})}\n"
                pass # 错误消息已由循环内部的 isFinish:False 处理

            if pan123_op_successful and generate_short_code_flag:
                yield f"{json.dumps({'isFinish': None, 'message': '正在处理数据库存储与短分享码...'})}\n"
                code_hash = getStringHash(final_b64_string_data)
                
                db_op_success, db_result_hash, db_log_msgs = handle_database_storage(
                    code_hash, 
                    cleaned_db_root_name, 
                    None, 
                    final_b64_string_data, 
                    share_project_flag
                )
                for msg in db_log_msgs:
                    yield f"{json.dumps({'isFinish': None, 'message': msg})}\n"

                if db_op_success and db_result_hash:
                    short_share_code_result = db_result_hash
                    yield f"{json.dumps({'isFinish': None, 'message': f'短分享码处理完成。短码为: {short_share_code_result}'})}\n"
                else:
                    yield f"{json.dumps({'isFinish': None, 'message': '数据库操作未生成新的短分享码或按现有策略处理。长分享码仍然有效。'})}\n"

            
            if pan123_op_successful: # 只有当从分享链接解析成功时
                response_payload_dict = {'longShareCode': final_b64_string_data}
                if short_share_code_result: # 如果成功生成了短码
                    response_payload_dict['shortShareCode'] = short_share_code_result
                
                final_success_message_json_str = json.dumps(response_payload_dict)
                yield f"{json.dumps({'isFinish': True, 'message': final_success_message_json_str})}\n"
            # else 情况已由循环或其后的检查处理
            
        except Exception as e:
            current_app.logger.error(f"API Link Export error in stream: {e}", exc_info=True)
            yield f"{json.dumps({'isFinish': False, 'message': f'从分享链接导出过程中服务器发生意外错误: {str(e)}'})}\n"
        finally:
            current_app.logger.info("Link export stream finished.")

    return Response(stream_with_context(generate_link_export_stream()), mimetype='application/x-ndjson')