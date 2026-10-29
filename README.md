# 飞书设备借还管理系统（feishu-devices-manager-system）

基于**飞书自建应用**的设备资产管理 H5：设备台账（含多图与二维码）、设备借出申请与负责人审批、拍照领用与归还确认，全部审批在应用内完成，并通过飞书互动卡片消息通知相关人员。

> 由企业微信版本迁移而来：登录（OAuth 网页授权）、消息通知（应用消息卡片）、成员同步（通讯录）已全面切换到飞书；企业微信之外的人员通过 `/m` 免登录登记借用。

## 功能清单

| 模块 | 说明 |
| --- | --- |
| 设备管理 | 管理员新增/修改/删除设备（名称、分类、型号、序列号、存放位置、负责人、多图上传）；每台设备生成二维码，扫码直达设备详情 |
| 申请借出 | 首页「申请设备借出」→ 按分类选择设备（一次可多台）→ 填写借出事由、归还日期 → 提交 |
| 借出审批 | 飞书卡片通知**设备负责人**，审批人在 H5 内通过/驳回（驳回需填原因）；通过后进入「待领用」，借出人拍照领用 → 审批人核对确认后设备置借出（管理员可代确认/补拍） |
| 设备归还 | 借出人拍照发起归还 → 通知**该借单的审批人**核对照片确认；驳回可重新发起归还；确认后设备自动回库；管理员可强制归还（兜底） |
| 我的借还 | 借出人查看全部记录、状态与逾期提醒；审批中心区分「待我审批 / 已处理」，Tabbar 角标显示待办数 |
| 系统管理 | 隐藏超管入口 `/superadmin`（独立账号密码）：概览统计、设备/借单/成员管理、系统公告（发布/启停/删除，各端首页顶部 5 秒轮播）、系统开关（一键关闭系统：暂停新借用申请并向用户展示关闭原因） |
| 外部借出 | `/m` 免登录借用：登记班级、姓名、学号与**手机号（必填，11 位校验）**后走统一审批流程；同一学号自动续接历史借单，老用户缺手机号时引导补填 |

借单状态机：

```
待审批(pending) ─通过→ 待领用(claiming) ─拍照→ 领用待确认(claim_confirming) ─确认→ 使用中(approved)
      │                  │  ↑驳回重拍                        │                     │ 归还申请
      │                  └─ 管理员可直接代确认 ─────────────────┘                     ▼
      │                                                归还待确认(returning) ─确认→ 已归还(returned)
      └驳回→ 已驳回(rejected)                           归还驳回(return_rejected) 可重新发起归还
```

## 技术栈

- 后端：Node.js + Express 4 + **MySQL**（mysql2 连接池；SQL 全部集中在 `server/src/db.js` 并全部参数绑定；DATETIME 以字符串返回，前端免时区换算）
- 前端：Vue 3 + Vite + Vant 4（移动端 H5，适配飞书内置浏览器与手机浏览器）
- 飞书对接：OAuth 网页授权登录（`passport.feishu.cn`）、`tenant_access_token` 内存缓存、互动卡片消息（`im/v1/messages`）、通讯录同步、jsapi_ticket（H5 JSAPI 鉴权）
- 安全：服务端出站请求统一 SSRF 防护（域名白名单 + DNS 解析拒绝环回/私有/保留地址）；上传类型白名单 + 压缩；JWT httpOnly 会话（普通用户 / 超管 / 外部人员三套独立 cookie）；SQL 全参数绑定

## 快速开始（部署教程）

从零到跑通，只需 5 步。前提：一台有公网 IP 的 Linux 服务器、已安装 Node.js ≥ 18 与 MySQL 5.7+/8.0、一个解析到服务器的 HTTPS 域名。

### 第 1 步：拉取代码并安装依赖

```bash
git clone git@github.com:warrior12333/feishu-devices-manager-system.git
cd feishu-devices-manager-system
npm run setup        # = 安装 server 与 web 两端依赖
```

