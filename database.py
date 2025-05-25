import sqlite3
import os
from tqdm import tqdm

from utils import getStringHash

class Pan123Database:
    def __init__(self, dbpath="./assets/PAN123DATABASE.db", debug=False):
        self.debug = debug
        self.conn = sqlite3.connect(dbpath)
        self.database = self.conn.cursor()
        # 如果是空的, 就创建表: PUBLIC (codeHash:str (unique), rootFolderName:str, visibleFlag: bool(True, None, False), shareCode:str)
        self.database.execute("CREATE TABLE IF NOT EXISTS PAN123DATABASE (codeHash TEXT PRIMARY KEY, rootFolderName TEXT, visibleFlag BOOLEAN, shareCode TEXT)")
        self.conn.commit()
        # 导入 ./public/ok 文件夹内的所有 *.123share 文件
        self.importPublicOkFiles()

    def importPublicOkFiles(self):
        # 检查 ./public/ok 文件夹内是否存在 *.123share 文件, 如果存在, 则挨个读取, 并将其加入数据库, 随后删除该文件
        ok_path = os.path.join(os.getcwd(), "public", "ok")
        print(f"导入 {ok_path} 文件夹内的所有 *.123share 文件中")
        filenames = os.listdir(ok_path)
        filenames = [filename[:-9] for filename in filenames if filename.endswith(".123share")]
        for filename in tqdm(filenames):
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
        # visibleFlag: True: 公开, None: 公开(但是待审核), False: 私密
        if self.queryHash(codeHash) != []:
            print(f"rootFolderName: {rootFolderName}, codeHash: {codeHash} 已存在, 不插入")
            print(f"检索结果: {self.queryHash(codeHash)[0][1]}")
            return False
        # 插入数据
        self.database.execute(
            "INSERT INTO PAN123DATABASE (codeHash, rootFolderName, visibleFlag, shareCode) VALUES (?, ?, ?, ?)",
            (codeHash, rootFolderName, visibleFlag, shareCode)
            )
        self.conn.commit()
        return True

    def queryHash(self, codeHash:str):
        self.database.execute("SELECT * FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
        # 数据示例: [(codeHash, rootFolderName, visibleFlag, shareCode)]
        return self.database.fetchall()
    
    def listData(self, visibleFlag: bool=True):
        # 只展示visibleFlag为True (公开且审核通过) 的数据
        self.database.execute("SELECT * FROM PAN123DATABASE WHERE visibleFlag=?", (visibleFlag,))
        # 数据示例: [(codeHash, rootFolderName, visibleFlag, shareCode), ...]
        return self.database.fetchall()
    
    def deleteData(self, codeHash:str):
        if self.queryHash(codeHash) == []:
            print(f"codeHash: {codeHash} 不存在, 不删除")
            return False
        self.database.execute("DELETE FROM PAN123DATABASE WHERE codeHash=?", (codeHash,))
        self.conn.commit()
        return True

    def close(self):
        self.conn.close()

if __name__ == "__main__":
    db = Pan123Database()
    [print(i[1]) for i in db.listData()]
    db.close()