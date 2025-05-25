import sqlite3
import os
from tqdm import tqdm # 虽然不再导入文件，但如果Pan123类中某些部分可能仍用tqdm，保留导入无妨

from utils import getStringHash # 假设 getStringHash 存在于 utils.py

class Pan123Database:
    def __init__(self, dbpath="./assets/PAN123DATABASE.db", debug=False):
        self.debug = debug
        # 确保数据库目录存在
        db_dir = os.path.dirname(dbpath)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
            
        self.conn = sqlite3.connect(dbpath, check_same_thread=False) # 为Flask添加 check_same_thread=False
        self.database = self.conn.cursor()
        # 如果是空的, 就创建表:
        # PAN123DATABASE (
        #   codeHash TEXT PRIMARY KEY, -- 分享内容（长码base64）的SHA256哈希值，作为短分享码
        #   rootFolderName TEXT,      -- 用户指定的分享根目录名
        #   visibleFlag BOOLEAN,      -- True: 公开可见（通过公共列表），False: 私有短码（不公开），None: 待审核（加入共享计划）
        #   shareCode TEXT,           -- 完整的分享码（即长码base64）
        #   timeStamp DATETIME DEFAULT CURRENT_TIMESTAMP -- 数据插入时间
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
        self.importPublicOkFiles()

    def importPublicOkFiles(self):
        # 检查 ./public/ok 文件夹内是否存在 *.123share 文件, 如果存在, 则挨个读取, 并将其加入数据库, 随后删除该文件
        ok_path = os.path.join(os.getcwd(), "public", "ok")
        print(f"导入 {ok_path} 文件夹内的所有 *.123share 文件中")
        filenames = os.listdir(ok_path)
        filenames = [filename[:-9] for filename in filenames if filename.endswith(".123share")]
        for filename in filenames:
            with open(os.path.join(ok_path, f"{filename}.123share"), "r") as f:
                filedata = f.read().strip("\n").strip() # 去除换行和空格 (文件只有一行, 这个是确定的)
            codeHash = getStringHash(filedata)
            shareCode = filedata
            rootFolderName = filename
            self.insertData(codeHash, rootFolderName, True, shareCode)
            if self.debug:
                print(f"导入 {filename}.123share 文件, rootFolderName: {rootFolderName}, codeHash: {codeHash}")
            # os.remove(f"./public/ok/{filename}.123share")

    def insertData(self, codeHash:str, rootFolderName:str, visibleFlag:bool, shareCode:str):
        # visibleFlag: True: 公开, None: 公开(但是待审核), False: 私密 (仅生成短码，不加入公共列表)
        try:
            # 检查 codeHash 是否已存在
            self.database.execute(
                "SELECT rootFolderName FROM PAN123DATABASE WHERE codeHash=?",
                (codeHash,)
                )
            existing_entry = self.database.fetchone()
            if existing_entry:
                if self.debug:
                    print(f"短分享码 (codeHash): {codeHash} 已存在, 对应的根目录名: {existing_entry[0]}. 不重复插入.")
                return True # 返回 Ture 表示已存在，虽然插入失败但是不影响后续操作
            
            # 插入数据
            self.database.execute(
                "INSERT INTO PAN123DATABASE (codeHash, rootFolderName, visibleFlag, shareCode) VALUES (?, ?, ?, ?)",
                (codeHash, rootFolderName, visibleFlag, shareCode)
            )
            self.conn.commit()
            if self.debug:
                print(f"成功插入数据: codeHash={codeHash}, rootFolderName={rootFolderName}, visibleFlag={visibleFlag}")
            return True # 返回 True 表示插入成功
        except sqlite3.IntegrityError: # 捕获唯一约束冲突，尽管前面已经检查过，但作为双重保险
            print(f"插入数据失败: 短分享码 (codeHash): {codeHash} 已存在 (完整性错误).")
            return False
        except Exception as e:
            print(f"插入数据失败, 原因: {e}")
            return False

    def queryHash(self, codeHash:str):
        self.database.execute(
            "SELECT codeHash, rootFolderName, visibleFlag, shareCode, timeStamp FROM PAN123DATABASE WHERE codeHash=?",
            (codeHash,)
            )
        # 返回单条记录或 None
        return self.database.fetchone()

    def queryName(self, rootFolderName:str):
        self.database.execute(
            "SELECT codeHash, rootFolderName, visibleFlag, shareCode, timeStamp FROM PAN123DATABASE WHERE rootFolderName=?",
            (rootFolderName,)
            )
        return self.database.fetchone()

    def getDataByHash(self, codeHash: str):
        self.database.execute(
            "SELECT rootFolderName, shareCode, visibleFlag FROM PAN123DATABASE WHERE codeHash=?",
            (codeHash,)
            )
        result = self.database.fetchone()
        if result:
            if self.debug:
                print(f"通过 codeHash '{codeHash}' 查询到数据: rootFolderName='{result[0]}', visibleFlag={result[2]}")
            return result
        else:
            if self.debug:
                print(f"通过 codeHash '{codeHash}' 未查询到数据")
            return None

    def listData(self, visibleFlag: bool = True):
        # 只展示visibleFlag为True (公开且审核通过) 的数据
        # 返回 [(codeHash, rootFolderName), ...]
        self.database.execute("SELECT codeHash, rootFolderName FROM PAN123DATABASE WHERE visibleFlag=? ORDER BY timeStamp DESC", (visibleFlag,))
        return self.database.fetchall()
    
    def deleteData(self, codeHash:str):
        self.database.execute("SELECT codeHash FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
        if self.database.fetchone() is None:
            print(f"codeHash: {codeHash} 不存在, 不删除")
            return False
        self.database.execute("DELETE FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
        self.conn.commit()
        if self.debug:
            print(f"已删除 codeHash: {codeHash}")
        return True

    def close(self):
        if self.conn:
            self.conn.close()

if __name__ == "__main__":
    
    db = Pan123Database(debug=True)
    
    print()
    print("--- 测试 listData (公开资源) ---")
    print()
    
    public_shares = db.listData()
    if public_shares:
        for item in public_shares:
            print(item)
    else:
        print("无公开资源")

    db.close()