import os
import time
import json
from flask import Flask, render_template, request, Response, stream_with_context, jsonify, make_response
import re
import unicodedata

from Pan123 import Pan123
from telegram_spider import startSpider
from utils import isAvailableRegion, getStringHash
from database import Pan123Database

DEBUG = False

app = Flask(__name__)
app.secret_key = '114514' # 密钥

def custom_secure_filename_part(name_str):
    """
    清理用户输入的文件名部分，移除路径相关和常见非法字符，但保留中文、字母、数字等。
    用于数据库中存储的 rootFolderName。
    """
    if not name_str:
        return ""
    
    name_str = unicodedata.normalize('NFC', name_str)
    name_str = "".join(c for c in name_str if unicodedata.category(c)[0] != "C")
    name_str = re.sub(r'[\\/:*?"<>|]', '_', name_str)
    name_str = name_str.strip(' .')
    if re.fullmatch(r'\.+', name_str): # 纯粹由点号组成的名字
        return "_" 
    if not name_str: # 清理后为空
        return "untitled_share" # 提供一个默认名
    return name_str

@app.route('/')
def index():
    return render_template('index.html')

# --- API Endpoints ---

def _handle_database_storage(db_instance, code_hash, root_folder_name_cleaned, visible_flag, share_code_b64, is_share_project_request):
    """
    处理数据存储到数据库的通用逻辑，包括覆写。
    返回短分享码 (如果成功) 或 None (如果失败)。
    visible_flag:
        None: 共享计划 - 待审核
        True: 共享计划 - 已通过 (通常由管理员设置，API层面用户提交时是None)
        False: 私密短码
    is_share_project_request: 布尔值，指示当前请求是否明确要求加入共享计划。
    """
    existing_entry = db_instance.queryHash(code_hash)
    operation_successful = False
    message_log = []

    if existing_entry:
        message_log.append(f"数据库中已存在具有相同内容的分享 (Hash: {code_hash[:8]}...)。")
        existing_code_hash, existing_root_folder_name, existing_visible_flag, existing_share_code, existing_timestamp = existing_entry
        
        # 核心覆写逻辑：
        # 1. 如果现有的是私密 (False)，新请求是共享计划 (is_share_project_request is True, 对应 visible_flag=None) -> 删除旧的，插入新的
        # 2. 如果现有的是共享计划待审核 (None)，新请求也是共享计划 (is_share_project_request is True) -> 通常是重复提交，可以更新时间戳或提示已存在
        # 3. 如果现有的是已通过的共享 (True)，新请求是共享计划 -> 通常不应由用户降级或修改，提示已存在
        # 4. 如果新旧 visible_flag 一致 -> 无需操作，短码有效
        # 5. 其他情况（如从公共降为私密）-> 通常不允许，或提示错误

        if is_share_project_request and bool(existing_visible_flag) is False: # 私密升级到共享计划
            message_log.append(f"检测到私密分享 (原名: {existing_root_folder_name}) 将升级为公共分享 (待审核，新名: {root_folder_name_cleaned})。")
            if db_instance.deleteData(code_hash):
                message_log.append("原私密分享记录已删除。")
                if db_instance.insertData(code_hash, root_folder_name_cleaned, None, share_code_b64): # 共享计划总是以 None (待审核) 插入
                    operation_successful = True
                    message_log.append("成功将分享更新并存入数据库 (公共待审核)。")
                else:
                    message_log.append("错误：删除旧私密分享后，无法重新插入为公共分享。") # 理论上不太可能发生，除非并发极高
            else:
                message_log.append("错误：尝试删除旧私密分享记录失败。")
        
        elif bool(existing_visible_flag) == bool(visible_flag): # 标志完全相同，认为是重复操作或获取已有短码
            operation_successful = True
            message_log.append(f"数据库中已存在完全相同的记录 (名称: {existing_root_folder_name}, 可见性: {bool(existing_visible_flag)})。短分享码有效。")
            # 如果 rootFolderName 不同，但 visibleFlag 和 shareCode 相同，可以考虑是否更新 rootFolderName
            if existing_root_folder_name != root_folder_name_cleaned and bool(visible_flag) is not True: # 不更新已审核通过的公开资源的名称
                 # 更新名称的逻辑可以加在这里，例如：
                 # db_instance.updateRootFolderName(code_hash, root_folder_name_cleaned)
                 # 注意：Pan123Database 类需要添加 updateRootFolderName 方法
                 message_log.append(f"提示：分享内容已存在，但本次提供的根目录名 ('{root_folder_name_cleaned}')与库中 ('{existing_root_folder_name}') 不同。如需更新请联系管理员或检查逻辑。")
        
        else: # 其他类型的冲突 （例如 公开->私密，待审核->私密，已审核公开->待审核公开 等）
            message_log.append(f"数据库中已存在此分享，但具有不同的可见性/状态 (库中: {bool(existing_visible_flag)}, 请求: {bool(visible_flag)})。")
            message_log.append("为避免冲突或降级，本次未覆写数据库记录。您仍然可以使用查询到的短分享码。")
            # 在这种情况下，虽然没有写入，但既然内容相同，返回的短码仍然是有效的
            operation_successful = True 
            # 如果不希望这种情况下返回短码，可以将 operation_successful 设为 False

    else: # 数据库中不存在此 code_hash
        if db_instance.insertData(code_hash, root_folder_name_cleaned, bool(visible_flag), share_code_b64):
            operation_successful = True
            message_log.append(f"成功将新分享存入数据库 (根目录名: {root_folder_name_cleaned}, 可见性: {bool(visible_flag)})。")
        else:
            # 这种情况比较罕见，除非是数据库写入失败或者并发时主键冲突（虽然前面查了不存在）
            message_log.append("错误：无法将新分享存入数据库。")
            
    return code_hash if operation_successful else None, message_log

