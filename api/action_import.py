import json
import time
from flask import Response, stream_with_context, current_app 
from Pan123 import Pan123
from Pan123Database import Pan123Database # 用于读取
from utils import getStringHash, loadSettings
from api.api_utils import custom_secure_filename_part, handle_database_storage # 用于写入

DEBUG = loadSettings("DEBUG")
DATABASE_PATH = loadSettings("DATABASE_PATH")

def handle_import_request(data):
    username = data.get('username')
    password = data.get('password')
    
    code_hash_param = data.get('codeHash', None) 
    base64_data_param = data.get('base64Data', None) 
    root_folder_name_param = data.get('rootFolderName', None) 
    share_project_for_long_code = data.get('shareProject', False) # 如果用长码导入，是否加入共享

    # --- 参数校验 ---
    if not username or not password:
        return Response(json.dumps({"isFinish": False, "message": "用户名和密码不能为空。"}),
                        mimetype='application/x-ndjson', status=400)

    # 校验导入类型参数
    is_short_code_import = bool(code_hash_param)
    is_long_code_import = bool(base64_data_param and root_folder_name_param)

    if not is_short_code_import and not is_long_code_import:
        return Response(json.dumps({"isFinish": False, "message": "导入参数不足：需要提供短分享码，或长分享码及根目录名。"}),
                        mimetype='application/x-ndjson', status=400)
    
    if is_short_code_import and is_long_code_import: # 不能同时提供
        return Response(json.dumps({"isFinish": False, "message": "导入参数冲突：短分享码与其他导入参数不能同时提供。"}),
                        mimetype='application/x-ndjson', status=400)

    cleaned_db_root_name_for_long_code = ""
    if is_long_code_import:
        cleaned_db_root_name_for_long_code = custom_secure_filename_part(root_folder_name_param)
        if share_project_for_long_code and not cleaned_db_root_name_for_long_code:
             return Response(json.dumps({"isFinish": False, "message": "使用长分享码加入资源共享计划时，必须填写有效的根目录名。"}),
                             mimetype='application/x-ndjson', status=400)
        elif not cleaned_db_root_name_for_long_code: # 即使不共享，如果清理后为空，也给个默认名
            cleaned_db_root_name_for_long_code = f"导入的分享_{int(time.time())}"

    def generate_import_stream():
        driver = Pan123(debug=DEBUG)
        db_for_read_only = None # 用于通过短码获取数据的DB实例
        login_success_flag = False
        
        actual_base64_data_to_import = None
        actual_root_folder_name_to_import = None

        try:
            yield f"{json.dumps({'isFinish': None, 'message': '准备登录到123网盘...'})}\n"
            login_success_flag = driver.doLogin(username=username, password=password)
            if not login_success_flag:
                yield f"{json.dumps({'isFinish': False, 'message': '登录123网盘失败，请检查用户名和密码。'})}\n"
                return
            yield f"{json.dumps({'isFinish': None, 'message': '登录成功，准备导入数据...'})}\n"

            if is_short_code_import: 
                yield f"{json.dumps({'isFinish': None, 'message': f'正在通过短分享码 {code_hash_param[:8]}... 从数据库获取数据...'})}\n"
                db_for_read_only = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
                share_data_list = db_for_read_only.getDataByHash(code_hash_param) 
                if not share_data_list or len(share_data_list) == 0:
                    yield f"{json.dumps({'isFinish': False, 'message': '短分享码无效或未在数据库中找到。'})}\n"
                    return # 后续不再执行
                
                # 解包 (rootFolderName, shareCode, visibleFlag)
                actual_root_folder_name_to_import, actual_base64_data_to_import, _ = share_data_list[0]
                yield f"{json.dumps({'isFinish': None, 'message': f'从数据库获取数据成功，将导入为：{actual_root_folder_name_to_import}'})}\n"
            
            elif is_long_code_import: 
                actual_base64_data_to_import = base64_data_param
                actual_root_folder_name_to_import = cleaned_db_root_name_for_long_code
                yield f"{json.dumps({'isFinish': None, 'message': f'准备使用长分享码导入，根目录名：{actual_root_folder_name_to_import}'})}\n"

                if share_project_for_long_code: 
                    yield f"{json.dumps({'isFinish': None, 'message': '已勾选加入资源共享计划，正在将此长分享码存入数据库...'})}\n"
                    new_code_hash = getStringHash(actual_base64_data_to_import)
                    
                    db_op_success, db_result_hash, db_log_msgs = handle_database_storage(
                        new_code_hash, 
                        actual_root_folder_name_to_import, 
                        None, # visible_flag由handle_database_storage决定
                        actual_base64_data_to_import, 
                        True # is_share_project_request is True
                    )
                    for msg in db_log_msgs:
                        yield f"{json.dumps({'isFinish': None, 'message': msg})}\n"
                    
                    if db_op_success and db_result_hash:
                        yield f"{json.dumps({'isFinish': None, 'message': f'此长分享码已存入数据库，对应短码为: {db_result_hash}'})}\n"
                    else:
                        yield f"{json.dumps({'isFinish': None, 'message': '将此长分享码存入数据库失败或记录已按策略处理。导入仍将继续，但可能不会生成新的短码或更新状态。'})}\n"
            
            # --- 开始执行123网盘的导入操作 ---
            if not actual_base64_data_to_import or not actual_root_folder_name_to_import:
                # 此情况理论上不应发生，因为前面已经校验或获取了数据
                yield f"{json.dumps({'isFinish': False, 'message': '内部错误：未能准备好导入所需的数据。'})}\n"
                return

            pan123_import_op_successful = False
            final_pan123_message = "123网盘导入操作未正常完成。"

            for state in driver.importFiles(base64Data=actual_base64_data_to_import, rootFolderName=actual_root_folder_name_to_import):
                if state.get("isFinish") is True:
                    pan123_import_op_successful = True
                    final_pan123_message = state["message"] # 成功消息
                    yield f"{json.dumps({'isFinish': None, 'message': final_pan123_message})}\n" 
                    break 
                elif state.get("isFinish") is False: # Pan123.py 内部错误
                    final_pan123_message = state["message"] # 失败消息
                    yield f"{json.dumps(state)}\n" 
                    pan123_import_op_successful = False
                    break # 跳出循环
                else: # isFinish: None (进度信息)
                    yield f"{json.dumps(state)}\n"

            if not pan123_import_op_successful: # 如果123网盘导入失败
                yield f"{json.dumps({'isFinish': False, 'message': final_pan123_message})}\n" 
                # 后续不再执行注销和最终成功消息
                return

            yield f"{json.dumps({'isFinish': True, 'message': final_pan123_message})}\n" 

        except Exception as e:
            current_app.logger.error(f"API Import error in stream: {e}", exc_info=True)
            yield f"{json.dumps({'isFinish': False, 'message': f'导入过程中服务器发生意外错误: {str(e)}'})}\n"
        finally:
            if db_for_read_only: # 关闭用于读取的数据库实例
                db_for_read_only.close()
            
            if login_success_flag: # 注销123网盘
                try:
                    driver.doLogout()
                    yield f"{json.dumps({'isFinish': None, 'message': '已注销123网盘账号。'})}\n"
                except Exception as final_logout_err:
                    current_app.logger.error(f"Error during final logout for api_import: {final_logout_err}", exc_info=True)
            current_app.logger.info("Import stream finished.")
                
    return Response(stream_with_context(generate_import_stream()), mimetype='application/x-ndjson')