/**
 * 会话接口：/me（当前用户 + 待办数）、/logout。
 * 登录统一走飞书：/api/feishu/login（OAuth）与 /api/feishu/code-login（客户端内免登）。
 */
const express = require('express');
const config = require('../config');
const db = require('../db');
const { COOKIE_NAME, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { userid, name, avatar, role } = req.user;
    res.json({
      user: { userid, name, avatar, role },
      pendingApprovals: await db.countPendingApproval(req.user.userid),
      devMode: config.devMode,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

module.exports = router;
