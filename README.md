# 📦 isoziyuan-pan (爱搜云盘 · Serverless 极速网盘与取件码系统)

[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-f38020?logo=cloudflare&logoColor=white)](https://pan.ailxw.com)
[![Cloudflare R2](https://img.shields.io/badge/Storage-Cloudflare%20R2-F6821F?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/r2/)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare%20D1-184D66?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个基于 **Cloudflare Pages + D1 数据库 + R2 / AWS S3 双对象存储引擎** 构建的现代化轻量级私有网盘与文件提取码分发系统。

- 🚀 **在线访问（文件提取）**：[https://pan.ailxw.com](https://pan.ailxw.com)
- 备用访问：[https://isoziyuan-pan.pages.dev](https://isoziyuan-pan.pages.dev)
- 源码仓库：[yys9253462-gif/isoziyuan-pan](https://github.com/yys9253462-gif/isoziyuan-pan)

---

## 🌟 核心功能特性

### 1. 📬 极简 5 位取件码提取体系
- 仿蜂巢/快递柜的 **5 位数字提取码** 体验，支持键盘逐格自动跳焦、支持直接粘贴整段取件码。
- 支持分享链接直达（如 `/pickup/12345`），进入即自动解析并下载。
- 分享规则高度可控：支持配置**到期时间**、**最大下载次数（阅后即焚 / 限次下载）**或**永久有效**。

### 2. 💽 双对象存储引擎（R2 + AWS S3）
- 原生整合 **Cloudflare R2**（全球零出网流量费，高性价比）。
- 扩展支持 **AWS S3** 或任何 S3 兼容协议，支持按存储策略分流或灾备。
- 大文件直传（Presigned PUT URL）：上传与下载流量均由客户端直连对象存储，**不占用 Cloudflare Functions CPU 额度**。

### 3. 🛡️ 现代化可视化后台面板（`/admin.html`）
- 文件夹层级组织、批量文件上传、重命名、移动与删除。
- 一键生成提取码与公开分享链接。
- 多维度流量与用量监控，清晰掌握本月存储字节数与下载频次。
- 安全保障：基于 PBKDF2 / 环境变量密码鉴权，支持会话安全 Cookie 与失效管理。

### 4. ⚡ 纯 Serverless 零维护架构
- 无需购买任何传统 VPS 服务器，零服务器运维开销。
- 全球 Anycast CDN 秒级下发，高并发弹性扩缩容。

---

## 📂 项目结构说明

```text
├── index.html                  # 公开取件码提取首页（5 位数跳焦提取表单）
├── pickup.html                 # 取件成功/下载中转落地页
├── admin.html                  # 云盘管理员控制面板（多级文件夹、文件管理、分享码生成）
├── style.css                   # 全局现代拟态深色质感样式表
├── functions/                  # Cloudflare Pages Edge Functions 核心中枢
│   ├── _lib.js                 # 通用安全、D1 ORM 封装与工具库
│   ├── aws.js                  # AWS S3 兼容协议签名与客户端直连调度
│   ├── storage.js              # 存储路由与存储桶抽象层
│   ├── api/                    # RESTful API 接口群
│   │   ├── auth/               # 管理员登录校验与会话生成
│   │   ├── files.js            # 文件/目录列表分页查询
│   │   ├── upload-url.js       # 获取大文件直传预签名 URL
│   │   ├── upload-complete.js  # 文件上传完成回调与 D1 元数据落库
│   │   ├── download.js         # 鉴权下载链接签发
│   │   ├── share.js            # 5 位取件码生成与有效性校验
│   │   ├── delete.js           # 文件/目录级联删除
│   │   └── folder.js           # 文件夹新建与路径管理
│   └── pickup/
│       └── [code].js           # `/pickup/:code` 动态提取路由解析
├── schema.sql                  # D1 SQLite 数据库建表文件
├── migration-aws.sql           # AWS S3 扩展表结构迁移文件
├── wrangler.jsonc              # Cloudflare Wrangler 配置文件（D1 + R2 绑定）
├── 一键发布到Cloudflare.bat     # Windows 本地自动化一键 Git 提交 + 生产直推脚本
└── README.md                   # 项目说明文档
```

---

## 🛠️ 部署指南

### 前置要求
- 一个 [Cloudflare 账号](https://dash.cloudflare.com/)；
- 本地安装 Node.js 与 Wrangler CLI（可选，用于本地命令行部署）：
  ```bash
  npm install -g wrangler
  npx wrangler login
  ```

---

### 第一步：创建 D1 数据库与初始化

1. 在命令行中创建 D1 数据库：
   ```bash
   npx wrangler d1 create isoziyuan-pan-db
   ```
   记录返回的 `database_id`，替换项目根目录下 `wrangler.jsonc` 中的对应值。

2. 执行数据库初始化脚本：
   ```bash
   npx wrangler d1 execute isoziyuan-pan-db --remote --file schema.sql
   ```
   （若需要使用 AWS S3 作为备用存储，可额外执行 `npx wrangler d1 execute isoziyuan-pan-db --remote --file migration-aws.sql`）

---

### 第二步：创建 Cloudflare R2 存储桶

1. 在 Cloudflare 控制台进入 **R2 Object Storage** → **Create bucket**：
   - 存储桶名称推荐为：`forum-uploads`（或自定义名称并在 `wrangler.jsonc` 中同步修改）。
2. 在 `wrangler.jsonc` 中确认绑定关系：
   ```jsonc
   "r2_buckets": [
     {
       "binding": "R2",
       "bucket_name": "你的存储桶名称"
     }
   ]
   ```

---

### 第三步：配置环境变量与后台密码（Secrets）

在 Cloudflare Pages 项目的 **Settings → Environment variables → Production** 中添加以下密钥：

| 变量名 | 必填 | 说明 |
| :--- | :--- | :--- |
| `ADMIN_PASSWORD` | **是** | 管理员登录密码（务必妥善保存） |
| `ADMIN_USERNAME` | 否 | 管理员账号（默认为 `admin`） |
| `SESSION_SECRET` | 否 | 会话加密密钥（建议设置长随机字符串） |
| `AWS_ACCESS_KEY_ID` | 否 | 可选，如需接入外部 AWS S3 存储时配置 |
| `AWS_SECRET_ACCESS_KEY` | 否 | 可选，AWS S3 对应密钥 |
| `AWS_REGION` | 否 | 可选，如 `us-east-1` |
| `AWS_BUCKET` | 否 | 可选，AWS S3 目标存储桶名称 |

---

### 第四步：部署上线

#### 方式 A：Windows 本地双击一键发布（推荐）
在本地修改或配置完成后，直接鼠标双击运行根目录下的 **`一键发布到Cloudflare.bat`**：
- 自动检测变更；
- 自动提交并 push 到 GitHub；
- 自动编译并直推 Cloudflare Pages 边缘节点，全球即时刷新生效！

#### 方式 B：通过 Wrangler 命令行部署
```bash
npx wrangler pages deploy . --project-name isoziyuan-pan --branch main
```

---

## 🔒 安全建议

1. **防爆破机制**：提取码仅为 5 位数字，适合短期便利分发；重要私密文件建议设置**较短的过期时间（例如 24 小时）**或**限制下载次数**。
2. **密钥保密**：严禁将 `ADMIN_PASSWORD` 或云存储 AccessKey 提交至公开 Git 仓库，必须全部注入 Cloudflare Pages 的 Encrypted Environment Variables（加密环境变量）中。

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 协议开源，欢迎自由使用、修改与学习！
