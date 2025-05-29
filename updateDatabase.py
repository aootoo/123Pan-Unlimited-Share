from Pan123Database import Pan123Database
from loadSettings import loadSettings

DATABASE_PATH = loadSettings("DATABASE_PATH")

try:
    db = Pan123Database(dbpath=DATABASE_PATH)
    print("正在下载最新数据库")
    latest_db_path = db.downloadLatestDatabase()
    print("正在导入最新数据库")
    db.importDatabase(latest_db_path)
    db.close()
except Exception as e:
    print(f"数据库更新报错: {e}")