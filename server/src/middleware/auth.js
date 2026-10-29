const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

const COOKIE_NAME = 'dmt_token';

const httpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

function setSessionCookie(res, user) {
  const token = jwt.sign({ userid: user.userid }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.baseUrl.startsWith('https://'),
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

/** 解析 JWT cookie，注入 req.user（无效则匿名）；用户每次请求实时读库，角色变更即时生效 */
async function attachUser(req, _res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      req.user = (await db.getUser(payload.userid)) || null;
    } catch {
      req.user = null;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

/* ---------- /superadmin 超管会话（独立 cookie，与企微用户体系互不相通） ---------- */

const SUPER_COOKIE_NAME = 'dmt_super_token';

const SUPER_COOKIE_OPTS = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.baseUrl.startsWith('https://'),
  maxAge: 12 * 3600 * 1000,
});

function setSuperSession(res) {
  res.cookie(SUPER_COOKIE_NAME, jwt.sign({ super: true }, config.jwtSecret, { expiresIn: '12h' }), SUPER_COOKIE_OPTS());
}

function clearSuperSession(res) {
  res.clearCookie(SUPER_COOKIE_NAME, SUPER_COOKIE_OPTS());
}

function requireSuper(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[SUPER_COOKIE_NAME] || '', config.jwtSecret);
    if (payload.super) return next();
  } catch {
    // 落到 401
  }
  res.status(401).json({ error: '未登录' });
}

/* ---------- /m 微信扫码外部借出会话（独立 cookie） ---------- */

const EXT_COOKIE_NAME = 'dmt_ext_token';

const EXT_COOKIE_OPTS = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.baseUrl.startsWith('https://'),
  maxAge: 7 * 24 * 3600 * 1000,
});

function setExternalSession(res, extUserId) {
  res.cookie(EXT_COOKIE_NAME, jwt.sign({ extId: extUserId }, config.jwtSecret, { expiresIn: '7d' }), EXT_COOKIE_OPTS());
}

function clearExternalSession(res) {
  res.clearCookie(EXT_COOKIE_NAME, EXT_COOKIE_OPTS());
}

/** 外部借出用户鉴权：解析 JWT -> external_users 行，挂到 req.extUser */
async function attachExternalUser(req, _res, next) {
  try {
    const payload = jwt.verify(req.cookies[EXT_COOKIE_NAME] || '', config.jwtSecret);
    if (payload.extId) req.extUser = await db.getExternalById(payload.extId);
  } catch {
    req.extUser = null;
  }
  next();
}

function requireExternal(req, res, next) {
  if (!req.extUser) return res.status(401).json({ error: '未登录' });
  next();
}

module.exports = {
  COOKIE_NAME,
  httpError,
  setSessionCookie,
  attachUser,
  requireAuth,
  requireAdmin,
  setSuperSession,
  clearSuperSession,
  requireSuper,
  setExternalSession,
  clearExternalSession,
  attachExternalUser,
  requireExternal,
};
