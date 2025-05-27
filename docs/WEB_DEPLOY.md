# [123云盘](https://www.123pan.com) 无限制分享工具（服务器 `gunicorn` 部署教程）

## 目录

- [123云盘 无限制分享工具（服务器 `gunicorn` 部署教程）](#123云盘-无限制分享工具服务器-gunicorn-部署教程)
  - [目录](#目录)
  - [重要提示](#重要提示)
  - [使用宝塔面板部署（以9.6.0版本为例）](#使用宝塔面板部署以960版本为例)
    - [一、下载本项目的文件](#一下载本项目的文件)
    - [二、进入后台](#二进入后台)
    - [三、创建 `Python` 项目](#三创建-python-项目)
    - [四、配置域名、HTTPS等](#四配置域名https等)

## 重要提示

- ⚠️ 实际使用效果未知

- 例如：服务器为机房 IDC IP、服务器为高风险 IP、同一 IP 登录多个账号，导致风险提示

- 推荐在 `中国大陆` 地区的服务器上部署，避免因为境外 IP 导致登录风险提示

- 网页前端检测到用户为中国大陆 IP 时，不提供服务（虽然服务器位于中国大陆，但不对中国大陆用户提供服务，此举是为了规避潜在的风险） 

## 使用宝塔面板部署（以9.6.0版本为例）

### 一、下载本项目的文件

- 打包好的文件发布在 [GitHub Releases](https://github.com/realcwj/123Pan-Unlimited-Share/releases) 中

- 解压后，得到 `123Pan-Unlimited-Share` 文件夹，将该文件夹放在服务器中，例如：`/www/wwwroot/123Pan-Unlimited-Share`

- **重要：请务必参考文档 [123云盘无限制分享工具（配置参数）](./SETTINGS.md) 修改 `settings.yaml` 配置文件**

### 二、进入后台

- 进入：`网站` → `Python项目` → `添加Python项目`

### 三、创建 `Python` 项目

- 参数设置
  - 项目名称：`123Pan-Unlimited-Share`
  - Python环境：`Python3.12`
  - 启动方式：`gunicorn`
  - 项目端口：取决于你在 `settings.yaml` 里配置的端口
  - 项目路径：取决于本项目在服务器中的路径，例如 `/www/wwwroot/123Pan-Unlimited-Share`
  - 入口文件：选择 `/www/wwwroot/123Pan-Unlimited-Share/web.py`**（注意是 `web.py`，不是 `run.py`）**
  - 通讯协议：`wsgi`
  - 应用名称：`app`（此项不能改）
  - 环境变量：无
  - 启动用户：`www`
  - 安装依赖包：`/www/wwwroot/123Pan-Unlimited-Share/requirements.txt`
  - 项目初始化命令：不填

- 示例

  ![EXAMPLE](images/WEB_DEPLOY/example.png)

- 随后，点击确定，等待项目部署完成

### 四、配置域名、HTTPS等

- 此处不再介绍