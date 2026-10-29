/**
 * /superadmin 隐藏超管入口的 API：
 *  - 独立账号密码（.env 的 SUPERADMIN_USER / SUPERADMIN_PASSWORD），不走企微登录；
 *  - 凭据未配置时整组接口一律 404，入口对外不存在；
 *  - 会话为独立 cookie（见 middleware/auth.js），与普通用户互不相通；
 *  - 能力：统计概览、设备 CRUD 与状态管理、借单代审批/强制归还、
 *          成员管理（企业微信通讯录同步，不支持手动添加）、
 *          系统设置（一键关闭系统）与系统公告管理。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const db = require('../db');
const feishu = require('../services/feishu');
const notify = require('../services/notify');
const { compressToJpeg } = require('../utils/image');
const { httpError, setSuperSession, clearSuperSession, requireSuper } = require('../middleware/auth');

const router = express.Router();

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) return cb(httpError(400, '仅支持 jpg / png / webp 图片'));
    cb(null, true);
  },
});

/** 压缩落盘:转 JPEG(长边1600/质量80),返回文件名 */
async function saveCompressed(buffer) {
  const buf = await compressToJpeg(buffer);
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(config.uploadDir, name), buf);
  return name;
}

const cleanStr = (v, max = 255) => String(v ?? '').trim().slice(0, max);
const fireAndForget = (p) => p.catch((e) => console.error('[notify]', e.message));

/** 凭据未配置：入口不存在，全部按 404 处理（含登录接口） */
router.use((req, res, next) => {
  if (!config.superadmin.username || !config.superadmin.password) return res.status(404).end();
  next();
});

/* ---------- 登录 / 会话 ---------- */

// 简单内存限速：每 IP 每分钟最多 5 次登录尝试
const loginAttempts = new Map();
const tooManyAttempts = (ip) => {
  const nowMs = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || nowMs > rec.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: nowMs + 60_000 });
    return false;
  }
  rec.count += 1;
  return rec.count > 5;
};

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

router.post('/login', (req, res) => {
  if (tooManyAttempts(req.ip)) throw httpError(429, '尝试过于频繁，请一分钟后再试');
  const { username, password } = req.body || {};
  const ok = safeEqual(username, config.superadmin.username) && safeEqual(password, config.superadmin.password);
  if (!ok) throw httpError(401, '账号或密码错误');
  setSuperSession(res);
  res.json({ ok: true });
});

router.post('/logout', requireSuper, (req, res) => {
  clearSuperSession(res);
  res.json({ ok: true });
});

router.get('/me', requireSuper, (_req, res) => {
  res.json({ ok: true });
});

/* ---------- 概览统计 ---------- */

router.get('/overview', requireSuper, async (_req, res, next) => {
  try {
    const one = async (sql) => {
      const [rows] = await db.pool.query(sql);
      return rows[0].c;
    };
    res.json({
      devices: {
        total: await one('SELECT COUNT(*) AS c FROM devices'),
        idle: await one("SELECT COUNT(*) AS c FROM devices WHERE status='idle'"),
        borrowed: await one("SELECT COUNT(*) AS c FROM devices WHERE status='borrowed'"),
        disabled: await one("SELECT COUNT(*) AS c FROM devices WHERE status='disabled'"),
      },
      borrows: {
        active: await one("SELECT COUNT(*) AS c FROM borrows WHERE status IN ('pending','approved','returning')"),
        pendingApproval: await one("SELECT COUNT(*) AS c FROM borrows WHERE status='pending'"),
        returning: await one("SELECT COUNT(*) AS c FROM borrows WHERE status='returning'"),
      },
      users: await one('SELECT COUNT(*) AS c FROM users'),
    });
  } catch (e) {
    next(e);
  }
});

/* ---------- 设备管理 ---------- */

/** 校验并规整设备图片列表：站内路径、最多9张；image 列 = 首图（封面） */
function parseDeviceImages(body) {
  let list = Array.isArray(body.images)
    ? body.images.map((p) => String(p || '').trim()).filter((p) => p.startsWith('/uploads/'))
    : [];
  if (!list.length && body.image && String(body.image).startsWith('/uploads/')) list = [String(body.image)];
  list = [...new Set(list)].slice(0, 9);
  return { images: JSON.stringify(list), image: list[0] || '' };
}

async function validateDeviceBody(body) {
  const data = {
    name: cleanStr(body.name, 128),
    category: cleanStr(body.category, 64) || '未分类',
    model: cleanStr(body.model, 128),
    serial_no: cleanStr(body.serial_no, 128),
    location: cleanStr(body.location, 128),
    ...parseDeviceImages(body),
    owner_userid: cleanStr(body.owner_userid, 64),
    remark: cleanStr(body.remark, 1000),
  };
  if (!data.name) throw httpError(400, '请填写设备名称');
  // 负责人（借出审批人）缺省取 .env 配置的第一位管理员
  if (!data.owner_userid) data.owner_userid = config.adminUserids[0] || '';
  if (data.owner_userid && !(await db.getUser(data.owner_userid))) throw httpError(400, '负责人不存在');
  return data;
}

