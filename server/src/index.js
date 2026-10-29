const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db'); // 引入即完成建库建表（SQLite）
const { attachUser } = require('./middleware/auth');
const DEV_USERS = require('./dev-users');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(attachUser);

// 上传图片静态托管
fs.mkdirSync(config.uploadDir, { recursive: true });
app.use(
  '/uploads',
  express.static(config.uploadDir, {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/devices', require('./routes/devices'));
app.use('/api/borrows', require('./routes/borrows'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/meta', require('./routes/meta'));
app.use('/api/superadmin', require('./routes/superadmin'));
app.use('/api/external', require('./routes/external'));
app.use('/api/feishu', require('./routes/feishu-auth'));
app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

// 前端构建产物（生产模式：单进程同时提供 API 与页面）
const webDist = path.resolve(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  // 带 hash 的静态资源可长缓存；HTML 必须实时更新，否则发版后浏览器拿旧页面
  app.use(
    express.static(webDist, {
      maxAge: '1d',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.get('*', (req, res) => {
    // 安装完成回调域名若填的是根域名，企微会 302 到 /?auth_code=...，转发到安装处理
    if (req.query.auth_code) {
      return res.redirect(302, `/api/wecom/installed?auth_code=${encodeURIComponent(req.query.auth_code)}`);
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDist, 'index.html'));
  });
} else {
  app.get('*', (_req, res) =>
    res
      .type('html')
      .send('<h3>前端尚未构建</h3><p>请先执行 <code>npm --prefix web run build</code>，或开发模式下运行 <code>npm run dev:web</code>（5173 端口，已配置代理）。</p>')
  );
}

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err && err.name === 'MulterError') {
    err.status = 400;
    err.message = `上传失败：${err.message}`;
  }
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

// 等数据库表结构就绪后再监听（MySQL 版）
(async () => {
  await db.ready;
  if (config.devMode) {
    for (const u of DEV_USERS) await db.upsertUser(u);
  }
  app.listen(config.port, () => {
    console.log(`设备管理服务已启动: ${config.baseUrl}`);
    console.log(`  模式: ${config.devMode ? 'DEV（开发登录）' : '飞书网页授权'}`);
    console.log(`  数据库: MySQL ${config.db.host}:${config.db.port}/${config.db.database}`);
    console.log(`  飞书应用: ${config.feishu.configured ? '已配置' : '未配置（/f 登录与通知不可用）'}`);
  });
})().catch((err) => {
  console.error('[fatal] 启动失败:', err);
  process.exit(1);
});
