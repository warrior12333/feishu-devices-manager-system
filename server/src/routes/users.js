const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/** 成员列表。成员由企业微信通讯录同步/登录自动建档，不再支持手动添加。 */
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    res.json({ items: await db.listUsers() });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