@app.route('/api/export', methods=['POST'])
def api_export():
    data = request.get_json()
    if not data:
        return jsonify({"isFinish": False, "message": "错误的请求：没有提供JSON数据。"}), 400

    username = data.get('username')
    password = data.get('password')
    home_file_path_str = data.get('homeFilePath', '0')
    user_specified_base_name_raw = data.get('userSpecifiedBaseName', '').strip()
    generate_short_code_flag = data.get('generateShortCode', False)
    share_project_flag = data.get('shareProject', False)

    if not username or not password:
        return jsonify({"isFinish": False, "message": "用户名和密码不能为空。"}), 400
    if not home_file_path_str:
         return jsonify({"isFinish": False, "message": "文件夹ID不能为空。"}), 400
    
    if share_project_flag and not user_specified_base_name_raw:
        return jsonify({"isFinish": False, "message": "加入资源共享计划时，必须填写根目录名 (分享名)。"}), 400
    
    # 如果勾选“加入资源共享计划”，则强制“生成短分享码”
    if share_project_flag:
        generate_short_code_flag = True

    try:
        parent_file_id_internal = int(home_file_path_str)
    except ValueError:
        # 允许非数字的文件夹ID，例如某些特殊场景的字符串ID (尽管123pan目前是数字)
        parent_file_id_internal = home_file_path_str 

    # 清理用于数据库的根目录名
    # 如果用户没有填写，并且是生成短码（非共享计划），可以生成一个默认的
    # 如果是共享计划，前面已经校验过必须填写
    cleaned_db_root_name = custom_secure_filename_part(user_specified_base_name_raw)
    if generate_short_code_flag and not cleaned_db_root_name:
        cleaned_db_root_name = f"导出的分享_{int(time.time())}"

    def generate_export_stream():
        driver = Pan123(debug=DEBUG)
        db = Pan123Database(debug=DEBUG) # 每个请求独立的数据库实例
        login_success_flag = False
        final_b64_string_data = None
        short_share_code_result = None
        pan123_op_successful = False

        try:
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
                elif state.get("isFinish") is False:
                    yield f"{json.dumps(state)}\n" # 直接传递 Pan123 的错误信息
                    return 
                else: # isFinish is None (来自 Pan123 的进度)
                    yield f"{json.dumps(state)}\n"
            
            if not pan123_op_successful or final_b64_string_data is None:
                yield f"{json.dumps({'isFinish': False, 'message': '未能从123网盘获取文件数据。'})}\n"
                return

            # 处理数据库存储（如果需要）
            if generate_short_code_flag:
                yield f"{json.dumps({'isFinish': None, 'message': '正在生成短分享码并存储...'})}\n"
                code_hash = getStringHash(final_b64_string_data)
                visible_flag_for_db = None if share_project_flag else False
                
                # _handle_database_storage 返回 (code_hash_or_none, log_messages_list)
                op_result_code, db_log_msgs = _handle_database_storage(
                    db, code_hash, cleaned_db_root_name, visible_flag_for_db, final_b64_string_data, share_project_flag
                )
                for msg in db_log_msgs:
                    yield f"{json.dumps({'isFinish': None, 'message': msg})}\n"
                
                if op_result_code:
                    short_share_code_result = op_result_code
                    yield f"{json.dumps({'isFinish': None, 'message': f'短分享码处理完成，短码: {short_share_code_result}'})}\n"
                else:
                    yield f"{json.dumps({'isFinish': None, 'message': '生成或验证短分享码失败。长分享码仍然有效。'})}\n"
                    # 不中断流程，允许用户至少得到长码

            # 构造最终成功返回的 message 内容
            response_payload_dict = {'longShareCode': final_b64_string_data}
            if short_share_code_result:
                response_payload_dict['shortShareCode'] = short_share_code_result
            
            final_success_message_json_str = json.dumps(response_payload_dict)

            if login_success_flag:
                driver.doLogout()
                yield f"{json.dumps({'isFinish': None, 'message': '已注销账号。'})}\n"
                login_success_flag = False # 防止重复注销

            yield f"{json.dumps({'isFinish': True, 'message': final_success_message_json_str})}\n"

        except Exception as e:
            app.logger.error(f"API Export error: {e}", exc_info=True)
            # 尝试在异常时也注销
            if login_success_flag:
                try:
                    driver.doLogout()
                    yield f"{json.dumps({'isFinish': None, 'message': '发生错误，尝试注销账号...'})}\n"
                except Exception as logout_err:
                    app.logger.error(f"Error during logout on exception: {logout_err}", exc_info=True)
                    yield f"{json.dumps({'isFinish': None, 'message': f'注销时发生错误: {str(logout_err)}'})}\n"
            yield f"{json.dumps({'isFinish': False, 'message': f'导出过程中服务器发生意外错误: {str(e)}'})}\n"
        finally:
            db.close() # 确保数据库连接被关闭
            if login_success_flag: # 如果try块中途退出且未注销
                try:
                    driver.doLogout()
                    # 不再 yield，因为可能已经有 isFinish:True/False 发送了
                    app.logger.info("Logout in finally block for api_export completed.")
                except Exception as final_logout_err:
                    app.logger.error(f"Error during final logout for api_export: {final_logout_err}", exc_info=True)

    return Response(stream_with_context(generate_export_stream()), content_type='application/x-ndjson')