### 第 2 步：创建数据库

```bash
mysql -uroot -p -e "CREATE DATABASE device_manager DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci"
# 建议单独建账号：
mysql -uroot -p -e "CREATE USER 'dm'@'localhost' IDENTIFIED BY '强密码'; GRANT ALL ON device_manager.* TO 'dm'@'localhost'"
```

表结构无需手动导入——服务首次启动时自动建表，后续版本的新字段也会自动增量迁移。

### 第 3 步：配置 .env

```bash
cp server/.env.example server/.env
vim server/.env
```

最少要改这几项（完整说明见下文「上线配置」）：

```ini
BASE_URL=https://你的域名        # 公网 HTTPS 域名，与飞书重定向 URL 一致
JWT_SECRET=一段随机长字符串      # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DB_USER=dm
DB_PASSWORD=强密码
DB_NAME=device_manager
DEV_MODE=true                    # 先用 true 体验，上线前改 false
# 上线飞书登录时补充：
SUPERADMIN_USER=superadmin       # 超管控制台 /superadmin 登录账号
SUPERADMIN_PASSWORD=随机长密码
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=******
```

### 第 4 步：构建前端并启动

```bash
npm run build        # 生成 web/dist，由后端静态托管
npm start            # 监听 3000 端口
# 生产建议 pm2 守护：
#   npm i -g pm2 && pm2 start server/src/index.js --name device-manager && pm2 save
```

此时打开 `http://服务器IP:3000`：`DEV_MODE=true` 下可用内置测试账号（张三/管理员）体验完整流程；`/superadmin` 可进超管控制台。确认没问题后，配 Nginx + HTTPS：

```nginx
server {
    listen 443 ssl;
    server_name 你的域名;
    # ssl_certificate / ssl_certificate_key 按你的证书填写

    client_max_body_size 25m;                 # 设备图片上传
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 第 5 步：对接飞书（启用正式登录）

1. 打开[飞书开发者后台](https://open.feishu.cn) → 创建**企业自建应用**，把 **App ID / App Secret** 填入 `.env` 的 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
2. 应用后台 → 安全设置 → 重定向 URL：添加 `https://你的域名/api/feishu/callback`
3. 权限管理：开通「获取用户基本信息」「以应用身份发消息（im:message）」「通讯录读取」
4. 网页应用 → 主页地址填 `https://你的域名/f`（工作台点开免登直达）
5. 创建版本并**发布**（权限发布后才生效）
6. 把 `.env` 改成 `DEV_MODE=false`，`pm2 restart device-manager`

成员从飞书工作台打开应用即可自动建档登录。第一个管理员二选一：

- `.env` 的 `ADMIN_USERIDS` 填该成员的飞书 open_id（逗号分隔多个），重启生效；
- 或先登录系统，再用 `/superadmin` 超管控制台 →「成员管理」里直接把他设为管理员。

### 验证清单

- [ ] 打开 `https://你的域名/f` 能跳飞书授权并登录成功
- [ ] 首页能新增设备、上传图片、看到公告轮播
- [ ] 提交借用申请，审批人的飞书能收到卡片消息
- [ ] `/m` 用手机号登记后可发起外部借用
- [ ] `/superadmin` 能登录并切换「系统开关」

## 目录结构

