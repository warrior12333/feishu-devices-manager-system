# 企业微信设备管理应用（设备借还管理系统）

基于**企业微信自建应用**的设备资产管理 H5：设备台账（含图片与二维码）、设备借出申请与负责人审批、拍照归还与归还确认，全部审批在应用内完成，并通过企业微信应用消息卡片通知相关人员。

## 功能清单

| 模块 | 说明 |
| --- | --- |
| 设备管理 | 管理员新增/修改/删除设备（名称、分类、型号、序列号、存放位置、负责人、图片上传）；每台设备生成二维码，企业微信扫码直达设备详情 |
| 申请借出 | 首页「申请设备借出」→ 按分类列表选择设备（显示分类/状态标签文字，已借出不可选）→ 填写借出事由、归还日期、现场拍照 → 提交 |
| 借出审批 | 系统通过应用消息卡片通知**设备负责人**，审批人在 H5 内查看照片与信息后一键通过/驳回（驳回需填原因），结果推送借出人 |
| 设备归还 | 借出人拍照发起归还 → 通知**该借单的审批人**核对照片确认；驳回可重新发起归还；确认后设备自动回库 |
| 我的借还 | 借出人查看全部记录、状态与逾期提醒；审批中心区分「待我审批 / 已处理」，Tabbar 角标显示待办数 |
| 系统管理 | 隐藏超管入口 `/superadmin`（独立账号密码）：概览统计、设备/借单/成员管理、系统公告（发布/启停/删除，启用中的公告展示在各端首页顶部）、系统开关（一键关闭系统：暂停新借用申请并向用户展示关闭原因） |
| 外部借出 | 微信扫码 `/m` 免登录借用：登记班级、姓名、学号与**手机号（必填，11 位校验）**后走统一审批流程；同一学号自动续接历史借单，老用户缺手机号时引导补填 |

借单状态机：

```
待审批(pending) ──通过──> 使用中(approved) ──归还申请──> 归还待确认(returning) ──确认──> 已归还(returned)
      │                        │  ↑                            │
      └──驳回──> 已驳回(rejected)│  └────── 归还驳回(回退使用中) ──┘
                                 └─ 归还驳回(return_rejected) 仍需归还，可重新发起
```

## 技术栈

- 后端：Node.js + Express 4 + SQLite（better-sqlite3，**已预留 MySQL**：SQL 全部集中在 `server/src/db.js` 并全部参数绑定，切换见下文）
- 前端：Vue 3 + Vite + Vant 4（移动端 H5，适配企业微信内置浏览器）
- 企微对接：网页授权（snsapi_base）获取用户身份、access_token 内存缓存、应用消息卡片推送
- 安全：服务端出站请求统一 SSRF 防护（仅允许 `https://qyapi.weixin.qq.com`，拒绝环回/私有/保留地址）；上传白名单校验；JWT httpOnly 会话；SQL 全参数绑定

## 目录结构

```
wecom-device-manager/
├── server/                  # Express 后端
│   ├── src/
│   │   ├── index.js         # 入口：API + 静态托管 web/dist
│   │   ├── config.js        # .env 配置
│   │   ├── db.js            # 全部 SQL（参数绑定），MySQL 预留切换点
│   │   ├── schema.mysql.sql # MySQL 建表脚本（预留）
│   │   ├── services/wecom.js    # 企微 API（token/OAuth/消息）
│   │   ├── services/notify.js   # 审批通知（落库 + 推送）
│   │   ├── utils/http.js    # SSRF 防护出站封装
│   │   ├── middleware/auth.js   # JWT 会话/权限
│   │   └── routes/          # auth / users / devices / borrows / upload
│   ├── scripts/e2e.mjs      # 端到端流程测试
│   └── uploads/             # 图片存储
└── web/                     # Vue3 + Vite + Vant 前端
    └── src/views/           # Home / SelectDevice / BorrowApply / DeviceDetail
                             # DeviceEdit / MyBorrows / ApprovalList / ApprovalDetail
```

