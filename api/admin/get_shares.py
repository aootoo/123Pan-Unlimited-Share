from flask import jsonify, current_app
from Pan123Database import Pan123Database
from utils import loadSettings
from api.admin.admin_utils import admin_required 

DATABASE_PATH = loadSettings("DATABASE_PATH")

@admin_required # 应用装饰器保护此API
def handle_admin_get_shares():
    db = None
    try:
        db = Pan123Database(dbpath=DATABASE_PATH)
        # listAllDataForAdmin() 返回 (codeHash, rootFolderName, shareCode, timeStamp, visibleFlag)
        all_shares_raw = db.listAllDataForAdmin()
        
        approved_shares = []
        pending_shares = []
        private_shares = []

        for code_hash, name, share_code, ts, visible_flag in all_shares_raw:
            # 确保visible_flag是 Python bool 或 None
            processed_visible_flag = None
            if visible_flag == 1: # SQLite TRUE
                processed_visible_flag = True
            elif visible_flag == 0: # SQLite FALSE
                processed_visible_flag = False
            # else it remains None (SQLite NULL)

            item = {
                "codeHash": code_hash, 
                "rootFolderName": name, 
                "shareCode": share_code, # 完整shareCode给admin
                "timeStamp": ts, 
                "visibleFlag": processed_visible_flag
            }

            if processed_visible_flag is True:
                approved_shares.append(item)
            elif processed_visible_flag is None: # 待审核
                pending_shares.append(item)
            elif processed_visible_flag is False: # 私密
                private_shares.append(item)
        
        return jsonify({
            "success": True,
            "approved": approved_shares,
            "pending": pending_shares,
            "private": private_shares
        }), 200

    except Exception as e:
        current_app.logger.error(f"Admin API Error getting shares: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"获取分享列表失败: {str(e)}"}), 500
    finally:
        if db:
            db.close()