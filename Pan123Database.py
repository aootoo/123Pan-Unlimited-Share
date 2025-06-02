import sqlite3
import os
import requests

from tqdm import tqdm
from utils import getStringHash

from getGlobalLogger import logger

class Pan123Database:
    def __init__(self, dbpath):
        # 确保数据库目录存在
        db_dir = os.path.dirname(dbpath)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
        
        # 如果数据库文件不存在, 则下载最新数据库
        if not os.path.exists(dbpath):
            logger.info(f"数据库文件 {dbpath} 不存在，尝试下载最新数据库。")
            dbpath = self.downloadLatestDatabase(dbpath)
        
        # 验证数据库文件
        self.conn = sqlite3.connect(dbpath, check_same_thread=False)
        self.database = self.conn.cursor()
        # 如果是空的, 就创建表:
        # PAN123DATABASE (
        #   codeHash TEXT PRIMARY KEY, -- 分享内容（长码base64）的SHA256哈希值，作为短分享码
        #   rootFolderName TEXT,      -- 用户指定的分享根目录名
        #   visibleFlag BOOLEAN,      -- True: 公开可见（通过公共列表），False: 私有短码（不公开），None: 待审核（加入共享计划）
        #   shareCode TEXT,           -- 完整的分享码（即长码base64）
        #   timeStamp DATETIME DEFAULT (datetime('now', '+8 hours')) -- 数据插入时间 (GMT+8: 北京时间)
        # )
        self.database.execute("""
            CREATE TABLE IF NOT EXISTS PAN123DATABASE (
                codeHash TEXT PRIMARY KEY,
                rootFolderName TEXT NOT NULL,
                visibleFlag BOOLEAN,
                shareCode TEXT NOT NULL,
                timeStamp DATETIME DEFAULT (datetime('now', '+8 hours'))
            )
        """)
        self.conn.commit()

    def importShareFiles(self, folder_path="./share"):
        # 检查 ./share 文件夹内是否存在 *.123share 文件, 如果存在, 则挨个读取, 并将其加入数据库, 随后删除该文件
        # 这个函数是为了兼容旧版本
        if not os.path.exists(folder_path): # 如果 share 不存在了，就直接返回
            logger.info(f"兼容模式：未找到 {folder_path} 文件夹，跳过旧文件导入。")
            return
            
        logger.info(f"兼容模式：开始导入 {folder_path} 文件夹内的所有 *.123share 文件。")
        filenames = os.listdir(folder_path)
        # 过滤确保是文件夹中的文件，而不是子目录
        filenames_to_process = []
        for filename in filenames:
            if filename.endswith(".123share") and os.path.isfile(os.path.join(folder_path, filename)):
                filenames_to_process.append(filename[:-9])

        for filename_base in tqdm(filenames_to_process):
            file_path_to_read = os.path.join(folder_path, f"{filename_base}.123share")
            try:
                with open(file_path_to_read, "r", encoding='utf-8') as f:
                    filedata = f.read().strip("\n").strip() # 去除换行和空格 (文件只有一行, 这个是确定的)
                codeHash = getStringHash(filedata)
                shareCode = filedata
                rootFolderName = filename_base # 使用去除.123share后缀的文件名
                
                # 尝试插入，如果已存在（基于主键codeHash），则跳过
                # 这里的visibleFlag默认为True因为它们来自旧的public/ok目录
                # 为避免重复插入导致错误，先查询
                self.database.execute("SELECT 1 FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
                if self.database.fetchone():
                    log_msg = f"兼容模式：{filename_base}.123share (codeHash: {codeHash}) 已存在于数据库，跳过导入。"
                    tqdm.write(log_msg)
                    logger.info(log_msg)
                else:
                    self.insertData(codeHash, rootFolderName, True, shareCode) # 默认旧的公开资源为 True
                    logger.info(f"兼容模式：成功导入 {filename_base}.123share 文件, rootFolderName: {rootFolderName}, codeHash: {codeHash}")
                #可以选择删除文件，但为了安全起见，先注释掉，可以手动清理
                # os.remove(file_path_to_read)
            except Exception as e:
                logger.error(f"兼容模式：处理 {filename_base}.123share 时发生错误: {e}", exc_info=True)

    def downloadLatestDatabase(self, file_path="./latest.db"):
        url = 'https://ghfast.top/https://raw.githubusercontent.com/realcwj/123Pan-Unlimited-Share/refs/heads/main/assets/PAN123DATABASE.db' 
        r = requests.get(url)
        with open(file_path, "wb") as f:
            f.write(r.content)
        return file_path

    def importDatabase(self, database_path:str):
        # 导入一个数据库文件, 并将其数据合并到当前数据库
        # 导入的数据库文件格式与当前数据库相同
        # 只导入当前数据库没有的 codeHash 的条目的数据
        
        # 打开要导入的数据库文件
        conn_to_import = sqlite3.connect(database_path)
        database_to_import = conn_to_import.cursor()

        # 从要导入的数据库中获取所有 codeHash
        database_to_import.execute("SELECT codeHash FROM PAN123DATABASE")
        codeHashes_to_import = [row[0] for row in database_to_import.fetchall()]
        
        # 遍历要导入的数据库中的每一条记录
        logger.info(f"开始导入数据库: {database_path}")
        for codeHash in tqdm(codeHashes_to_import, desc=f"导入数据库: {database_path}"):
            # 检查当前数据库中是否已存在相同的 codeHash
            self.database.execute("SELECT 1 FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
            if self.database.fetchone():
                logger.debug(f"跳过导入 {codeHash}，因为它已存在于当前数据库。")
                continue  # 跳过已存在的记录

            # 从要导入的数据库中获取该记录的其他字段
            database_to_import.execute("SELECT rootFolderName, visibleFlag, shareCode FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
            rootFolderName, visibleFlag, shareCode = database_to_import.fetchone()

            # 插入到当前数据库
            self.insertData(codeHash, rootFolderName, visibleFlag, shareCode)
            logger.info(f"从外部数据库导入新增资源: {rootFolderName} (Hash: {codeHash}), visibleFlag: {visibleFlag}")

        # 关闭导入的数据库连接
        conn_to_import.close()
        logger.info(f"数据库 {database_path} 导入完成，尝试导入 {len(codeHashes_to_import)} 条记录。")
        
        # 删除导入的数据库文件
        os.remove(database_path)

    def insertData(self, codeHash:str, rootFolderName:str, visibleFlag:bool, shareCode:str):
        # visibleFlag: True: 公开, None: 公开(但是待审核), False: 私密 (仅生成短分享码，不加入公共列表)
        try:
            # 检查 codeHash 是否已存在, 由调用方 web.py 处理覆写逻辑，这里直接尝试插入
            self.database.execute(
                "INSERT INTO PAN123DATABASE (codeHash, rootFolderName, visibleFlag, shareCode) VALUES (?, ?, ?, ?)",
                (codeHash, rootFolderName, visibleFlag, shareCode)
            )
            self.conn.commit()
            logger.debug(f"成功插入数据: codeHash={codeHash}, rootFolderName={rootFolderName}, visibleFlag={visibleFlag}")
            return True # 返回 True 表示插入成功
        except sqlite3.IntegrityError: # 捕获唯一约束冲突
            # 这个错误理论上不应该发生，因为 web.py 会先检查和删除（如果需要覆写）
            # 但如果直接调用此方法且 codeHash 已存在且不是覆写场景，则会到这里
            logger.warning(f"插入数据失败: 短分享码 (codeHash): {codeHash} 已存在 (IntegrityError)。")
            return False # 返回 False 表示因主键冲突插入失败
        except Exception as e:
            logger.error(f"插入数据失败 (codeHash={codeHash}): {e}", exc_info=True)
            return False

    def queryHash(self, codeHash:str):
        self.database.execute(
            "SELECT codeHash, rootFolderName, visibleFlag, shareCode, timeStamp FROM PAN123DATABASE WHERE codeHash=?",
            (codeHash,)
            )
        result = []
        for codeHash, rootFolderName, visibleFlag, shareCode, timeStamp in self.database.fetchall():
            result.append((
                codeHash,
                rootFolderName,
                bool(visibleFlag) if visibleFlag is not None else None, # 不知道为什么，从数据库里读出来的不是bool? 还要额外转一下
                shareCode,
                timeStamp 
            ))
        return result

    def queryName(self, rootFolderName:str): # 主要用于 telegram_spider 检查重名
        self.database.execute(
            "SELECT codeHash, rootFolderName, visibleFlag, shareCode, timeStamp FROM PAN123DATABASE WHERE rootFolderName=?",
            (rootFolderName,)
            )
        result = []
        for codeHash, rootFolderName, visibleFlag, shareCode, timeStamp in self.database.fetchall():
            result.append((
                codeHash,
                rootFolderName,
                bool(visibleFlag) if visibleFlag is not None else None, # 不知道为什么，从数据库里读出来的不是bool? 还要额外转一下
                shareCode,
                timeStamp
                ))
        return result

    def getDataByHash(self, codeHash: str):
        self.database.execute(
            "SELECT rootFolderName, shareCode, visibleFlag FROM PAN123DATABASE WHERE codeHash=?",
            (codeHash,)
            )
        result = []
        for rootFolderName, shareCode, visibleFlag in self.database.fetchall():
            result.append((
                rootFolderName,
                shareCode,
                bool(visibleFlag) if visibleFlag is not None else None # 不知道为什么，从数据库里读出来的不是bool? 还要额外转一下 
            ))
        
        if len(result):
            logger.debug(f"通过 codeHash '{codeHash}' 查询到数据: rootFolderName='{result[0][0]}', visibleFlag={result[0][2]}") # result[0] 是元组
            return result # 返回 (rootFolderName, shareCode, visibleFlag)
        else:
            logger.debug(f"通过 codeHash '{codeHash}' 未查询到数据")
            return None

    def listData(self, visibleFlag: bool = True, page: int = 1):
        # 只展示visibleFlag为True (公开且审核通过) 的数据
        # 返回 [(codeHash, rootFolderName, timeStamp), ...], is_end_page
        if page < 1:
            page = 1
        limit = 100
        offset = (page - 1) * limit

        # 获取总记录数
        self.database.execute("SELECT COUNT(*) FROM PAN123DATABASE WHERE visibleFlag=?", (visibleFlag,))
        total_records = self.database.fetchone()[0]
        
        self.database.execute(
            "SELECT codeHash, rootFolderName, timeStamp FROM PAN123DATABASE WHERE visibleFlag=? ORDER BY timeStamp DESC LIMIT ? OFFSET ?",
            (visibleFlag, limit, offset)
        )
        results = self.database.fetchall()
        
        is_end_page = (page * limit) >= total_records
        
        return results, is_end_page

    def searchDataByName(self, rootFolderName: str, page: int = 1):
        # 根据 rootFolderName 模糊搜索公开的分享 (visibleFlag=True)
        # 返回 [(codeHash, rootFolderName, timeStamp), ...], is_end_page
        if page < 1:
            page = 1
        limit = 100
        offset = (page - 1) * limit
        search_pattern = f"%{rootFolderName}%"

        # 获取符合搜索条件的总记录数
        self.database.execute(
            "SELECT COUNT(*) FROM PAN123DATABASE WHERE rootFolderName LIKE ? AND visibleFlag = 1", # visibleFlag=True
            (search_pattern,)
        )
        total_records = self.database.fetchone()[0]

        self.database.execute(
            "SELECT codeHash, rootFolderName, timeStamp FROM PAN123DATABASE WHERE rootFolderName LIKE ? AND visibleFlag = 1 ORDER BY timeStamp DESC LIMIT ? OFFSET ?",
            (search_pattern, limit, offset)
        )
        results = self.database.fetchall()

        is_end_page = (page * limit) >= total_records
        
        return results, is_end_page

    def deleteData(self, codeHash:str):
        self.database.execute("SELECT codeHash FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
        if self.database.fetchone() is None:
            logger.debug(f"尝试删除 codeHash: {codeHash}, 但记录不存在。")
            return False # False 表示未找到，所以未删除
        self.database.execute("DELETE FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
        self.conn.commit()
        logger.warning(f"已删除 codeHash: {codeHash}") # 高敏感度操作, 用 warning 级别
        return True # True 表示成功删除

    def getSharesByStatusPaged(self, status_filter: str, page: int = 1):
        # status_filter: "approved", "pending", "private"
        # 返回 [(codeHash, rootFolderName, shareCode, timeStamp, visibleFlag)...], is_end_page
        if page < 1:
            page = 1
        limit = 100
        offset = (page - 1) * limit

        sql_where_clause = ""
        params = []

        if status_filter == "approved":
            sql_where_clause = "WHERE visibleFlag = 1" # True
        elif status_filter == "pending":
            sql_where_clause = "WHERE visibleFlag IS NULL"
        elif status_filter == "private":
            sql_where_clause = "WHERE visibleFlag = 0" # False
        else: # 如果状态无效，返回空
            return [], True

        # 获取总记录数
        count_sql = f"SELECT COUNT(*) FROM PAN123DATABASE {sql_where_clause}"
        self.database.execute(count_sql)
        total_records = self.database.fetchone()[0]

        query_sql = f"SELECT codeHash, rootFolderName, shareCode, timeStamp, visibleFlag FROM PAN123DATABASE {sql_where_clause} ORDER BY timeStamp DESC LIMIT ? OFFSET ?"
        
        self.database.execute(query_sql, (limit, offset))
        
        raw_results = self.database.fetchall()
        processed_results = []
        for codeHash, rootFolderName, shareCode, timeStamp, visibleFlag_db in raw_results:
            # 确保 visibleFlag 是 Python bool 或 None
            visible_flag_py = None
            if visibleFlag_db == 1:
                visible_flag_py = True
            elif visibleFlag_db == 0:
                visible_flag_py = False
            
            processed_results.append((
                codeHash,
                rootFolderName,
                shareCode,
                timeStamp,
                visible_flag_py
            ))
            
        is_end_page = (page * limit) >= total_records
        
        return processed_results, is_end_page

    def updateVisibleFlag(self, codeHash: str, newVisibleFlag: bool):
        try:
            self.database.execute("UPDATE PAN123DATABASE SET visibleFlag=? WHERE codeHash=?", (newVisibleFlag, codeHash))
            self.conn.commit()
            if self.database.rowcount > 0:
                logger.info(f"已更新 codeHash: {codeHash} 的 visibleFlag 为 {newVisibleFlag}")
                return True
            else:
                logger.warning(f"未找到 codeHash: {codeHash}，无法更新 visibleFlag。")
                return False
        except Exception as e:
            logger.error(f"更新 visibleFlag 失败 (codeHash: {codeHash}): {e}", exc_info=True)
            return False
 
    def updateRootFolderName(self, codeHash: str, newRootFolderName: str):
        try:
            self.database.execute("UPDATE PAN123DATABASE SET rootFolderName=? WHERE codeHash=?", (newRootFolderName, codeHash))
            self.conn.commit()
            if self.database.rowcount > 0:
                logger.debug(f"已更新 codeHash: {codeHash} 的 rootFolderName 为 {newRootFolderName}")
                return True
            else:
                logger.warning(f"未找到 codeHash: {codeHash}，无法更新 rootFolderName。")
                return False
        except Exception as e:
            logger.error(f"更新 rootFolderName 失败 (codeHash: {codeHash}): {e}", exc_info=True)
            return False

    def close(self):
        if self.conn:
            self.conn.close()



if __name__ == "__main__":

    db = Pan123Database(dbpath="./assets/PAN123DATABASE.db")

    # 从 ./export 导入文件 (兼容旧版)
    db.importShareFiles(folder_path="./export")

    logger.info("\n\n--- 测试 listData (公开资源) ---\n")

    public_shares, end_page = db.listData(page=1)
    
    if public_shares:
        for item in public_shares:
            logger.info(str(item))
    else:
        logger.info("无公开资源")
    
    print(end_page)

    # 测试导入新数据库
    # new_db_path = "./assets/latest.db"
    # db.importDatabase(new_db_path)

    db.close()