## 本地开发（无需企业微信配置）

```bash
# 1. 安装依赖（首次安装 better-sqlite3 若预编译包下载失败，见下方「常见问题」）
npm run setup

# 2. 配置（server/.env 已提供开发默认值：DEV_MODE=true）
#    开发模式内置三个测试账号：张三zhangsan(管理员)、李四lisi、王五wangwu
#    .env 中 ADMIN_USERIDS=zhangsan 使张三自动成为管理员

# 3a. 一体化运行（前端构建产物由后端 3000 端口托管）
npm run build
npm start
# 打开 http://localhost:3000

# 3b. 或前端热更新开发（5173 端口，已配置 /api /uploads 代理到 3000）
npm run dev:server        # 终端1
npm run dev:web           # 终端2
# 打开 http://localhost:5173

# 4. 端到端接口测试（需服务已启动、DEV_MODE）
cd server && node scripts/e2e.mjs
```

DEV_MODE 下未登录访问任意页面会跳转到开发登录页选择测试账号；生产环境（`DEV_MODE=false` 且企微已配置）自动走企业微信网页授权。

## 上线配置

### 对接方式 B：开发者中心「网页应用」（个人开发者 / 第三方，参考官方文档 38246）

适用：没有企业后台管理权限、或希望以个人开发者身份把应用提供给企业（成员扫码安装；**每个应用最多被 10 个企业、100 个用户安装，可信域名必须已完成 ICP 备案**）。服务端已内置该模式的全部回调接口，表单逐项填写如下（`你的域名` = 已备案的 HTTPS 域名，与 `.env` 的 `BASE_URL` 一致）：

| 表单项 | 填写内容 | 说明 |
| --- | --- | --- |
| 应用主页 | `https://你的域名/` | 工作台点开应用进入的页面（带协议头） |
| 桌面端独立主页 | `https://你的域名/` 或留空 | 桌面端入口，留空则同应用主页 |
| 可信域名（OAuth2+JS-SDK） | `你的域名` | **不带协议头**；配置时需下载域名归属校验文件放入 `web/dist/` 后重新 build |
| 可信域名（仅 JS-SDK） | 可不填 | 本应用未用 JS-SDK，无需配置 |
| 安装完成回调域名 | `你的域名` | 不带协议头、不支持 IP；安装成功后企微带 `auth_code` 跳转该域名，服务端自动换取授权入库 |
| 业务设置URL | `https://你的域名/` 或留空 | 管理员从后台跳转配置的入口 |
| 数据回调URL | `https://你的域名/api/wecom/callback/data` | 服务端已实现验签+解密，当前仅应答确认 |
| 指令回调URL | `https://你的域名/api/wecom/callback/command` | 服务端已实现；接收每 10 分钟推送的 `suite_ticket` 并入库 |
| Token | 自行生成一串随机字符串 | **与 `.env` 的 `WECOM_CALLBACK_TOKEN` 完全一致** |
| EncodingAESKey | 点击随机生成或自行生成（43 位） | **与 `.env` 的 `WECOM_CALLBACK_AES_KEY` 完全一致** |

同时在 `server/.env` 补充（凭据只放环境变量，不要写入代码）：

```ini
SUITE_ID=开发者中心应用详情中的 SuiteId
SUITE_SECRET=开发者中心应用详情中的 Secret
WECOM_CALLBACK_TOKEN=与表单 Token 一致
WECOM_CALLBACK_AES_KEY=与表单 EncodingAESKey 一致
```

