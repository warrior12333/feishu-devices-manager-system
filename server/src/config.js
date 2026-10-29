require('dotenv').config();
const path = require('path');

const env = (key, fallback = '') => process.env[key] ?? fallback;

const config = {
  port: Number(env('PORT', '3000')),
  baseUrl: env('BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  jwtSecret: env('JWT_SECRET', 'dev-secret'),
  // 逗号分隔的企业微信 userid，登录后自动授予管理员角色
  adminUserids: env('ADMIN_USERIDS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // 本地开发模式：跳过企业微信 OAuth，使用内置测试账号
  devMode: env('DEV_MODE', 'false') === 'true',
  db: {
    host: env('DB_HOST', '127.0.0.1'),
    port: Number(env('DB_PORT', '3306')),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
  },
  uploadDir: path.resolve(__dirname, '..', env('UPLOAD_DIR', './uploads')),
  // 企业微信已弃用（平台全面切换飞书）；原 WECOM_*/SUITE_* 环境变量不再读取
  // 隐藏超管入口 /superadmin 的登录凭据（独立于企微账号体系）：
  // 用户名与密码均非空时入口才启用，否则所有 /superadmin 请求按 404 处理
  superadmin: {
    username: env('SUPERADMIN_USER'),
    password: env('SUPERADMIN_PASSWORD'),
  },
  // 微信开放平台「网站应用」（企业微信之外的人员扫码借出）：
  // 开放平台后台需将授权回调域配置为部署域名；未配置时 /m 页面给出提示
  wxOpen: {
    appId: env('WX_OPEN_APPID'),
    secret: env('WX_OPEN_SECRET'),
  },
  // 飞书自建应用：与企微并行的另一平台入口（/f 免登 + 审批通知卡片）
  // 开发者后台需配置重定向地址 https://<域名>/api/feishu/callback，并开通 im:message 等权限
  feishu: {
    appId: env('FEISHU_APP_ID'),
    secret: env('FEISHU_APP_SECRET'),
  },
};

config.wxOpen.configured = Boolean(config.wxOpen.appId && config.wxOpen.secret);
config.feishu.configured = Boolean(config.feishu.appId && config.feishu.secret);

module.exports = config;
