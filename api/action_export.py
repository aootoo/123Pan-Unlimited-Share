import json
import time
from flask import Response, stream_with_context, current_app 
from Pan123 import Pan123
from utils import getStringHash, loadSettings
from api.api_utils import custom_secure_filename_part, handle_database_storage 

DEBUG = loadSettings("DEBUG")

def handle_export_request(data):
    username = data.get('username')
    password = data.get('password')
    home_file_path_str = data.get('homeFilePath', '0')
    user_specified_base_name_raw = data.get('userSpecifiedBaseName', '').strip()
    generate_short_code_flag = data.get('generateShortCode', False)
    share_project_flag = data.get('shareProject', False)

    # --- 参数校验 ---
    if not username or not password:
        return Response(json.dumps({"isFinish": False, "message": "用户名和密码不能为空。"}), 
                        mimetype='application/x-ndjson', status=400)
    if not home_file_path_str: # 允许为空字符串，Pan123内部可能处理为"0"
         pass # parent_file_id_internal 会处理
            
    if share_project_flag and not user_specified_base_name_raw:
        return Response(json.dumps({"isFinish": False, "message": "加入资源共享计划时，必须填写根目录名 (分享名)。"}),
                        mimetype='application/x-ndjson', status=400)
    
    if share_project_flag: # 如果勾选加入计划，则强制生成短码
        generate_short_code_flag = True

    try:
        # 尝试将 home_file_path_str 转换为整数，如果失败，则按原样使用 (Pan123.py 可能会处理)
        parent_file_id_internal = int(home_file_path_str)
    except ValueError:
        parent_file_id_internal = home_file_path_str  

    cleaned_db_root_name = custom_secure_filename_part(user_specified_base_name_raw)
    if generate_short_code_flag and not cleaned_db_root_name: # 如果要生成短码但名称为空
        cleaned_db_root_name = f"导出的分享_{int(time.time())}" # API层面生成默认名

    def generate_export_stream():
        driver = Pan123(debug=DEBUG)
        login_success_flag = False
        final_b64_string_data = None
        short_share_code_result = None # 用于存储最终的短分享码
        pan123_op_successful = False

        try:
            yield f"{json.dumps({'isFinish': None, 'message': '准备登录...'})}\n"
            login_success_flag = driver.doLogin(username=username, password=password)
            if not login_success_flag:
                yield f"{json.dumps({'isFinish': False, 'message': '登录失败，请检查用户名和密码。'})}\n"
                return

            yield f"{json.dumps({'isFinish': None, 'message': '登录成功，开始导出文件列表...'})}\n"
            
            for state in driver.exportFiles(parentFileId=parent_file_id_internal):
                if state.get("isFinish") is True:
                    final_b64_string_data = state["message"]
                    pan123_op_successful = True
                    yield f"{json.dumps({'isFinish': None, 'message': '文件列表从123网盘导出成功。'})}\n"
                    break 
                elif state.get("isFinish") is False: # Pan123.py内部的错误
                    yield f"{json.dumps(state)}\n" 
                    # 考虑到后续可能还有注销操作，这里不直接return，让finally处理注销
                    # 但导出已失败，所以之后不再进行数据库操作
                    pan123_op_successful = False # 标记操作失败
                    break # 跳出循环
                else: # isFinish: None (进度信息)
                    yield f"{json.dumps(state)}\n"
            
            if not pan123_op_successful or final_b64_string_data is None:
                # 如果上面因为 isFinish: False 而 break，这里会执行
                if not final_b64_string_data: # 确保消息一致性
                     yield f"{json.dumps({'isFinish': False, 'message': '未能从123网盘获取文件数据。'})}\n"
                # 已经发送过失败消息了，所以这里可能不需要额外发送，除非是状态未明确的情况  
                # （如果 pan123_op_successful 为 false 但没有从循环中yield过 False 消息，则此处补充）
                # 此处保持原样，因循环内的 isFinish:False 已发送消息
                pass # 确保不覆盖已发送的明确错误

            if pan123_op_successful and generate_short_code_flag: # 只有在网盘导出成功后才尝试存数据库
                yield f"{json.dumps({'isFinish': None, 'message': '正在处理数据库存储与短分享码...'})}\n"
                code_hash = getStringHash(final_b64_string_data)
                
                # 调用 handle_database_storage
                db_op_success, db_result_hash, db_log_msgs = handle_database_storage(
                    code_hash, 
                    cleaned_db_root_name, 
                    None, # visible_flag 由 handle_database_storage 根据 share_project_flag 决定
                    final_b64_string_data, 
                    share_project_flag
                )

                for msg in db_log_msgs: # 输出数据库操作日志
                    yield f"{json.dumps({'isFinish': None, 'message': msg})}\n"
                
                if db_op_success and db_result_hash:
                    short_share_code_result = db_result_hash # 保存短码以备最终返回
                    yield f"{json.dumps({'isFinish': None, 'message': f'短分享码处理完成。短码为: {short_share_code_result}'})}\n"
                else:
                    # 即使数据库操作不完全成功（如记录已存在），只要长码获取成功，操作仍可继续
                    # 但短码可能未生成或未更新
                    yield f"{json.dumps({'isFinish': None, 'message': '数据库操作未生成新的短分享码或按现有策略处理。长分享码仍然有效。'})}\n"
            
            # 准备最终的成功响应
            if pan123_op_successful: # 只有当从123网盘导出成功时，才认为整体操作有机会成功
                response_payload_dict = {'longShareCode': final_b64_string_data}
                if short_share_code_result: # 仅当成功获得短分享码时才加入
                    response_payload_dict['shortShareCode'] = short_share_code_result
                
                final_success_message_json_str = json.dumps(response_payload_dict)
                yield f"{json.dumps({'isFinish': True, 'message': final_success_message_json_str})}\n"
            # else 部分已在上面循环内或循环后处理了 isFinish:False 的情况

        except Exception as e:
            current_app.logger.error(f"API Export error in stream: {e}", exc_info=True)
            yield f"{json.dumps({'isFinish': False, 'message': f'导出过程中服务器发生意外错误: {str(e)}'})}\n"
        finally:
            if login_success_flag: # 确保注销
                try:
                    driver.doLogout()
                    yield f"{json.dumps({'isFinish': None, 'message': '已注销账号。'})}\n"
                except Exception as final_logout_err:
                    current_app.logger.error(f"Error during final logout for api_export: {final_logout_err}", exc_info=True)
                    # 不再向客户端发送此内部错误，避免覆盖主要错误信息
            current_app.logger.info("Export stream finished.")

    return Response(stream_with_context(generate_export_stream()), mimetype='application/x-ndjson')