生成示例：

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"                                   # Token
node -e "console.log(require('crypto').randomBytes(32).toString('base64').slice(0,43))"                    # EncodingAESKey
```

**安装与生效流程**：保存配置 → 企微每 10 分钟向指令回调推送 `suite_ticket`（日志/`corp_config` 表可见）→ 成员扫码安装 → 企微 302 到安装完成回调域名并携带 `auth_code` → 服务端自动经 `get_permanent_code` 完成授权入库 → 该企业的 corpid/agentid 生效，OAuth 登录与消息推送自动切换到已安装企业（优先级高于自建应用配置）。

> 说明：本应用数据层按单企业设计。若多个企业先后安装，后安装企业的授权会覆盖前一个（`corp_config` 单行），业务数据共用同一套库——如需真正的多租户隔离需要额外改造。

### 对接方式 A：企业微信管理后台「自建应用」（有企业管理员权限时优先）

#### 1. 创建自建应用

管理后台（work.weixin.qq.com）→ 应用管理 → 应用 → 自建 → 创建应用，记录：

- **AgentId** → `WECOM_AGENT_ID`
- **Secret** → `WECOM_SECRET`
- 企业信息 → 我的企业 → 企业 ID → `WECOM_CORP_ID`

#### 2. 配置网页授权可信域名

应用主页 → 开发者接口 → 网页授权及 JS-SDK：

- 填写你的**公网 HTTPS 域名**（与 `BASE_URL` 一致，不带 https:// 前缀）
- 按提示下载域名归属校验文件 `WW_verify_xxxx.txt`，放到 `web/dist/` 目录后重新 `npm run build`（或配置 Nginx 直接托管该文件），确保 `https://你的域名/WW_verify_xxxx.txt` 可访问
- 应用可信 IP：填入部署服务器的公网出口 IP（2022-06 后新建自建应用强制要求，见官方文档「开发前必读」）

#### 3. 配置应用主页

应用主页 URL 填 `https://你的域名/`，成员在企微工作台点开即用；设备二维码内容同样指向该域名。

#### 4. 服务端 `.env`

```ini
PORT=3000
BASE_URL=https://你的域名
JWT_SECRET=一段随机长字符串
DEV_MODE=false
ADMIN_USERIDS=管理员的企业微信userid,可多个
WECOM_CORP_ID=ww....
WECOM_AGENT_ID=1000002
WECOM_SECRET=....
```

#### 5. 部署

```bash
npm run setup && npm run build && npm start   # 或用 pm2 守护：pm2 start server/src/index.js
```

建议 Nginx 反代 3000 端口并终止 TLS。成员首次访问即自动建档；管理员可在「设备编辑 → 负责人 → 添加成员」手动录入尚未登录过的成员（审批人）。

## 消息通知

所有审批节点通过企业微信「应用消息-文本卡片」通知，点击卡片直达对应页面：

| 事件 | 接收人 |
| --- | --- |
| 借出申请 | 设备负责人（借单审批人） |
| 借出通过/驳回 | 借出人 |
| 归还申请 | 该借单的审批人 |
| 归还确认/驳回 | 借出人 |

消息同时落库 `message_log`（审计）；未配置企微或 DEV_MODE 下仅落库不发送。

## 数据库与 MySQL 迁移预留

当前为 SQLite（零配置，文件在 `server/data/app.db`，WAL 模式）。所有 SQL 集中在 `server/src/db.js`，业务代码只调用其导出函数；`schema.mysql.sql` 提供字段一致的 MySQL 建表脚本。切换步骤：

1. `server/package.json` 增加 `mysql2`，移除 `better-sqlite3`
2. `db.js` 换成 mysql2 连接池，把同步函数改为 async（SQL 语句基本可原样保留，仅 DDL 与 upsert 语法按 `schema.mysql.sql` 调整）
3. 路由层调用处补 `await`

## 常见问题

- **better-sqlite3 安装失败**（Windows 无 VS 构建工具且预编译包下载失败）：使用国内镜像
  `npm config set better_sqlite3_binary_host_mirror https://registry.npmmirror.com/-/binary/better-sqlite3` 后重装
- **企微打开白屏/跳转失败**：核对 `BASE_URL` 与可信域名完全一致、校验文件可访问、服务器出口 IP 在应用可信 IP 列表
- **收不到审批通知**：审批人必须在应用可见范围内；查看 `message_log` 表的 `sent/error` 字段定位
