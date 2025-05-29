from flask import jsonify, current_app 
from Pan123Database import Pan123Database
from utils import loadSettings

DATABASE_PATH = loadSettings("DATABASE_PATH")

def handle_list_public_shares():
    db = None
    try:
        db = Pan123Database(dbpath=DATABASE_PATH)
        # listData(visibleFlag=True) 默认按 timeStamp DESC 排序
        public_shares_raw = db.listData(visibleFlag=True) 
        
        processed_shares = []
        # listData 返回的是 (codeHash, rootFolderName, timeStamp)
        for code_hash, name, ts in public_shares_raw:
            processed_shares.append({"name": name, "codeHash": code_hash, "timestamp": ts})
        
        return jsonify({"success": True, "files": processed_shares}), 200

    except Exception as e:
        current_app.logger.error(f"Error listing public shares from DB (list_public_shares API): {e}", exc_info=True)
        return jsonify({"success": False, "message": f"获取公共分享列表失败: {str(e)}"}), 500
    finally:
        if db:
            db.close()