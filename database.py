import sqlite3
import os

from utils import getStringHash

class Pan123Database:
    def __init__(self, dbpath="./assets/PAN123DATABASE.db", debug=False):
        self.debug = debug
        # 确保数据库目录存在
        db_dir = os.path.dirname(dbpath)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
            
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
                timeStamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.conn.commit()
        # 从 ./public/ok 导入文件
        # self.importPublicOkFiles()

    def importPublicOkFiles(self):
        # 检查 ./public/ok 文件夹内是否存在 *.123share 文件, 如果存在, 则挨个读取, 并将其加入数据库, 随后删除该文件
        # 这个函数是为了兼容旧版本
        ok_path = os.path.join(os.getcwd(), "public", "ok")
        if not os.path.exists(ok_path): # 如果 public/ok 不存在了，就直接返回
            print(f"兼容模式：未找到 {ok_path} 文件夹，跳过旧文件导入。")
            return
            
        print(f"导入 {ok_path} 文件夹内的所有 *.123share 文件中")
        filenames = os.listdir(ok_path)
        # 过滤确保是文件夹中的文件，而不是子目录
        filenames_to_process = []
        for filename in filenames:
            if filename.endswith(".123share") and os.path.isfile(os.path.join(ok_path, filename)):
                filenames_to_process.append(filename[:-9])

        for filename_base in filenames_to_process:
            file_path_to_read = os.path.join(ok_path, f"{filename_base}.123share")
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
                    if self.debug:
                        print(f"兼容模式：{filename_base}.123share (codeHash: {codeHash}) 已存在于数据库，跳过导入。")
                else:
                    self.insertData(codeHash, rootFolderName, True, shareCode) # 默认旧的公开资源为 True
                    if self.debug:
                        print(f"兼容模式：导入 {filename_base}.123share 文件, rootFolderName: {rootFolderName}, codeHash: {codeHash}")
                #可以选择删除文件，但为了安全起见，先注释掉，可以手动清理
                # os.remove(file_path_to_read)
            except Exception as e:
                print(f"兼容模式：处理 {filename_base}.123share 时发生错误: {e}")

    def insertData(self, codeHash:str, rootFolderName:str, visibleFlag:bool, shareCode:str):
        # visibleFlag: True: 公开, None: 公开(但是待审核), False: 私密 (仅生成短分享码，不加入公共列表)
        try:
            # 检查 codeHash 是否已存在, 由调用方 web.py 处理覆写逻辑，这里直接尝试插入
            self.database.execute(
                "INSERT INTO PAN123DATABASE (codeHash, rootFolderName, visibleFlag, shareCode) VALUES (?, ?, ?, ?)",
                (codeHash, rootFolderName, visibleFlag, shareCode)
            )
            self.conn.commit()
            if self.debug:
                print(f"成功插入数据: codeHash={codeHash}, rootFolderName={rootFolderName}, visibleFlag={visibleFlag}")
            return True # 返回 True 表示插入成功
        except sqlite3.IntegrityError: # 捕获唯一约束冲突
            # 这个错误理论上不应该发生，因为 web.py 会先检查和删除（如果需要覆写）
            # 但如果直接调用此方法且 codeHash 已存在且不是覆写场景，则会到这里
            if self.debug: # 在 debug 模式下打印更详细的信息
                 print(f"插入数据失败: 短分享码 (codeHash): {codeHash} 已存在 (完整性错误). 这通常意味着调用方未正确处理覆写逻辑。")
            return False # 返回 False 表示因主键冲突插入失败
        except Exception as e:
            print(f"插入数据失败, 原因: {e}")
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
            if self.debug:
                print(f"通过 codeHash '{codeHash}' 查询到数据: rootFolderName='{result[0]}', visibleFlag={result[2]}")
            return result # 返回 (rootFolderName, shareCode, visibleFlag)
        else:
            if self.debug:
                print(f"通过 codeHash '{codeHash}' 未查询到数据")
            return None

    def listData(self, visibleFlag: bool = True):
        # 只展示visibleFlag为True (公开且审核通过) 的数据
        # 返回 [(codeHash, rootFolderName, timeStamp), ...]
        self.database.execute("SELECT codeHash, rootFolderName, timeStamp FROM PAN123DATABASE WHERE visibleFlag=? ORDER BY timeStamp DESC", (visibleFlag,))
        return self.database.fetchall()
    
    def deleteData(self, codeHash:str):
        self.database.execute("SELECT codeHash FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
        if self.database.fetchone() is None:
            if self.debug: # 在 debug 模式下打印信息
                print(f"codeHash: {codeHash} 不存在, 不删除")
            return False # False 表示未找到，所以未删除
        self.database.execute("DELETE FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
        self.conn.commit()
        if self.debug:
            print(f"已删除 codeHash: {codeHash}")
        return True # True 表示成功删除

    def listAllDataForAdmin(self):
        # 为 admin 界面获取所有数据，稍后在 Python 中分类
        self.database.execute("SELECT codeHash, rootFolderName, shareCode, timeStamp, visibleFlag FROM PAN123DATABASE ORDER BY timeStamp DESC")
        result = []
        for codeHash, rootFolderName, shareCode, timeStamp, visibleFlag in self.database.fetchall():
            result.append((
                codeHash,
                rootFolderName,
                shareCode,
                timeStamp,
                bool(visibleFlag) if visibleFlag is not None else None # 不知道为什么，从数据库里读出来的不是bool? 还要额外转一下
                ))
        return result

    def updateVisibleFlag(self, codeHash: str, newVisibleFlag: bool):
        try:
            self.database.execute("UPDATE PAN123DATABASE SET visibleFlag=? WHERE codeHash=?", (newVisibleFlag, codeHash))
            self.conn.commit()
            if self.database.rowcount > 0:
                if self.debug:
                    print(f"已更新 codeHash: {codeHash} 的 visibleFlag 为 {newVisibleFlag}")
                return True
            else:
                if self.debug:
                    print(f"未找到 codeHash: {codeHash}，无法更新 visibleFlag")
                return False # 未找到记录
        except Exception as e:
            print(f"更新 visibleFlag 失败 (codeHash: {codeHash}): {e}")
            return False
 
    def updateRootFolderName(self, codeHash: str, newRootFolderName: str):
        try:
            self.database.execute("UPDATE PAN123DATABASE SET rootFolderName=? WHERE codeHash=?", (newRootFolderName, codeHash))
            self.conn.commit()
            if self.database.rowcount > 0:
                if self.debug:
                    print(f"已更新 codeHash: {codeHash} 的 rootFolderName 为 {newRootFolderName}")
                return True
            else:
                if self.debug:
                    print(f"未找到 codeHash: {codeHash}，无法更新 rootFolderName")
                return False # 未找到记录
        except Exception as e:
            print(f"更新 rootFolderName 失败 (codeHash: {codeHash}): {e}")
            return False

    def close(self):
        if self.conn:
            self.conn.close()

if __name__ == "__main__":
    
    db = Pan123Database(debug=False)
    
    print()
    print("--- 测试 listData (公开资源) ---")
    print()
    
    public_shares = db.listData()
    if public_shares:
        for item in public_shares:
            print(item) # (codeHash, rootFolderName, timeStamp)
    else:
        print("无公开资源")

    db.close()