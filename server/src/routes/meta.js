/**
 * /api/meta 公开元信息（无需登录）：
 *  - 系统开关（超管在控制台关闭系统后，前端展示提示并停用借用入口）；
 *  - 启用中的系统公告（企微端首页与外部借用页共用）。
 */
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/status', async (_req, res, next) => {
  try {
    const [status, announcements] = await Promise.all([
      db.getSystemStatus(),
      db.listAnnouncements(true),
    ]);
    res.json({
      systemClosed: status.closed,
      closeReason: status.reason || '',
      announcements,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
