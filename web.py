import time
import json
from flask import Flask, render_template, request,\
                Response, stream_with_context, \
                jsonify, make_response, session, \
                redirect, url_for, flash
import re
import unicodedata
from functools import wraps
import os

from Pan123 import Pan123
from utils import getStringHash, loadSettings, isAvailableRegion
from Pan123Database import Pan123Database
from generateContentTree import generateContentTree

DEBUG = loadSettings("DEBUG")
ADMIN_ENTRY = loadSettings("ADMIN_ENTRY")
ADMIN_USERNAME = loadSettings("ADMIN_USERNAME")
ADMIN_PASSWORD = loadSettings("ADMIN_PASSWORD")
PORT = loadSettings("PORT")
DATABASE_PATH = loadSettings("DATABASE_PATH") 

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    static_folder=os.path.join(BASE_DIR, 'static'),
    template_folder=os.path.join(BASE_DIR,'templates')
    )

app.secret_key = loadSettings("SECRET_KEY")

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

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'admin_logged_in' not in session:
            flash('请先登录以访问此页面。', 'warning')
            return redirect(url_for('admin_login_page'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/banip')
def banip_page():
    return render_template('banip.html')

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
        existing_code_hash, existing_root_folder_name, existing_visible_flag, existing_share_code, existing_timestamp = existing_entry[0]
        
        # 核心覆写逻辑：
        # 1. 如果现有的是私密 (False)，新请求是共享计划 (is_share_project_request is True, 对应 visible_flag=None) -> 删除旧的，插入新的
        # 2. 如果现有的是共享计划待审核 (None)，新请求也是共享计划 (is_share_project_request is True) -> 通常是重复提交，可以更新时间戳或提示已存在
        # 3. 如果现有的是已通过的共享 (True)，新请求是共享计划 -> 通常不应由用户降级或修改，提示已存在
        # 4. 如果新旧 visible_flag 一致 -> 无需操作，短码有效
        # 5. 其他情况（如从公共降为私密）-> 通常不允许，或提示错误

        if is_share_project_request and existing_visible_flag is False: # 私密升级到共享计划
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
        
        elif existing_visible_flag == visible_flag and existing_visible_flag is not None and visible_flag is not None: # visibleFlag 都不是 None 且值相同 （处理True==True, False==False的情况）
            operation_successful = True
            message_log.append(f"数据库中已存在完全相同的记录 (名称: {existing_root_folder_name}, 可见性: {existing_visible_flag})。短分享码有效。")
        elif existing_visible_flag is None and visible_flag is None: # 两者都是 None
            operation_successful = True
            message_log.append(f"数据库中已存在待审核的记录 (名称: {existing_root_folder_name})。短分享码有效。")
        
        else: # 其他类型的冲突 （例如 公开->私密，待审核->私密，已审核公开->待审核公开 等）
            message_log.append(f"数据库中已存在此分享，但具有不同的可见性/状态 (库中: {existing_visible_flag}, 请求: {visible_flag})。")
            message_log.append("为避免冲突或降级，本次未覆写数据库记录。您仍然可以使用查询到的短分享码。")
            operation_successful = True 
            
    else: # 数据库中不存在此 code_hash
        # 在这里，visible_flag 可能是 True, False, 或 None
        final_visible_flag_for_insert = None if is_share_project_request else (False if visible_flag is False else visible_flag)

        if db_instance.insertData(code_hash, root_folder_name_cleaned, final_visible_flag_for_insert, share_code_b64):
            operation_successful = True
            message_log.append(f"成功将新分享存入数据库 (根目录名: {root_folder_name_cleaned}, 可见性: {final_visible_flag_for_insert})。")
        else:
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
    
    if share_project_flag:
        generate_short_code_flag = True

    try:
        parent_file_id_internal = int(home_file_path_str)
    except ValueError:
        parent_file_id_internal = home_file_path_str 

    cleaned_db_root_name = custom_secure_filename_part(user_specified_base_name_raw)
    if generate_short_code_flag and not cleaned_db_root_name:
        cleaned_db_root_name = f"导出的分享_{int(time.time())}"

    def generate_export_stream():
        driver = Pan123(debug=DEBUG)
        db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG) 
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
                    yield f"{json.dumps(state)}\n" 
                    return 
                else: 
                    yield f"{json.dumps(state)}\n"
            
            if not pan123_op_successful or final_b64_string_data is None:
                yield f"{json.dumps({'isFinish': False, 'message': '未能从123网盘获取文件数据。'})}\n"
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

            if login_success_flag:
                driver.doLogout()
                yield f"{json.dumps({'isFinish': None, 'message': '已注销账号。'})}\n"
                login_success_flag = False 

            yield f"{json.dumps({'isFinish': True, 'message': final_success_message_json_str})}\n"

        except Exception as e:
            app.logger.error(f"API Export error: {e}", exc_info=True)
            if login_success_flag:
                try:
                    driver.doLogout()
                    yield f"{json.dumps({'isFinish': None, 'message': '发生错误，尝试注销账号...'})}\n"
                except Exception as logout_err:
                    app.logger.error(f"Error during logout on exception: {logout_err}", exc_info=True)
                    yield f"{json.dumps({'isFinish': None, 'message': f'注销时发生错误: {str(logout_err)}'})}\n"
            yield f"{json.dumps({'isFinish': False, 'message': f'导出过程中服务器发生意外错误: {str(e)}'})}\n"
        finally:
            db.close() 
            if login_success_flag: 
                try:
                    driver.doLogout()
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
    
    code_hash_param = data.get('codeHash', None) 
    base64_data_param = data.get('base64Data', None) 
    root_folder_name_param = data.get('rootFolderName', None) 
    share_project_for_long_code = data.get('shareProject', False) 

    if not username or not password:
        return jsonify({"isFinish": False, "message": "用户名和密码不能为空。"}), 400

    if not code_hash_param and not (base64_data_param and root_folder_name_param):
        return jsonify({"isFinish": False, "message": "导入参数不足：需要提供短分享码，或长分享码及根目录名。"}), 400
    
    if code_hash_param and (base64_data_param or root_folder_name_param):
        return jsonify({"isFinish": False, "message": "导入参数冲突：短分享码与其他导入参数不能同时提供。"}), 400

    cleaned_db_root_name_for_long_code = ""
    if base64_data_param and root_folder_name_param : 
        cleaned_db_root_name_for_long_code = custom_secure_filename_part(root_folder_name_param)
        if share_project_for_long_code and not cleaned_db_root_name_for_long_code:
             return jsonify({"isFinish": False, "message": "使用长分享码加入资源共享计划时，必须填写有效的根目录名。"}), 400
        elif not cleaned_db_root_name_for_long_code : 
            cleaned_db_root_name_for_long_code = f"导入的分享_{int(time.time())}"

    def generate_import_stream():
        driver = Pan123(debug=DEBUG)
        db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
        login_success_flag = False
        
        actual_base64_data_to_import = None
        actual_root_folder_name_to_import = None

        try:
            login_success_flag = driver.doLogin(username=username, password=password)
            if not login_success_flag:
                yield f"{json.dumps({'isFinish': False, 'message': '登录失败，请检查用户名和密码。'})}\n"
                return
            yield f"{json.dumps({'isFinish': None, 'message': '登录成功，准备导入数据...'})}\n"

            if code_hash_param: 
                yield f"{json.dumps({'isFinish': None, 'message': f'正在通过短分享码 {code_hash_param[:8]}... 获取数据...'})}\n"
                share_data_tuple = db.getDataByHash(code_hash_param) 
                if not share_data_tuple:
                    yield f"{json.dumps({'isFinish': False, 'message': '短分享码无效或未在数据库中找到。'})}\n"
                    return
                # 提取元组中的数据 （有且仅有一个元素）
                actual_root_folder_name_to_import, actual_base64_data_to_import, _ = share_data_tuple[0]
                yield f"{json.dumps({'isFinish': None, 'message': f'获取数据成功，将导入为：{actual_root_folder_name_to_import}'})}\n"
            
            else: 
                actual_base64_data_to_import = base64_data_param
                actual_root_folder_name_to_import = cleaned_db_root_name_for_long_code
                yield f"{json.dumps({'isFinish': None, 'message': f'准备使用长分享码导入，根目录名：{actual_root_folder_name_to_import}'})}\n"

                if share_project_for_long_code: 
                    yield f"{json.dumps({'isFinish': None, 'message': '已勾选加入资源共享计划，正在将此长分享码存入数据库...'})}\n"
                    new_code_hash = getStringHash(actual_base64_data_to_import)
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
                    pan123_import_op_successful = True
                    final_pan123_message = state["message"]
                    yield f"{json.dumps({'isFinish': None, 'message': final_pan123_message})}\n" 
                    break 
                elif state.get("isFinish") is False:
                    yield f"{json.dumps(state)}\n" 
                    return
                else: 
                    yield f"{json.dumps(state)}\n"

            if not pan123_import_op_successful:
                yield f"{json.dumps({'isFinish': False, 'message': final_pan123_message})}\n" 
                return

            if login_success_flag:
                driver.doLogout()
                yield f"{json.dumps({'isFinish': None, 'message': '已注销账号。'})}\n"
                login_success_flag = False

            yield f"{json.dumps({'isFinish': True, 'message': final_pan123_message})}\n" 

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
    generate_short_code_flag = data.get('generateShortCode', False) 
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
        db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
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
            
            yield f"{json.dumps({'isFinish': True, 'message': final_success_message_json_str})}\n"

        except Exception as e:
            app.logger.error(f"API Link Export error: {e}", exc_info=True)
            yield f"{json.dumps({'isFinish': False, 'message': f'从分享链接导出过程中服务器发生意外错误: {str(e)}'})}\n"
        finally:
            db.close()

    return Response(stream_with_context(generate_link_export_stream()), content_type='application/x-ndjson')

@app.route('/api/list_public_shares', methods=['GET'])
def list_public_shares_from_db():
    db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
    try:
        # 根据 database.py 的 listData 修改，它返回(codeHash, rootFolderName, shareCode, timeStamp, visibleFlag)
        # 但前端只需要 (codeHash, rootFolderName, timeStamp) 用于公开列表
        public_shares_raw = db.listData(visibleFlag=True) # visibleFlag=True (公开且审核通过)
        
        processed_shares = []
        for code_hash, name, ts in public_shares_raw:
            processed_shares.append({"name": name, "codeHash": code_hash, "timestamp": ts})
        
        sorted_shares = sorted(processed_shares, key=lambda x: x['timestamp'], reverse=True)
        return jsonify({"success": True, "files": sorted_shares}), 200

    except Exception as e:
        app.logger.error(f"Error listing public shares from DB: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"获取公共分享列表失败: {str(e)}"}), 500
    finally:
        db.close()

@app.route('/api/get_content_tree', methods=['POST'])
def api_get_content_tree():
    data = request.get_json()
    if not data:
        return jsonify({"isFinish": False, "message": "错误的请求：没有提供JSON数据。"}), 400

    code_hash = data.get('codeHash')
    share_code_b64_from_request = data.get('shareCode') # 重命名以区分从数据库获取的
    
    target_share_code = None

    if code_hash:
        db = None  # 初始化为 None
        try:
            db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
            # db.getDataByHash 返回 [(rootFolderName, shareCode, visibleFlag)] 或 None
            share_data_tuple_list = db.getDataByHash(code_hash) 
            if share_data_tuple_list and len(share_data_tuple_list) > 0:
                target_share_code = share_data_tuple_list[0][1] # (rootFolderName, shareCode, visibleFlag) 中 的 shareCode
            else:
                return jsonify({"isFinish": False, "message": f"错误：未找到与提供的短分享码 {code_hash[:8]}... 对应的分享内容。"}), 404
        except Exception as e:
            app.logger.error(f"通过短分享码 {code_hash} 查询数据库时出错: {e}", exc_info=True)
            return jsonify({"isFinish": False, "message": f"数据库查询错误: {str(e)}"}), 500
        finally:
            if db: # 仅当db对象成功创建后才调用close
                 db.close()
    elif share_code_b64_from_request:
        target_share_code = share_code_b64_from_request
    else:
        return jsonify({"isFinish": False, "message": "错误：必须提供 'codeHash' 或 'shareCode'。"}), 400

    if not target_share_code:
        # 此情况理论上已被前述逻辑覆盖，但作为安全回退
        return jsonify({"isFinish": False, "message": "错误：未能获得有效的分享码以生成目录树。"}), 500
        
    try:
        # generateContentTree 函数期望接收 base64 编码的字符串数据
        # 并返回一个字典，格式为: {"isFinish": True/False, "message": 结果列表或错误信息字符串}
        result_dict = generateContentTree(target_share_code)
        return jsonify(result_dict)
    except Exception as e:
        app.logger.error(f"调用 generateContentTree 时发生错误: {e}", exc_info=True)
        # 确保返回的错误也符合 {"isFinish": False, "message": "错误信息"} 的结构
        return jsonify({"isFinish": False, "message": f"生成目录树时发生服务器内部错误: {str(e)}"}), 500

# --- Admin API 端点 ---
@app.route(f'/api/{ADMIN_ENTRY}/get_shares', methods=['GET'])
@admin_required
def api_admin_get_shares():
    db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
    try:
        all_shares_raw = db.listAllDataForAdmin() # (codeHash, rootFolderName, shareCode, timeStamp, visibleFlag)
        
        approved_shares = []
        pending_shares = []
        private_shares = []

        for code_hash, name, share_code, ts, visible_flag in all_shares_raw:
            item = {"codeHash": code_hash, "rootFolderName": name, "shareCode": share_code, "timeStamp": ts, "visibleFlag": visible_flag}
            if visible_flag is True:
                approved_shares.append(item)
            elif visible_flag is None:
                pending_shares.append(item)
            elif visible_flag is False:
                private_shares.append(item)
        
        return jsonify({
            "success": True,
            "approved": approved_shares,
            "pending": pending_shares,
            "private": private_shares
        }), 200

    except Exception as e:
        app.logger.error(f"Admin API Error getting shares: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"获取分享列表失败: {str(e)}"}), 500
    finally:
        db.close()

@app.route(f'/api/{ADMIN_ENTRY}/update_share_status', methods=['POST'])
@admin_required
def api_admin_update_share_status():
    data = request.get_json()
    code_hash = data.get('codeHash')
    new_status_str = data.get('newStatus') # "approved", "pending", "private"

    if not code_hash or new_status_str is None:
        return jsonify({"success": False, "message": "缺少参数 codeHash 或 newStatus。"}), 400

    new_visible_flag = None
    if new_status_str == "approved":
        new_visible_flag = True
    elif new_status_str == "pending":
        new_visible_flag = None
    elif new_status_str == "private":
        new_visible_flag = False
    else:
        return jsonify({"success": False, "message": "无效的状态值。"}), 400

    db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
    try:
        if db.updateVisibleFlag(code_hash, new_visible_flag):
            return jsonify({"success": True, "message": "状态更新成功。"}), 200
        else:
            return jsonify({"success": False, "message": "状态更新失败，记录可能不存在或数据库错误。"}), 500
    except Exception as e:
        app.logger.error(f"Admin API Error updating share status: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"更新状态时发生服务器错误: {str(e)}"}), 500
    finally:
        db.close()

@app.route(f'/api/{ADMIN_ENTRY}/update_share_name', methods=['POST'])
@admin_required
def api_admin_update_share_name():
    data = request.get_json()
    code_hash = data.get('codeHash')
    new_name_raw = data.get('newName', '').strip()

    if not code_hash or not new_name_raw:
        return jsonify({"success": False, "message": "缺少参数 codeHash 或 newName。"}), 400
    
    new_name_cleaned = custom_secure_filename_part(new_name_raw)
    if not new_name_cleaned:
        return jsonify({"success": False, "message": "提供的名称无效或清理后为空。"}), 400

    db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
    try:
        if db.updateRootFolderName(code_hash, new_name_cleaned):
            return jsonify({"success": True, "message": "名称更新成功。", "cleanedName": new_name_cleaned}), 200
        else:
            return jsonify({"success": False, "message": "名称更新失败，记录可能不存在或数据库错误。"}), 500
    except Exception as e:
        app.logger.error(f"Admin API Error updating share name: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"更新名称时发生服务器错误: {str(e)}"}), 500
    finally:
        db.close()

@app.route(f'/api/{ADMIN_ENTRY}/delete_share', methods=['POST'])
@admin_required
def api_admin_delete_share():
    data = request.get_json()
    code_hash = data.get('codeHash')

    if not code_hash:
        return jsonify({"success": False, "message": "缺少参数 codeHash。"}), 400

    db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
    try:
        if db.deleteData(code_hash):
            return jsonify({"success": True, "message": "记录删除成功。"}), 200
        else:
            return jsonify({"success": False, "message": "记录删除失败，记录可能不存在。"}), 404 # 404 Not Found
    except Exception as e:
        app.logger.error(f"Admin API Error deleting share: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"删除记录时发生服务器错误: {str(e)}"}), 500
    finally:
        db.close()

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

# --- Admin HTML Routes ---
@app.route(f'/{ADMIN_ENTRY}/login', methods=['GET', 'POST'])
def admin_login_page():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            session['admin_logged_in'] = True
            session['admin_username'] = username # 保存用户名到session
            flash('登录成功！', 'success')
            
            # 创建响应对象以设置 Cookie
            resp = make_response(redirect(url_for('admin_dashboard_page')))
            # 将用户名和（如果非生产环境且用户同意）密码（或标记）保存到 Cookie
            # 出于安全考虑，通常不直接将密码保存到 Cookie。这里仅保存用户名。
            resp.set_cookie('admin_username', username, max_age=30*24*60*60) # 30天有效
            return resp
        else:
            flash('用户名或密码错误。', 'danger')
    return render_template('admin_login.html', admin_entry=ADMIN_ENTRY)

@app.route(f'/{ADMIN_ENTRY}/dashboard')
@admin_required # 使用装饰器保护此路由
def admin_dashboard_page():
    return render_template('admin_dashboard.html', admin_entry=ADMIN_ENTRY, admin_username=session.get('admin_username'))

@app.route(f'/{ADMIN_ENTRY}/logout')
@admin_required
def admin_logout():
    session.pop('admin_logged_in', None)
    session.pop('admin_username', None)
    flash('您已成功注销。', 'info')
    # 如果需要，也可以清除cookie，但通常 session pop 就够了
    resp = make_response(redirect(url_for('admin_login_page')))
    # resp.delete_cookie('admin_username') # 清除cookies示例
    return resp

if __name__ == '__main__':

    # 下载最新数据库
    try:
        db = Pan123Database(dbpath=DATABASE_PATH, debug=DEBUG)
        print("正在下载最新数据库")
        latest_db_path = db.downloadLatestDatabase()
        print("正在导入最新数据库")
        db.importDatabase(latest_db_path)
        db.close()
    except Exception as e:
        print(f"数据库更新报错: {e}")
        input("按任意键结束")
        exit(0)

    # 启动Flask应用
    print("启动网页服务")
    app.run(
        debug=DEBUG,
        host='0.0.0.0',
        port=PORT,
        threaded=True
        )