router.get('/devices', requireSuper, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const { items, total } = await db.listDevices({
      keyword: cleanStr(req.query.keyword, 64),
      category: cleanStr(req.query.category, 64),
      status: cleanStr(req.query.status, 16),
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    res.json({ items, total, page, pageSize, categories: await db.listCategories() });
  } catch (e) {
    next(e);
  }
});

router.post('/devices', requireSuper, async (req, res, next) => {
  try {
    const device = await db.createDevice(await validateDeviceBody(req.body));
    res.json({ device });
  } catch (e) {
    next(e);
  }
});

router.put('/devices/:id', requireSuper, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await db.getDevice(id))) throw httpError(404, '设备不存在');
    const device = await db.updateDevice(id, await validateDeviceBody(req.body));
    res.json({ device });
  } catch (e) {
    next(e);
  }
});

/** 直接改状态（管理兜底）：borrowed 必须走借单流程；改回在库要求无进行中借单 */
router.patch('/devices/:id/status', requireSuper, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const device = await db.getDevice(id);
    if (!device) throw httpError(404, '设备不存在');
    const status = cleanStr(req.body.status, 16);
    if (!['idle', 'disabled'].includes(status)) throw httpError(400, '状态仅支持 在库 / 停用（已借出需通过借单流程）');
    if (status === 'idle' && (await db.hasActiveBorrow(id))) {
      throw httpError(400, '该设备存在进行中的借单，请先在借单管理中处理（可强制归还后删除设备）');
    }
    await db.setDeviceStatus(id, status);
    res.json({ device: await db.getDevice(id) });
  } catch (e) {
    next(e);
  }
});

/**
 * 删除设备：该设备全部借单随外键级联清除（含进行中借单，管理兜底操作）。
 */
router.delete('/devices/:id', requireSuper, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await db.getDevice(id))) throw httpError(404, '设备不存在');
    await db.deleteDevice(id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/upload', requireSuper, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, '请选择图片');
    const name = await saveCompressed(req.file.buffer);
    res.json({ url: `/uploads/${name}` });
  } catch (e) {
    next(e);
  }
});

/* ---------- 借单管理（代审批，按申请组） ---------- */

const getGroupOr404 = async (req) => {
  const group = await db.resolveBorrowGroup(Number(req.params.id));
  if (!group) throw httpError(404, '借单不存在');
  return group;
};

