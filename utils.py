import hashlib
import requests
import os
import json
import yaml

# 构建AbsPath
def makeAbsPath(fullDict, parentFileId=0, debug=False):
    _parentMapping = {} # {子文件ID: 父文件夹ID}
    # 遍历所有文件夹和文件列表，记录每个文件的父文件夹ID
    for key, value in fullDict.items():
        for item in value:
            _parentMapping[item.get("FileId")] = int(key) # item.get("ParentFileId")
    if debug:
        print(f"_parentMapping: {_parentMapping}")
    # 遍历所有文件夹和文件列表，添加AbsPath
    for key, value in fullDict.items():
        for item in value:
            _absPath = str(item.get("FileId"))
            if debug:
                print(f"_absPath: {_absPath}")
                print(f"int(_absPath.split('/')[0]): {int(_absPath.split('/')[0])}")
            while _absPath.split("/")[0] != str(parentFileId):
                _absPath = f"{_parentMapping.get(int(_absPath.split('/')[0]))}/{_absPath}"
            item.update({"AbsPath": _absPath})
    return fullDict

# 对FileId和parentFileId匿名化, 同步修改AbsPath
def anonymizeId(itemsList):
    RESULT = []
    MAP_ID = {}
    count = 0
    # 第一遍: 遍历所有的item.get("FileId")(包含文件和文件夹), 构建映射表
    for item in itemsList:
        if item.get("FileId") not in MAP_ID:
            MAP_ID[item.get("FileId")] = count # 只映射不修改数据
            count += 1
        if item.get("parentFileId") not in MAP_ID: # 根目录只出现在parentFileId
            MAP_ID[item.get("parentFileId")] = count # 只映射不修改数据
            count += 1
    # 第二遍: 遍历所有的item.get("parentFileId")和item.get("AbsPath")(包含文件和文件夹), 替换为匿名化后的ID
    for item in itemsList:
        _absPath = item.get("AbsPath").split("/")
        _absPath = [str(MAP_ID[int(i)]) for i in _absPath if len(i)]
        _absPath = "/".join(_absPath)
        RESULT.append({
            "FileId": MAP_ID[item.get("FileId")],
            "FileName": item.get("FileName"),
            "Type": item.get("Type"),
            "Size": item.get("Size"),
            "Etag": item.get("Etag"),
            "parentFileId": MAP_ID[item.get("parentFileId")],
            "AbsPath": _absPath,
        })
    return RESULT

# 输入一段文本(这里是base64加密厚的字符串), 输出string的hash值
def getStringHash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

# 检查IP是否为中国大陆地区
# True: 支持 (境外IP)
# False: 不支持 (中国大陆IP)
def isAvailableRegion():
    check_ip_url = "https://ipv4.ping0.cc/geo"
    response = requests.get(check_ip_url).text
    if "中国" in response and not any(keyword in response for keyword in ["香港", "澳门", "台湾"]):
            print(f"不支持当前IP地址使用：\n\n{response}")
            return False
    else:
        print(f"当前IP地址支持使用：\n\n{response}")
        return True

def loadSettings(keyword):
    if os.path.exists("./settings.yaml"):
        with open("./settings.yaml", "r", encoding="utf-8") as f:
            data = yaml.safe_load(f.read())
        return data.get(keyword)
    else:
        print("没有发现 settings.yaml 文件, 已重新生成, 请填写参数后再运行!")
        with open("./settings.yaml", "w", encoding="utf-8") as f:
            f.write("""# 数据库的地址 (一般保持默认即可)
DATABASE_PATH: "./assets/PAN123DATABASE.db"

# 网页运行的端口
# 网页链接 http://{IP}:{PORT}/
PORT: 33333

# Telegram 爬虫参数, 如果不知道就不要动
CHANNEL_NAME: "" # 大家应该都知道是 telegram 的哪个群, 自己填入 (@xxxx的xxxx部分), GitHub不明说了
MESSAGE_AFTER_ID: 8050 # 建议从第 8050 条消息开始爬, 因为之前的内容全都失效了

# 管理员入口, 用于登录后台
# 管理页面: http://{IP}:{PORT}/{ADMIN_ENTRY}/login
ADMIN_ENTRY: "admin_abcdefg"
ADMIN_USERNAME: "admin"
ADMIN_PASSWORD: "123456"

# 密钥, 用于加密 cookies, 如果你要部署本网站, 并且开放给其他用户使用, 请务必修改
SECRET_KEY: "114514"

# 是否开启调试模式 (保持不动即可)
DEBUG: false""")
        input("按任意键结束")
        exit(0)