@app.route('/api/import', methods=['POST'])
def api_import():
    data = request.get_json()
    if not data:
        return jsonify({"isFinish": False, "message": "错误的请求：没有提供JSON数据。"}), 400

    username = data.get('username')
    password = data.get('password')
    
    # 新的导入参数
    code_hash_param = data.get('codeHash', None) # 来自公共资源库或短分享码模式
    base64_data_param = data.get('base64Data', None) # 来自长分享码模式
    root_folder_name_param = data.get('rootFolderName', None) # 来自长分享码模式
    share_project_for_long_code = data.get('shareProject', False) # 仅用于长分享码导入时

    if not username or not password:
        return jsonify({"isFinish": False, "message": "用户名和密码不能为空。"}), 400

    # 参数校验：要么有 codeHash，要么有 base64Data 和 rootFolderName
    if not code_hash_param and not (base64_data_param and root_folder_name_param):
        return jsonify({"isFinish": False, "message": "导入参数不足：需要提供短分享码，或长分享码及根目录名。"}), 400
    
    if code_hash_param and (base64_data_param or root_folder_name_param):
        return jsonify({"isFinish": False, "message": "导入参数冲突：短分享码与其他导入参数不能同时提供。"}), 400

    # 为长分享码模式准备数据库存储用的文件名
    cleaned_db_root_name_for_long_code = ""
    if base64_data_param and root_folder_name_param : # 长分享码模式
        cleaned_db_root_name_for_long_code = custom_secure_filename_part(root_folder_name_param)
        if share_project_for_long_code and not cleaned_db_root_name_for_long_code:
             return jsonify({"isFinish": False, "message": "使用长分享码加入资源共享计划时，必须填写有效的根目录名。"}), 400
        elif not cleaned_db_root_name_for_long_code : # 普通长码导入，名字为空，给个默认
            cleaned_db_root_name_for_long_code = f"导入的分享_{int(time.time())}"

    def generate_import_stream():
        driver = Pan123(debug=DEBUG)
        db = Pan123Database(debug=DEBUG)
        login_success_flag = False
        
        actual_base64_data_to_import = None
        actual_root_folder_name_to_import = None

        try:
            login_success_flag = driver.doLogin(username=username, password=password)
            if not login_success_flag:
                yield f"{json.dumps({'isFinish': False, 'message': '登录失败，请检查用户名和密码。'})}\n"
                return
            yield f"{json.dumps({'isFinish': None, 'message': '登录成功，准备导入数据...'})}\n"

            if code_hash_param: # 短分享码或公共资源库导入
                yield f"{json.dumps({'isFinish': None, 'message': f'正在通过短分享码 {code_hash_param[:8]}... 获取数据...'})}\n"
                share_data_tuple = db.getDataByHash(code_hash_param) # (rootFolderName, shareCode, visibleFlag)
                if not share_data_tuple:
                    yield f"{json.dumps({'isFinish': False, 'message': '短分享码无效或未在数据库中找到。'})}\n"
                    return
                actual_root_folder_name_to_import, actual_base64_data_to_import, _ = share_data_tuple
                yield f"{json.dumps({'isFinish': None, 'message': f'获取数据成功，将导入为：{actual_root_folder_name_to_import}'})}\n"
            
            else: # 长分享码导入
                actual_base64_data_to_import = base64_data_param
                actual_root_folder_name_to_import = cleaned_db_root_name_for_long_code # 用清理后的
                yield f"{json.dumps({'isFinish': None, 'message': f'准备使用长分享码导入，根目录名：{actual_root_folder_name_to_import}'})}\n"

                if share_project_for_long_code: # 长分享码导入时也选择加入共享计划
                    yield f"{json.dumps({'isFinish': None, 'message': '已勾选加入资源共享计划，正在将此长分享码存入数据库...'})}\n"
                    new_code_hash = getStringHash(actual_base64_data_to_import)
                    # 对于长码导入并共享，visibleFlag 总是 None (待审核)
                    op_result_code, db_log_msgs = _handle_database_storage(
                        db, new_code_hash, actual_root_folder_name_to_import, None, actual_base64_data_to_import, True 
                    )
                    for msg in db_log_msgs:
                        yield f"{json.dumps({'isFinish': None, 'message': msg})}\n"
                    if not op_result_code:
                        yield f"{json.dumps({'isFinish': None, 'message': '将此长分享码存入数据库失败。导入仍将继续，但不会生成可共享的短码。'})}\n"
                    else:
                        yield f"{json.dumps({'isFinish': None, 'message': f'此长分享码已存入数据库，对应短码为: {op_result_code}'})}\n"
            
            pan123_import_op_successful = False
            final_pan123_message = "导入操作未正常完成。"

            for state in driver.importFiles(base64Data=actual_base64_data_to_import, rootFolderName=actual_root_folder_name_to_import):
                if state.get("isFinish") is True:
                    # 这是 Pan123.importFiles 的最终成功消息
                    pan123_import_op_successful = True
                    final_pan123_message = state["message"]
                    # 不要在这里 break，让它自然结束，这条消息将作为下面的 isFinish:True 的message
                    yield f"{json.dumps({'isFinish': None, 'message': final_pan123_message})}\n" # 过程性地报告这条消息
                    break # 明确结束 importFiles 循环
                elif state.get("isFinish") is False:
                    yield f"{json.dumps(state)}\n" # 传递 Pan123 的错误
                    return
                else: # isFinish is None
                    yield f"{json.dumps(state)}\n"

            if not pan123_import_op_successful:
                yield f"{json.dumps({'isFinish': False, 'message': final_pan123_message})}\n" # 如果上面因为某些原因没置成功标志
                return

            if login_success_flag:
                driver.doLogout()
                yield f"{json.dumps({'isFinish': None, 'message': '已注销账号。'})}\n"
                login_success_flag = False

            yield f"{json.dumps({'isFinish': True, 'message': final_pan123_message})}\n" # 使用Pan123成功导入的最终消息

        except Exception as e:
            app.logger.error(f"API Import error: {e}", exc_info=True)
            if login_success_flag:
                try:
                    driver.doLogout()
                    yield f"{json.dumps({'isFinish': None, 'message': '发生错误，尝试注销账号...'})}\n"
                except Exception as logout_err:
                    app.logger.error(f"Error during logout on import exception: {logout_err}", exc_info=True)
                    yield f"{json.dumps({'isFinish': None, 'message': f'注销时发生错误: {str(logout_err)}'})}\n"
            yield f"{json.dumps({'isFinish': False, 'message': f'导入过程中服务器发生意外错误: {str(e)}'})}\n"
        finally:
            db.close()
            if login_success_flag:
                try:
                    driver.doLogout()
                    app.logger.info("Logout in finally block for api_import completed.")
                except Exception as final_logout_err:
                    app.logger.error(f"Error during final logout for api_import: {final_logout_err}", exc_info=True)
                
    return Response(stream_with_context(generate_import_stream()), content_type='application/x-ndjson')