```
feishu-devices-manager-system/
├── server/                  # Express 后端
│   ├── src/
│   │   ├── index.js         # 入口：API + 静态托管 web/dist
│   │   ├── config.js        # .env 配置
│   │   ├── db.js            # 全部 SQL（参数绑定）+ 启动自动建表/加列迁移
│   │   ├── schema.mysql.sql # MySQL 建表脚本（参考）
│   │   ├── dev-users.js     # DEV_MODE 内置测试账号
│   │   ├── services/
│   │   │   ├── feishu.js    # 飞书 API（OAuth/token/卡片消息/通讯录）
│   │   │   └── notify.js    # 审批通知（落库 + 飞书卡片推送）
│   │   ├── utils/http.js    # SSRF 防护出站封装
│   │   ├── utils/image.js   # 图片压缩
│   │   ├── middleware/auth.js   # JWT 会话/权限（用户/超管/外部 三套）
│   │   └── routes/          # auth / users / devices / borrows / upload
│   │                        # meta(公告+系统开关) / external(/m 外部借用)
│   │                        # feishu-auth(登录) / superadmin(超管控制台)
│   ├── scripts/
│   │   ├── e2e.mjs                    # 端到端流程测试
│   │   └── migrate-sqlite-to-mysql.js # 旧版 SQLite 数据迁移 MySQL
│   └── uploads/             # 图片存储
└── web/                     # Vue3 + Vite + Vant 前端
    └── src/views/           # Home / SelectDevice / BorrowApply / DeviceDetail
                             # DeviceEdit / MyBorrows / ApprovalList / ApprovalDetail
                             # ExternalHome / ExternalSelect / ExternalApply (/m)
                             # FeishuEntry (/f) / SuperAdmin (/superadmin 控制台)
```

## 本地开发（无需飞书配置，需本地 MySQL）

```bash
# 1. 安装依赖
npm run setup

# 2. 准备数据库并配置 server/.env
mysql> CREATE DATABASE device_manager DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;
#    .env 最少配置：DB_USER / DB_PASSWORD / DB_NAME（表结构启动时自动创建）

# 3a. 一体化运行（前端构建产物由后端 3000 端口托管）
npm run build
npm start
# 打开 http://localhost:3000

# 3b. 或前端热更新开发（5173 端口，已配置 /api /uploads 代理到 3000）
npm run dev:server        # 终端1
npm run dev:web           # 终端2
# 打开 http://localhost:5173

# 4. 端到端接口测试（需服务已启动、DEV_MODE=true）
cd server && node scripts/e2e.mjs
```

`DEV_MODE=true` 时跳过飞书登录，内置三个测试账号（登录页直接选择）：

- 张三 `zhangsan`（管理员，`.env` 的 `ADMIN_USERIDS` 授予）
- 李四 `lisi`、王五 `wangwu`（成员）

生产环境（`DEV_MODE=false` 且飞书已配置）访问任意页面自动跳飞书授权。

## 上线配置

### 1. 飞书自建应用