router.get('/borrows', requireSuper, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const status = cleanStr(req.query.status, 24);
    const days = Math.min(3650, Number(req.query.days) || 0);
    const { items, total } = await db.listBorrowGroups({
      tab: 'all',
      userid: '',
      status,
      days,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

router.post('/borrows/:id/approve', requireSuper, async (req, res, next) => {
  try {
    const group = await getGroupOr404(req);
    const fresh = await db.approveBorrowGroup(group.id, 'superadmin');
    fireAndForget(notify.borrowResultNotify(fresh, true));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

router.post('/borrows/:id/reject', requireSuper, async (req, res, next) => {
  try {
    const group = await getGroupOr404(req);
    const reason = cleanStr(req.body.reason, 200);
    if (!reason) throw httpError(400, '请填写驳回原因');
    const fresh = await db.rejectBorrowGroup(group.id, reason, 'superadmin');
    fireAndForget(notify.borrowResultNotify(fresh, false, reason));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/** 领用确认：核对领用照片后设备正式借出;待领用状态可由超管补充照片直接确认 */
router.post('/borrows/:id/claim-approve', requireSuper, async (req, res, next) => {
  try {
    const group = await getGroupOr404(req);
    const photos = group.status === 'claiming'
      ? (Array.isArray(req.body.claim_photos) ? req.body.claim_photos.filter((p) => String(p).startsWith('/uploads/')) : [])
      : null;
    const fresh = await db.confirmClaimGroup(group.id, 'superadmin', photos);
    fireAndForget(notify.claimResultNotify(fresh, true));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

router.post('/borrows/:id/return-approve', requireSuper, async (req, res, next) => {
  try {
    const group = await getGroupOr404(req);
    const fresh = await db.confirmReturnGroup(group.id, 'superadmin');
    fireAndForget(notify.returnResultNotify(fresh, true));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

router.post('/borrows/:id/return-reject', requireSuper, async (req, res, next) => {
  try {
    const group = await getGroupOr404(req);
    const reason = cleanStr(req.body.reason, 200);
    if (!reason) throw httpError(400, '请填写驳回原因');
    const fresh = await db.rejectReturnGroup(group.id, reason, 'superadmin');
    fireAndForget(notify.returnResultNotify(fresh, false, reason));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

router.post('/borrows/:id/force-return', requireSuper, async (req, res, next) => {
  try {
    const group = await getGroupOr404(req);
    const fresh = await db.forceReturnGroup(group.id, 'superadmin');
    fireAndForget(notify.returnResultNotify(fresh, true));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/* ---------- 系统设置（系统开关）与系统公告 ---------- */

router.get('/settings', requireSuper, async (_req, res, next) => {
  try {
    const status = await db.getSystemStatus();
    res.json({ systemClosed: status.closed, closeReason: status.reason });
  } catch (e) {
    next(e);
  }
});

/** 关闭系统：暂停全部新借用申请（企微端 + 外部端），归还等既有流程不受影响 */
router.put('/settings', requireSuper, async (req, res, next) => {
  try {
    const closed = Boolean(req.body.systemClosed);
    const reason = cleanStr(req.body.closeReason, 200);
    if (closed && !reason) throw httpError(400, '关闭系统时请填写关闭原因（将展示给借用用户）');
    await db.setSetting('system_closed', closed ? '1' : '0');
    await db.setSetting('system_close_reason', reason);
    res.json({ systemClosed: closed, closeReason: reason });
  } catch (e) {
    next(e);
  }
});

function validateAnnouncementBody(body) {
  const title = cleanStr(body.title, 128);
  const content = cleanStr(body.content, 2000);
  if (!title) throw httpError(400, '请填写公告标题');
  return { title, content, enabled: body.enabled === undefined ? true : Boolean(body.enabled) };
}

router.get('/announcements', requireSuper, async (_req, res, next) => {
  try {
    res.json({ items: await db.listAnnouncements(false) });
  } catch (e) {
    next(e);
  }
});

router.post('/announcements', requireSuper, async (req, res, next) => {
  try {
    const item = await db.createAnnouncement(validateAnnouncementBody(req.body));
    res.json({ announcement: item });
  } catch (e) {
    next(e);
  }
});

router.put('/announcements/:id', requireSuper, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await db.getAnnouncement(id))) throw httpError(404, '公告不存在');
    const item = await db.updateAnnouncement(id, validateAnnouncementBody(req.body));
    res.json({ announcement: item });
  } catch (e) {
    next(e);
  }
});

router.delete('/announcements/:id', requireSuper, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await db.getAnnouncement(id))) throw httpError(404, '公告不存在');
    await db.deleteAnnouncement(id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- 成员管理（企业微信通讯录同步，不支持手动添加） ---------- */

router.get('/users', requireSuper, async (_req, res, next) => {
  try {
    res.json({ items: await db.listUsers() });
  } catch (e) {
    next(e);
  }
});

/** 从飞书通讯录同步成员（全部门），新增账号并直接完成飞书绑定；不删除 */
router.post('/users/sync-wecom', requireSuper, async (_req, res, next) => {
  try {
    const list = await feishu.listDirectoryUsers();
    let bound = 0;
    let created = 0;
    let skipped = 0;
    for (const u of list) {
      // open_id 已绑定 → 跳过
      if (await db.getUserByFeishuOpenid(u.openId)) {
        skipped += 1;
        continue;
      }
      // 姓名与现有账号一致 → 绑定到该账号（同一人多平台身份打通）
      const exist = u.name ? await db.getUserByNameExact(u.name) : null;
      if (exist) {
        await db.bindFeishuOpenid(exist.userid, u.openId);
        bound += 1;
      } else if (u.name) {
        // 有姓名且是新成员 → 新建账号（userid = open_id）
        await db.upsertUser({ userid: u.openId, name: u.name, avatar: '' });
        await db.bindFeishuOpenid(u.openId, u.openId);
        created += 1;
      } else {
        // 拿不到姓名（应用缺少通讯录姓名权限）→ 跳过，等成员从飞书端登录自动建档绑定
        skipped += 1;
      }
    }
    res.json({ synced: list.length, bound, created, skipped, items: await db.listUsers() });
  } catch (e) {
    next(e);
  }
});

router.patch('/users/:userid/role', requireSuper, async (req, res, next) => {
  try {
    const userid = cleanStr(req.params.userid, 64);
    if (!(await db.getUser(userid))) throw httpError(404, '成员不存在');
    const role = cleanStr(req.body.role, 16);
    if (!['admin', 'member'].includes(role)) throw httpError(400, '角色仅支持 admin / member');
    await db.pool.query('UPDATE users SET role=? WHERE userid=?', [role, userid]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// multer 等错误统一转 JSON
router.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[superadmin]', err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

module.exports = router;
