# Feishu Devices Manager System

English | [简体中文](./README.zh-CN.md)

A device asset management H5 app built on a **Feishu (Lark) custom app**: device inventory (multi-image + QR codes), borrow requests with owner approval, photo-based device pickup and return confirmation. The entire approval flow happens in-app, with Feishu interactive card messages notifying the people involved.

> Migrated from an earlier WeCom (Enterprise WeChat) version: login (OAuth web authorization), message notifications (app message cards) and member sync (directory) now run entirely on Feishu. People outside Feishu can borrow via `/m` with a simple registration form.

## Features

| Module | Description |
| --- | --- |
| Device management | Admins create/edit/delete devices (name, category, model, serial number, location, owner, multi-image upload); each device gets a QR code that opens its detail page on scan |
| Borrow request | "Apply to borrow" on the home page → pick devices by category (multiple per request) → fill in reason and expected return date → submit |
| Borrow approval | A Feishu card notifies the **device owner**; the approver approves/rejects in the H5 (reject requires a reason). After approval the request enters "awaiting pickup": the borrower takes pickup photos → approver confirms and devices become "in use" (admins can confirm or re-shoot on the borrower's behalf) |
| Device return | The borrower submits return photos → the approver of that order verifies and confirms; a rejection lets the borrower re-submit; confirmation puts devices back in stock; admins can force-return as a fallback |
| My borrows | Borrowers see all their records, statuses and overdue reminders; the approval center separates "pending my approval / handled", tab bar badge shows the to-do count |
| System admin | Hidden super-admin entry `/superadmin` (separate account & password): overview stats, device/order/member management, announcements (publish/enable/delete, 5-second carousel on every home page) and a system switch (one click to close the system: new borrow requests are paused and the close reason is shown to users) |
| External lending | `/m` requires no login: register class, name, student ID and **phone number (required, 11-digit check)**, then follow the same approval flow; the same student ID resumes previous orders, and legacy users without a phone are guided to add one |

Borrow order state machine:

```
Pending(pending) ──approve──> Awaiting Claim(claiming) ──claim photos──> Claim Confirming(claim_confirming) ──confirm──> In Use(approved)
   │                              │   ^ reject, re-shoot                       │                                       │ return request
   │                              └─ admin may confirm directly ───────────────┘                                       ▼
   │                                                                                       Returning(returning) ──confirm──> Returned(returned)
   └─reject→ Rejected(rejected)                                                   Return rejected(return_rejected), re-submission allowed
```

## Tech Stack

- Backend: Node.js + Express 4 + **MySQL** (mysql2 connection pool; all SQL lives in `server/src/db.js` with full parameter binding; DATETIME values are returned as strings so the frontend needs no timezone conversion)
- Frontend: Vue 3 + Vite + Vant 4 (mobile H5, works in the Feishu built-in browser and mobile browsers)
- Feishu integration: OAuth web authorization (`passport.feishu.cn`), in-memory `tenant_access_token` cache, interactive card messages (`im/v1/messages`), directory sync, jsapi_ticket (H5 JSAPI)
- Security: all outbound server requests go through an SSRF guard (host allowlist + DNS resolution rejecting loopback/private/reserved addresses); upload MIME whitelist + compression; JWT httpOnly sessions (three independent cookies: user / super-admin / external user); fully parameterized SQL

## Quick Start (Deployment Guide)

Zero to running in 5 steps. Prerequisites: a Linux server with a public IP, Node.js ≥ 18 and MySQL 5.7+/8.0 installed, and an HTTPS domain resolving to the server.

### Step 1: Clone and install

```bash
git clone git@github.com:warrior12333/feishu-devices-manager-system.git
cd feishu-devices-manager-system
npm run setup        # = install dependencies for both server and web
```

### Step 2: Create the database

```bash
mysql -uroot -p -e "CREATE DATABASE device_manager DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci"
# Recommended: a dedicated account
mysql -uroot -p -e "CREATE USER 'dm'@'localhost' IDENTIFIED BY 'strong-password'; GRANT ALL ON device_manager.* TO 'dm'@'localhost'"
```

No need to import table schemas — the server creates all tables on first start, and new columns in future versions are migrated automatically.

### Step 3: Configure `.env`

```bash
cp server/.env.example server/.env
vim server/.env
```

Minimum changes (full reference in "Production Configuration" below):

```ini
BASE_URL=https://your.domain        # public HTTPS domain, must match the Feishu redirect URL
JWT_SECRET=a-long-random-string     # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DB_USER=dm
DB_PASSWORD=strong-password
DB_NAME=device_manager
DEV_MODE=true                       # keep true while evaluating; set false for production
# Add when enabling Feishu login:
SUPERADMIN_USER=superadmin          # login for the /superadmin console
SUPERADMIN_PASSWORD=another-random-string
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=******
```

### Step 4: Build the frontend and start

```bash
npm run build        # produces web/dist, served by the backend
npm start            # listens on port 3000
# For production, keep it alive with pm2:
#   npm i -g pm2 && pm2 start server/src/index.js --name device-manager && pm2 save
```

Open `http://SERVER_IP:3000`: with `DEV_MODE=true` you can use the built-in test accounts (Zhang San / admin) to try the whole flow, and `/superadmin` opens the admin console. Once satisfied, put Nginx + HTTPS in front:

```nginx
server {
    listen 443 ssl;
    server_name your.domain;
    # ssl_certificate / ssl_certificate_key per your certificate

    client_max_body_size 25m;                 # device image uploads
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Step 5: Connect Feishu (enable real login)

1. Open the [Feishu Open Platform](https://open.feishu.cn) → create a **custom app (enterprise)**, and fill its **App ID / App Secret** into `FEISHU_APP_ID` / `FEISHU_APP_SECRET` in `.env`
2. App console → Security settings → Redirect URLs: add `https://your.domain/api/feishu/callback`
3. Permissions: enable "Get basic user info", "Send messages as the app (im:message)" and "Read directory"
4. Web app → Homepage: `https://your.domain/f` (opens from the Feishu workbench with auto login)
5. Create a version and **publish** (permissions only take effect after release)
6. Set `DEV_MODE=false` in `.env`, then `pm2 restart device-manager`

Members who open the app from the Feishu workbench are registered and logged in automatically. To create the first admin, either:

- put that member's Feishu open_id into `ADMIN_USERIDS` in `.env` (comma separated) and restart; or
- log in first, then use the `/superadmin` console → "Members" to promote them.

### Verification checklist

- [ ] `https://your.domain/f` redirects to Feishu authorization and logs in successfully
- [ ] Devices can be created on the home page, images upload, the announcement carousel shows
- [ ] Submitting a borrow request delivers a card message to the approver's Feishu
- [ ] `/m` registration (with phone number) allows an external borrow request
- [ ] `/superadmin` logs in and can toggle the "system switch"

## Directory Structure

```
feishu-devices-manager-system/
├── server/                  # Express backend
│   ├── src/
│   │   ├── index.js         # entry: API + serves web/dist statically
│   │   ├── config.js        # .env configuration
│   │   ├── db.js            # all SQL (parameterized) + auto table creation / column migration on boot
│   │   ├── schema.mysql.sql # MySQL schema (reference)
│   │   ├── dev-users.js     # DEV_MODE built-in test accounts
│   │   ├── services/
│   │   │   ├── feishu.js    # Feishu APIs (OAuth / token / card messages / directory)
│   │   │   └── notify.js    # approval notifications (persist + Feishu card push)
│   │   ├── utils/http.js    # SSRF-guarded outbound HTTP
│   │   ├── utils/image.js   # image compression
│   │   ├── middleware/auth.js   # JWT sessions/permissions (user / super / external)
│   │   └── routes/          # auth / users / devices / borrows / upload
│   │                        # meta (announcements + system switch) / external (/m)
│   │                        # feishu-auth (login) / superadmin (admin console)
│   ├── scripts/
│   │   ├── e2e.mjs                    # end-to-end API test
│   │   └── migrate-sqlite-to-mysql.js # legacy SQLite → MySQL migration
│   └── uploads/             # image storage
└── web/                     # Vue3 + Vite + Vant frontend
    └── src/views/           # Home / SelectDevice / BorrowApply / DeviceDetail
                             # DeviceEdit / MyBorrows / ApprovalList / ApprovalDetail
                             # ExternalHome / ExternalSelect / ExternalApply (/m)
                             # FeishuEntry (/f) / SuperAdmin (/superadmin console)
```

## Local Development (no Feishu config needed, requires local MySQL)

```bash
# 1. Install dependencies
npm run setup

# 2. Prepare the database and configure server/.env
mysql> CREATE DATABASE device_manager DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;
#    .env minimum: DB_USER / DB_PASSWORD / DB_NAME (tables are created automatically on start)

# 3a. All-in-one run (backend on port 3000 serves the built frontend)
npm run build
npm start
# open http://localhost:3000

# 3b. Or frontend hot-reload dev (port 5173, /api and /uploads proxied to 3000)
npm run dev:server        # terminal 1
npm run dev:web           # terminal 2
# open http://localhost:5173

# 4. End-to-end API test (server running, DEV_MODE=true)
cd server && node scripts/e2e.mjs
```

With `DEV_MODE=true` the Feishu login is skipped and three built-in test accounts are available (pick one on the login page):

- Zhang San `zhangsan` (admin, granted via `ADMIN_USERIDS` in `.env`)
- Li Si `lisi` and Wang Wu `wangwu` (members)

In production (`DEV_MODE=false` with Feishu configured) every page redirects to Feishu authorization.

## Production Configuration

### 1. Feishu custom app

[Feishu Open Platform](https://open.feishu.cn) → create a **custom app (enterprise)**, and record:

- **App ID** → `FEISHU_APP_ID`
- **App Secret** → `FEISHU_APP_SECRET`

Configure in the app console:

| Item | Value | Notes |
| --- | --- | --- |
| Security settings → Redirect URL | `https://your.domain/api/feishu/callback` | OAuth callback, must match exactly |
| Permissions | Get basic user info, `im:message` (send as app), read directory | Needed by login, card messages and member sync respectively |
| Web app → Homepage | `https://your.domain/f` | Opens from the workbench with auto login |
| Version management | Create a version and release | Permissions take effect only after release |

### 2. Server `.env`

```ini
# ===== basics =====
PORT=3000
BASE_URL=https://your.domain          # must match the Feishu redirect URL domain
JWT_SECRET=a-long-random-string
DEV_MODE=false

# ===== MySQL =====
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=device_manager
DB_PASSWORD=******
DB_NAME=device_manager

# ===== admins =====
# Feishu userids (open_id), comma separated; these users become admins on login.
# Alternatively manage roles in the super-admin console.
ADMIN_USERIDS=

# ===== hidden super-admin entry /superadmin (independent credentials) =====
# Enabled only when both values are non-empty; otherwise /superadmin returns 404
SUPERADMIN_USER=superadmin
SUPERADMIN_PASSWORD=change-me-to-a-random-long-password

# ===== Feishu custom app =====
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=******

# ===== WeChat QR lending /m (optional; without it /m is simply a form) =====
WX_OPEN_APPID=
WX_OPEN_SECRET=
```

> Note: WeCom-related variables (`WECOM_*` / `SUITE_*`) are deprecated and no longer read by the server.

### 3. Deployment

```bash
npm run setup && npm run build && npm start
# or keep alive with pm2: pm2 start server/src/index.js --name device-manager
```

Nginx reverse proxy with TLS termination is recommended. Members are registered automatically the first time they open the app from Feishu; admins can also bulk-sync the directory in the super-admin console ("Members → Sync from Feishu").

**Legacy SQLite migration**: `cd server && node scripts/migrate-sqlite-to-mysql.js` (for upgrading from the old version; schemas are created and migrated incrementally by `ensureSchema` at startup).

## Super-Admin Console (/superadmin)

Separate account & password (`SUPERADMIN_USER` / `SUPERADMIN_PASSWORD`), independent from Feishu accounts; when the credentials are unset the entry does not exist externally (404). Capabilities:

- **Overview**: device/order/member statistics
- **Devices**: create, edit, delete; status switching (in stock / disabled)
- **Orders**: act on behalf of approvers (approve/reject), claim confirmation, return confirm/reject, force return; filter by status and time
- **Members**: sync from the Feishu directory (binds open_id automatically), toggle admin/member roles
- **System settings**:
  - System switch: one click to close the system, pausing new borrow requests on both ends (a close reason is required and shown to users); returns and other in-flight flows are unaffected
  - Announcements: publish/edit/enable/disable/delete; enabled announcements carousel every 5 seconds at the top of both home pages, click to see all

## Message Notifications

Every approval step sends a Feishu **interactive card message**, deep-linking to the right page:

| Event | Recipient |
| --- | --- |
| Borrow request | Device owner (order approver) |
| Approved / rejected | Borrower |
| Pickup photos submitted | Order approver |
| Claim confirmed / rejected | Borrower |
| Return request | Order approver |
| Return confirmed / rejected | Borrower |

Messages are also stored in `message_log` for auditing. **A user must open the app inside Feishu once** (or be synced by an admin) to bind their `open_id` before notifications can be delivered; unbound users are only recorded, not notified.

## External Lending (/m)

For people without a Feishu account (e.g. students borrowing cameras):

- Open `/m` and register with **class, name, student ID and phone number** — no login of any kind
- The student ID is the identity key: re-entering the same ID resumes previous orders (even from another browser); the **phone number is required** with an 11-digit format check, and legacy users registered before this rule are guided to add one
- Orders are stored with `borrower_type='wechat'` and `borrower_userid='ext:<id>'`, then follow exactly the same approve → claim → return flow
- Visible in the super-admin console's order management

## FAQ

- **Feishu login fails / authorization error**: make sure the "Redirect URL" in the developer console matches the callback built from `BASE_URL` exactly (`https://domain/api/feishu/callback`)
- **No notifications received**: the recipient must have a bound Feishu identity (opened the app in Feishu, or synced by an admin); the app must be released with `im:message` permission; check the `sent/error` columns of `message_log`
- **Database connection error on start**: verify `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` in `.env`; MySQL must be reachable and the account needs CREATE privileges (tables are created on first boot)
- **Blank page from the workbench**: make sure `npm run build` has been executed (the backend serves `web/dist`), the Feishu web-app homepage points to `/f`, and the domain is reachable over HTTPS