[飞书开发者后台](https://open.feishu.cn) → 创建**企业自建应用**，记录：

- **App ID** → `FEISHU_APP_ID`
- **App Secret** → `FEISHU_APP_SECRET`

应用后台需要配置：

| 配置项 | 填写内容 | 说明 |
| --- | --- | --- |
| 安全设置 → 重定向 URL | `https://你的域名/api/feishu/callback` | OAuth 回调地址，必须与之一致 |
| 权限管理 | 获取用户基本信息、`im:message`（以应用身份发消息）、通讯录读取 | 登录、消息卡片、超管同步成员分别需要 |
| 网页应用 → 主页 | `https://你的域名/f` | 工作台点开进入，免登直达 |
| 版本管理与发布 | 创建版本并发布 | 权限与可见范围在发布后生效 |

### 2. 服务端 `.env`

```ini
# ===== 基础 =====
PORT=3000
BASE_URL=https://你的域名          # 与飞书重定向 URL 的域名一致
JWT_SECRET=一段随机长字符串
DEV_MODE=false

# ===== MySQL =====
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=device_manager
DB_PASSWORD=******
DB_NAME=device_manager

# ===== 管理员 =====
# 飞书 userid（open_id），逗号分隔；这些用户登录后自动拥有管理员角色
# 也可不配，由超管控制台「成员管理」中直接调整角色
ADMIN_USERIDS=

# ===== 隐藏超管入口 /superadmin（独立账号密码，与飞书账号无关）=====
# 两项均非空时入口才启用；留空则 /superadmin 返回 404（入口不存在）
SUPERADMIN_USER=superadmin
SUPERADMIN_PASSWORD=请改成随机长密码

# ===== 飞书自建应用 =====
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=******

# ===== 微信扫码借出 /m（可选，未配置时 /m 直接填写信息即可借用）=====
WX_OPEN_APPID=
WX_OPEN_SECRET=
```

> 说明：`WECOM_*` / `SUITE_*` 等企业微信相关变量已弃用，服务端不再读取。

### 3. 部署

```bash
npm run setup && npm run build && npm start
# 或 pm2 守护：pm2 start server/src/index.js --name device-manager
```

建议 Nginx 反代 3000 端口并终止 TLS。成员首次从飞书打开即自动建档绑定 `open_id`；管理员也可在超管控制台「成员管理 → 从飞书同步成员」批量拉取通讯录建档。

**旧版 SQLite 数据迁移**：`cd server && node scripts/migrate-sqlite-to-mysql.js`（历史版本升级用，表结构由启动时的 `ensureSchema` 自动创建与增量迁移）。

## 超管控制台（/superadmin）

独立账号密码登录（`SUPERADMIN_USER` / `SUPERADMIN_PASSWORD`），与飞书账号体系互不相通，凭据未配置时入口对外不存在（404）。能力：

- **概览**：设备/借单/成员统计
- **设备管理**：新增、编辑、删除设备；状态切换（在库/停用）
- **借单管理**：代审批（通过/驳回）、领用确认、归还确认/驳回、强制归还；按状态与时间筛选
- **成员管理**：从飞书通讯录同步成员（自动绑定 open_id）、调整管理员/成员角色
- **系统设置**：
  - 系统开关：一键关闭系统，暂停两端新借用申请（关闭原因必填，展示给用户），归还等既有流程不受影响
  - 系统公告：发布/编辑/启停/删除公告，启用中的公告在企微端首页与外部借用页顶部每 5 秒轮播，点击查看全部

## 消息通知

所有审批节点通过飞书「互动卡片消息」通知，点击卡片直达对应页面：

| 事件 | 接收人 |
| --- | --- |
| 借出申请 | 设备负责人（借单审批人） |
| 借出通过/驳回 | 借出人 |
| 领用拍照 | 该借单的审批人 |
| 领用确认/驳回 | 借出人 |
| 归还申请 | 该借单的审批人 |
| 归还确认/驳回 | 借出人 |

消息同时落库 `message_log`（审计）。**用户必须在飞书内打开应用登录一次**（或由超管同步通讯录）完成 `open_id` 绑定后才能收到通知；未绑定的账号仅落库不发送。

## 外部借出（/m）

面向没有飞书账号的人员（如学生借用相机等设备）：

- 打开 `/m` 直接填写**班级、姓名、学号、手机号**完成登记，无需任何登录
- 学号是身份键：同一学号再次填写自动续接历史借单（换浏览器也可查看）；**手机号必填**，11 位格式校验，本功能上线前登记的老用户会被引导补填
- 借单以 `borrower_type='wechat'`、`borrower_userid='ext:<id>'` 入库，审批、领用、归还流程与飞书端完全一致
- 超管控制台借单管理中可区分查看

## 常见问题

- **飞书登录跳转失败 / 授权报错**：核对开发者后台「重定向 URL」与 `BASE_URL` 拼出的回调地址完全一致（`https://域名/api/feishu/callback`）
- **收不到审批通知**：接收人需已绑定飞书（在飞书打开过应用，或超管已同步通讯录）；应用需已发布且具备 `im:message` 权限；可查 `message_log` 表的 `sent/error` 字段定位
- **启动报数据库连接失败**：核对 `.env` 的 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`，确认 MySQL 可达且账号有建表权限（首次启动自动建表）
- **工作台打开白屏**：确认已执行 `npm run build`（后端托管 `web/dist`），飞书「网页应用主页」填的是 `/f` 且域名 HTTPS 可访问
