/**
 * /m 外部人员借出（企业微信之外，无需微信登录）：
 *  - 打开页面直接填写借出人信息（班级、姓名、学号、手机号）即可借用；
 *  - 学号是身份键：同一学号再次填写自动关联历史借单；
 *  - 会话为独立 cookie（7 天）；借单 borrower_type='wechat'，
 *    borrower_userid='ext:<external_users.id>'，审批走统一流程。
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const db = require('../db');
const { compressToJpeg } = require('../utils/image');
const { httpError, setExternalSession, clearExternalSession, attachExternalUser, requireExternal } = require('../middleware/auth');

const router = express.Router();

router.use(attachExternalUser);

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

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 9;

/** 校验并规整照片列表：全部为站内路径、至少 MIN_PHOTOS 张 */
function parsePhotos(raw, label) {
  const list = Array.isArray(raw) ? raw.map((p) => String(p || '').trim()).filter((p) => p.startsWith('/uploads/')) : [];
  if (list.length < MIN_PHOTOS) {
    throw httpError(400, `请至少拍摄 ${MIN_PHOTOS} 张${label}（当前 ${list.length} 张）`);
  }
  return [...new Set(list)].slice(0, MAX_PHOTOS);
}

/** 校验并规整学籍信息（手机号为外部借出必填项） */
function parseProfile(body) {
  const class_name = cleanStr(body.className, 64);
  const student_name = cleanStr(body.studentName, 64);
  const student_no = cleanStr(body.studentNo, 32);
  const phone = cleanStr(body.phone, 20);
  if (!class_name) throw httpError(400, '请填写班级');
  if (!student_name) throw httpError(400, '请填写姓名');
  if (!/^[0-9]{6,15}$/.test(student_no)) throw httpError(400, '学号格式不正确（例：24137020806）');
  if (!/^1[3-9]\d{9}$/.test(phone)) throw httpError(400, '请填写正确的11位手机号');
  return { class_name, student_name, student_no, phone };
}

const publicView = (u) => ({
  bound: Boolean(u?.bound_at),
  className: u?.class_name || '',
  studentName: u?.student_name || '',
  studentNo: u?.student_no || '',
  phone: u?.phone || '',
});

/* ---------- 登记 / 会话 ---------- */

router.get('/me', (req, res) => {
  res.json({ user: req.extUser ? publicView(req.extUser) : null });
});

/**
 * 填写学籍信息完成登记（无需微信登录）：
 *  - 学号已存在：复用该记录（更新班级/姓名），续接历史借单；
 *  - 学号不存在：新建记录，openid 以匿名随机值占位保持唯一约束。
 */
router.post('/register', async (req, res, next) => {
  try {
    const profile = parseProfile(req.body || {});
    let user = await db.getExternalByStudentNo(profile.student_no);
    if (user) {
      user = await db.bindExternalUser(user.id, profile);
    } else {
      user = await db.createExternalUser({ openid: `anon:${crypto.randomBytes(16).toString('hex')}`, ...profile });
    }
    setExternalSession(res, user.id);
    res.json({ user: publicView(user) });
  } catch (e) {
    next(e);
  }
});

/** 已登记人员修改学籍信息 */
router.post('/bind', requireExternal, async (req, res, next) => {
  try {
    const profile = parseProfile(req.body || {});
    const user = await db.bindExternalUser(req.extUser.id, profile);
    res.json({ user: publicView(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/auth/logout', (req, res) => {
  clearExternalSession(res);
  res.json({ ok: true });
});

/** 管理员列表（外部申请页选审批人用） */
router.get('/approvers', requireExternal, async (_req, res, next) => {
  try {
    const users = await db.listUsers();
    const admins = users.filter((u) => u.role === 'admin').map((u) => ({ userid: u.userid, name: u.name || u.userid }));
    const extra = config.adminUserids.filter((id) => !admins.some((a) => a.userid === id));
    res.json({ items: [...admins, ...extra.map((id) => ({ userid: id, name: id }))] });
  } catch (e) {
    next(e);
  }
});

/** 校验审批人：仅限管理员；未选择时默认全部管理员 */
async function parseApprovers(raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 20);
  for (const id of ids) {
    const u = await db.getUser(id);
    if (!u || u.role !== 'admin') throw httpError(400, `「${id}」不是管理员，不能作为审批人`);
  }
  if (ids.length) return ids;
  return [...new Set([...(await db.listAdmins()), ...config.adminUserids])];
}

/* ---------- 设备与借出 ---------- */

/** 仅列出在库设备（外部人员视角） */
router.get('/devices', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const { items, total } = await db.listDevices({
      keyword: cleanStr(req.query.keyword, 64),
      category: cleanStr(req.query.category, 64),
      status: 'idle',
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    res.json({ items, total, page, pageSize, categories: await db.listCategories() });
  } catch (e) {
    next(e);
  }
});

/** 单台在库设备（选设备页预勾选 / 申请表单回显） */
router.get('/devices/:id', async (req, res, next) => {
  try {
    const device = await db.getDevice(Number(req.params.id));
    if (!device) throw httpError(404, '设备不存在');
    if (device.status !== 'idle') throw httpError(400, `「${device.name}」当前不可借用`);
    res.json({ device });
  } catch (e) {
    next(e);
  }
});

router.post('/upload', requireExternal, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, '请选择图片');
    const name = await saveCompressed(req.file.buffer);
    res.json({ url: `/uploads/${name}` });
  } catch (e) {
    next(e);
  }
});

