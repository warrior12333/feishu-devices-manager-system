/**
 * 飞书端登录（/f 入口）：
 *  - GET /api/feishu/login     → 302 飞书 OAuth 授权页（未配置时给出提示页）
 *  - GET /api/feishu/callback  → code 换 open_id，按 身份绑定 规则入库并发会话
 *
 *  身份绑定规则（飞书与企微是两套身份体系，需打通到同一 users 账号）：
 *   1. open_id 已绑定 → 直接登录该账号；
 *   2. 未绑定但飞书姓名与现有用户姓名一致 → 自动绑定（同一人以飞书身份登录）；
 *   3. 都找不到 → 新建账号（userid = open_id，普通成员角色）。
 */
const express = require('express');
const config = require('../config');
const db = require('../db');
const feishu = require('../services/feishu');
const { setSessionCookie } = require('../middleware/auth');

const router = express.Router();

/** 仅接受站内相对路径，防止开放跳转 */
const safeNext = (raw) => {
  const v = typeof raw === 'string' ? decodeURIComponent(raw) : '';
  return v.startsWith('/') && !v.startsWith('//') ? v : '/';
};

/** 身份绑定：open_id 已绑定 → 直接登录；姓名精确匹配 → 自动绑定；否则新建账号 */
async function bindOrCreateUser(info) {
  let user = await db.getUserByFeishuOpenid(info.openId);
  if (!user && info.name) user = await db.getUserByNameExact(info.name);
  if (user) {
    user = await db.bindFeishuOpenid(user.userid, info.openId);
  } else {
    // 新账号：userid 直接用飞书 open_id（应用内唯一）；飞书管理员用超管控制台授予角色
    user = await db.upsertUser({ userid: info.openId, name: info.name || '飞书用户', avatar: info.avatar });
    user = await db.bindFeishuOpenid(user.userid, info.openId);
  }
  if (!user) throw Object.assign(new Error('登录账号创建失败'), { status: 500 });
  return user;
}

function loginCookies(res, user) {
  setSessionCookie(res, user);
  // 标记登录来源平台：会话过期 401 时前端据此跳飞书（非 httpOnly，仅前端可读）
  res.cookie('feishu_login', '1', {
    maxAge: 7 * 24 * 3600 * 1000,
    sameSite: 'lax',
    secure: config.baseUrl.startsWith('https://'),
  });
}

router.get('/login', (req, res) => {
  const next = req.query.next || '/';
  if (!config.feishu.configured) {
    return res.status(404).type('html').send(
      '<meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:60px 20px;color:#666">管理员未配置飞书应用</body>'
    );
  }
  res.redirect(feishu.buildOAuthUrl(safeNext(next)));
});

router.get('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) throw Object.assign(new Error('缺少授权 code'), { status: 400 });
    const info = await feishu.getUserInfoByCode(code);
    const user = await bindOrCreateUser(info);
    loginCookies(res, user);
    res.redirect(safeNext(state));
  } catch (e) {
    next(e);
  }
});

/** 飞书客户端内 H5 JSAPI 免登：返回 h5sdk.config 所需签名参数 */
router.get('/config', async (req, res, next) => {
  try {
    if (!config.feishu.configured) throw Object.assign(new Error('管理员未配置飞书应用'), { status: 404 });
    // 签名用当前页面 URL（不含 # 及其后部分）
    const pageUrl = String(req.query.url || '').slice(0, 512);
    if (!/^https?:\/\//.test(pageUrl)) throw Object.assign(new Error('缺少页面 URL'), { status: 400 });
    res.json(await feishu.makeH5Signature(pageUrl));
  } catch (e) {
    next(e);
  }
});

/** 飞书客户端内 H5 免登登录：tt.requestAccess 的 code 换身份并发会话 */
router.post('/code-login', async (req, res, next) => {
  try {
    if (!config.feishu.configured) throw Object.assign(new Error('管理员未配置飞书应用'), { status: 404 });
    const code = String(req.body.code || '').trim();
    if (!code) throw Object.assign(new Error('缺少免登 code'), { status: 400 });
    const info = await feishu.getUserInfoByH5Code(code);
    const user = await bindOrCreateUser(info);
    loginCookies(res, user);
    res.json({ ok: true, user: { userid: user.userid, name: user.name, role: user.role } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