@app.route('/api/link', methods=['POST'])
def api_link():
    data = request.get_json()
    if not data:
        return jsonify({"isFinish": False, "message": "错误的请求：没有提供JSON数据。"}), 400

    parent_file_id_str = data.get('parentFileId', '0')
    share_key = data.get('shareKey')
    share_pwd = data.get('sharePwd', '') 
    user_specified_base_name_raw = data.get('userSpecifiedBaseName', '').strip()
    generate_short_code_flag = data.get('generateShortCode', False) # 新增
    share_project_flag = data.get('shareProject', False)

    if not share_key:
        return jsonify({"isFinish": False, "message": "分享链接 Key 不能为空。"}), 400
    if not parent_file_id_str: 
        return jsonify({"isFinish": False, "message": "文件夹ID不能为空。"}), 400
    
    if share_project_flag and not user_specified_base_name_raw:
        return jsonify({"isFinish": False, "message": "加入资源共享计划时，必须填写根目录名 (分享名)。"}), 400
    
    if share_project_flag:
        generate_short_code_flag = True
        
    try:
        parent_file_id_internal = int(parent_file_id_str)
    except ValueError:
        parent_file_id_internal = parent_file_id_str

    cleaned_db_root_name = custom_secure_filename_part(user_specified_base_name_raw)
    if generate_short_code_flag and not cleaned_db_root_name:
        cleaned_db_root_name = f"链接分享_{share_key}_{int(time.time())}"

    def generate_link_export_stream():
        driver = Pan123(debug=DEBUG) 
        db = Pan123Database(debug=DEBUG)
        # login is not needed for link export using Pan123.exportShare
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
                    return
                else: 
                    yield f"{json.dumps(state)}\n"

            if not pan123_op_successful or final_b64_string_data is None:
                yield f"{json.dumps({'isFinish': False, 'message': '未能从分享链接获取文件数据。'})}\n"
                return

            if generate_short_code_flag:
                yield f"{json.dumps({'isFinish': None, 'message': '正在生成短分享码并存储...'})}\n"
                code_hash = getStringHash(final_b64_string_data)
                visible_flag_for_db = None if share_project_flag else False
                
                op_result_code, db_log_msgs = _handle_database_storage(
                    db, code_hash, cleaned_db_root_name, visible_flag_for_db, final_b64_string_data, share_project_flag
                )
                for msg in db_log_msgs:
                    yield f"{json.dumps({'isFinish': None, 'message': msg})}\n"

                if op_result_code:
                    short_share_code_result = op_result_code
                    yield f"{json.dumps({'isFinish': None, 'message': f'短分享码处理完成，短码: {short_share_code_result}'})}\n"
                else:
                    yield f"{json.dumps({'isFinish': None, 'message': '生成或验证短分享码失败。长分享码仍然有效。'})}\n"

            response_payload_dict = {'longShareCode': final_b64_string_data}
            if short_share_code_result:
                response_payload_dict['shortShareCode'] = short_share_code_result
            
            final_success_message_json_str = json.dumps(response_payload_dict)
            
            # Link export does not involve login/logout with Pan123 driver itself initially.
            # Explicit user login is not part of this flow.

            yield f"{json.dumps({'isFinish': True, 'message': final_success_message_json_str})}\n"

        except Exception as e:
            app.logger.error(f"API Link Export error: {e}", exc_info=True)
            yield f"{json.dumps({'isFinish': False, 'message': f'从分享链接导出过程中服务器发生意外错误: {str(e)}'})}\n"
        finally:
            db.close()

    return Response(stream_with_context(generate_link_export_stream()), content_type='application/x-ndjson')

