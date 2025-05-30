import os
import yaml

def loadSettings(keyword):
    if os.path.exists("./settings.yaml"):
        with open("./settings.yaml", "r", encoding="utf-8") as f:
            data = yaml.safe_load(f.read())
        return data.get(keyword)
    else:
        print("没有发现 settings.yaml 文件, 已重新生成, 请填写参数后再运行!")
        with open("./settings.yaml", "w", encoding="utf-8") as f:
            f.write("""
# 数据库的地址 (一般保持默认即可)
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

# 日志保存目录, 一般不动
LOG_DIR: "./logs"
# 日志级别: DEBUG, INFO, WARNING, ERROR, CRITICAL
# 如果你想正常使用: 建议使用 INFO
# 服务器部署时: 推荐使用 WARNING, 避免日志文件拉屎
# 如果你想反馈 bug: 使用 DEBUG
LOGGING_LEVEL: "INFO"

# IP 地址区域限制设定
# True: 启用IP区域检测，中国大陆IP将被重定向到 /banip 页面
# False: 关闭IP区域检测，所有IP均可访问
BAN_IP: True
""")
        input("按任意键结束")
        exit(0)