router.post('/borrows', requireExternal, async (req, res, next) => {
  try {
    if (!req.extUser.bound_at) throw httpError(403, '请先填写借出人信息（班级、姓名、学号）');
    // 手机号强制补填：本功能上线前登记的老用户若无手机号，须先补充再借用
    if (!req.extUser.phone) throw httpError(403, '请先补充手机号后再申请借用');
    // 系统关闭（超管在控制台切换）：暂停新借用申请，归还等既有流程不受影响
    const sys = await db.getSystemStatus();
    if (sys.closed) throw httpError(403, sys.reason ? `系统已关闭，暂停借用申请：${sys.reason}` : '系统已关闭，暂停借用申请');
    // 多设备一次申请（与企微端一致）；兼容旧版单设备字段 device_id
    const ids = Array.isArray(req.body.device_ids)
      ? req.body.device_ids.map(Number).filter(Boolean)
      : [Number(req.body.device_id)].filter(Boolean);
    if (!ids.length) throw httpError(400, '请选择要借出的设备');
    if (ids.length > 20) throw httpError(400, '单次申请最多 20 台设备');
    if (new Set(ids).size !== ids.length) throw httpError(400, '设备列表存在重复');
    const devices = [];
    for (const id of ids) {
      const device = await db.getDevice(id);
      if (!device) throw httpError(404, `设备 DEV-${String(id).padStart(4, '0')} 不存在`);
      if (device.status !== 'idle') throw httpError(400, `「${device.name}」当前不可借用`);
      devices.push(device);
    }
    const owners = [...new Set(devices.map((d) => d.owner_userid))];
    if (owners.length > 1) throw httpError(400, '所选设备负责人不一致，请分开申请');
    if (!owners[0]) throw httpError(400, '该设备暂未开放借用');

    const reason = String(req.body.reason || '').trim();
    const returnDate = String(req.body.expect_return_date || '').trim();
    if (!reason) throw httpError(400, '请填写借出事由');
    if (reason.length > 500) throw httpError(400, '借出事由不能超过500字');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) throw httpError(400, '请选择归还日期');
    const today = db.nowStr().slice(0, 10);
    if (returnDate < today) throw httpError(400, '归还日期不能早于今天');
    const approverUserids = await parseApprovers(req.body.approver_userids);

    const group = await db.createBorrowGroup({
      device_ids: ids,
      borrower_userid: db.extUserId(req.extUser.id),
      borrower_type: 'wechat',
      reason,
      expect_return_date: returnDate,
      borrow_photo: '[]',
      approver_userids: JSON.stringify(approverUserids),
      approver_userid: approverUserids[0],
    });
    const notify = require('../services/notify');
    fireAndForget(notify.borrowApplyNotify(group));
    res.json({ borrow: group });
  } catch (e) {
    next(e);
  }
});

/** 我的借单（外部人员，按申请组） */
router.get('/borrows', requireExternal, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const { items, total } = await db.listBorrowGroups({
      tab: 'mine',
      userid: db.extUserId(req.extUser.id),
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

/** 借单详情（仅本人申请组） */
router.get('/borrows/:id', requireExternal, async (req, res, next) => {
  try {
    const group = await db.resolveBorrowGroup(Number(req.params.id));
    if (!group) throw httpError(404, '借单不存在');
    if (group.borrower_userid !== db.extUserId(req.extUser.id)) throw httpError(403, '无权查看该借单');
    res.json({ borrow: group });
  } catch (e) {
    next(e);
  }
});

/** 领用设备（借出人拍照提交，至少3张） */
router.post('/borrows/:id/claim', requireExternal, async (req, res, next) => {
  try {
    const group = await db.resolveBorrowGroup(Number(req.params.id));
    if (!group) throw httpError(404, '借单不存在');
    if (group.borrower_userid !== db.extUserId(req.extUser.id)) throw httpError(403, '仅借出人可确认领用');
    const claimPhotos = parsePhotos(req.body.claim_photos, '领用照片');
    const fresh = await db.claimBorrowGroup(group.id, claimPhotos);
    const notify = require('../services/notify');
    fireAndForget(notify.claimApplyNotify(fresh));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/** 发起归还（整组，至少3张照片） */
router.post('/borrows/:id/return', requireExternal, async (req, res, next) => {
  try {
    const group = await db.resolveBorrowGroup(Number(req.params.id));
    if (!group) throw httpError(404, '借单不存在');
    if (group.borrower_userid !== db.extUserId(req.extUser.id)) throw httpError(403, '仅借出人可发起归还');
    const returnPhotos = parsePhotos(req.body.return_photos, '归还照片');

    const fresh = await db.submitReturnGroup(group.id, returnPhotos);
    const notify = require('../services/notify');
    fireAndForget(notify.returnApplyNotify(fresh));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

// multer 等错误统一转 JSON
router.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[external]', err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

module.exports = router;