@app.route('/api/list_public_shares', methods=['GET'])
def list_public_shares_from_db():
    db = Pan123Database(debug=DEBUG)
    try:
        # visibleFlag=True (公开且审核通过) 
        # visibleFlag=None (公开但待审核) 
        # 根据需求，这里可以只列出 True 的，或者两者都列出并加以区分
        # 当前需求是公共资源库，一般指审核通过的
        public_shares = db.listData(visibleFlag=True) 
        # public_shares is like [(codeHash, rootFolderName, timeStamp), ...]
        
        # 如果也想看到待审核的：
        # pending_shares = db.listData(visibleFlag=None)
        # combined_shares = []
        # for code_hash, name, ts in public_shares:
        #     combined_shares.append({"name": name, "codeHash": code_hash, "timestamp": ts, "status": "审核通过"})
        # for code_hash, name, ts in pending_shares:
        #    combined_shares.append({"name": name, "codeHash": code_hash, "timestamp": ts, "status": "待审核"})
        # sorted_shares = sorted(combined_shares, key=lambda x: x['timestamp'], reverse=True)
        # return jsonify({"success": True, "files": sorted_shares}), 200

        processed_shares = []
        for code_hash, name, ts in public_shares:
            processed_shares.append({"name": name, "codeHash": code_hash, "timestamp": ts})
        
        # 按时间戳降序排序
        sorted_shares = sorted(processed_shares, key=lambda x: x['timestamp'], reverse=True)
        return jsonify({"success": True, "files": sorted_shares}), 200

    except Exception as e:
        app.logger.error(f"Error listing public shares from DB: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"获取公共分享列表失败: {str(e)}"}), 500
    finally:
        db.close()

# /api/get_public_share_content 路由不再需要，因为导入时直接使用 codeHash

# --- HTML Routes ---
@app.route('/export')
def export_page():
    resp = make_response(render_template('export_form.html'))
    return resp

@app.route('/import')
def import_page():
    resp = make_response(render_template('import_form.html'))
    return resp

@app.route('/link')
def link_page():
    resp = make_response(render_template('link_form.html'))
    return resp

if __name__ == '__main__':

    # Telegram 的那个频道名称，大家应该都知道是telegram的哪个群, 自己填入（@xxxx的xxxx部分）, GitHub不明说了
    channel_name = "" # 程序会从该频道爬取资源、自动导入到公共资源库中
    message_after_id = 8050 # 从 8050 开始爬, 因为该频道之前的分享内容【全】【都】【失】【效】【了】
    port = 33333 # 网页运行端口
    
    # 当你看到这里, 请不要尝试删除本段代码, 强行运行
    
    # 不支持的IP地址是没法运行后续程序的!
    # 不支持的IP地址是没法运行后续程序的!
    # 不支持的IP地址是没法运行后续程序的!

    # 如果是中国大陆的IP, 退出程序
    if not isAvailableRegion():
        exit(0)

    # 从Telegram频道爬取数据, 导入到公共资源库
    startSpider(
        channel_name=channel_name,
        message_after_id=message_after_id,
        debug=DEBUG
    )

    # 启动Flask应用
    app.run(debug=DEBUG, host='0.0.0.0', port=port, threaded=True) # threaded=True 是Flask的默认值之一，但显式写出无害