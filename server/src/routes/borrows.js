/**
 * 借出申请（按组）：
 *  - 一次申请可含多台设备（device_ids），审批与归还均按整组进行；
 *  - 组内所有设备状态一致流转：pending -> approved -> returning -> returned；
 *  - 管理员可代审批/代确认全部借单；借出人整组归还（一张照片）。
 */
const express = require('express');
const config = require('../config');
const db = require('../db');
const notify = require('../services/notify');
const { requireAuth, httpError } = require('../middleware/auth');

const router = express.Router();

const MAX_DEVICES = 20;
const MIN_PHOTOS = 3;
const MAX_PHOTOS = 9;

const today = () => db.nowStr().slice(0, 10);
const fireAndForget = (p) => p.catch((e) => console.error('[notify]', e.message));

/** 校验并规整照片列表：全部为站内路径、至少 MIN_PHOTS 张 */
function parsePhotos(raw, label) {
  const list = Array.isArray(raw) ? raw.map((p) => String(p || '').trim()).filter((p) => p.startsWith('/uploads/')) : [];
  if (list.length < MIN_PHOTOS) {
    throw httpError(400, `请至少拍摄 ${MIN_PHOTOS} 张${label}（当前 ${list.length} 张）`);
  }
  return [...new Set(list)].slice(0, MAX_PHOTOS);
}

/** 通用校验：事由 / 日期 */
function validateApplyBody(body) {
  const reason = String(body.reason || '').trim();
  const returnDate = String(body.expect_return_date || '').trim();
  if (!reason) throw httpError(400, '请填写借出事由');
  if (reason.length > 500) throw httpError(400, '借出事由不能超过500字');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) throw httpError(400, '请选择归还日期');
  if (returnDate < today()) throw httpError(400, '归还日期不能早于今天');
  return { reason, returnDate };
}

/** 校验设备列表：全部存在、在库、有负责人且负责人一致 */
async function validateDevices(body) {
  const ids = Array.isArray(body.device_ids) ? body.device_ids.map(Number).filter(Boolean) : [];
  if (!ids.length) throw httpError(400, '请选择要借出的设备');
  if (ids.length > MAX_DEVICES) throw httpError(400, `单次申请最多 ${MAX_DEVICES} 台设备`);
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
  if (!owners[0]) throw httpError(400, '该设备未设置负责人，无法发起审批');
  return devices;
}

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

/**
 * 查申请组并计算当前用户权限：
 *  - canManage：审批人名单中的管理员 或 任意管理员（管理员可代审批）
 *  - isBorrower：借出人本人（发起归还）
 */
const getOwnedGroup = async (req) => {
  const group = await db.resolveBorrowGroup(Number(req.params.id));
  if (!group) throw httpError(404, '借单不存在');
  const isAdmin = req.user.role === 'admin';
  const inApprovers = (group.approver_userids || []).includes(req.user.userid);
  const isBorrower = group.borrower_userid === req.user.userid;
  if (!isAdmin && !inApprovers && !isBorrower) throw httpError(403, '无权查看该借单');
  return { group, isAdmin, canManage: isAdmin || inApprovers, isBorrower };
};

/* ---------- 借出申请（多设备 -> 一个申请组） ---------- */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    // 系统关闭（超管在控制台切换）：暂停新借用申请，归还等既有流程不受影响
    const sys = await db.getSystemStatus();
    if (sys.closed) throw httpError(403, sys.reason ? `系统已关闭，暂停借用申请：${sys.reason}` : '系统已关闭，暂停借用申请');
    const { reason, returnDate } = validateApplyBody(req.body);
    const devices = await validateDevices(req.body);
    const approverUserids = await parseApprovers(req.body.approver_userids);
    const group = await db.createBorrowGroup({
      device_ids: devices.map((d) => d.id),
      borrower_userid: req.user.userid,
      borrower_type: 'wecom',
      reason,
      expect_return_date: returnDate,
      borrow_photo: '[]',
      approver_userids: JSON.stringify(approverUserids),
      approver_userid: approverUserids[0],
    });
    fireAndForget(notify.borrowApplyNotify(group));
    res.json({ borrow: group });
  } catch (e) {
    next(e);
  }
});

/* ---------- 列表（申请组）：tab = mine / todo / done / all(管理员) ---------- */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    let tab = String(req.query.tab || 'mine');
    if (!['mine', 'todo', 'done', 'all'].includes(tab)) tab = 'mine';
    if (tab === 'all' && req.user.role !== 'admin') throw httpError(403, '仅管理员可查看全部借单');
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const days = Math.min(3650, Number(req.query.days) || 0);
    const { items, total } = await db.listBorrowGroups({
      tab,
      userid: req.user.userid,
      status: String(req.query.status || '').trim(),
      days,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

/* ---------- 详情（id 兼容组 id / 行 id） ---------- */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { group } = await getOwnedGroup(req);
    res.json({ borrow: group, me: { userid: req.user.userid, role: req.user.role } });
  } catch (e) {
    next(e);
  }
});

/* ---------- 借出审批：通过（整组；审批人本人或管理员） ---------- */
router.post('/:id/approve', requireAuth, async (req, res, next) => {
  try {
    const { group, canManage } = await getOwnedGroup(req);
    if (!canManage) throw httpError(403, '仅审批人或管理员可操作');
    const fresh = await db.approveBorrowGroup(group.id, req.user.userid);
    fireAndForget(notify.borrowResultNotify(fresh, true));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/* ---------- 借出审批：驳回（整组） ---------- */
router.post('/:id/reject', requireAuth, async (req, res, next) => {
  try {
    const { group, canManage } = await getOwnedGroup(req);
    if (!canManage) throw httpError(403, '仅审批人或管理员可操作');
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw httpError(400, '请填写驳回原因');
    const fresh = await db.rejectBorrowGroup(group.id, reason, req.user.userid);
    fireAndForget(notify.borrowResultNotify(fresh, false, reason));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/* ---------- 领用设备（借出人拍照提交，至少3张；claiming -> claim_confirming） ---------- */
router.post('/:id/claim', requireAuth, async (req, res, next) => {
  try {
    const { group, isBorrower } = await getOwnedGroup(req);
    if (!isBorrower) throw httpError(403, '仅借出人可确认领用');
    const claimPhotos = parsePhotos(req.body.claim_photos, '领用照片');
    const fresh = await db.claimBorrowGroup(group.id, claimPhotos);
    fireAndForget(notify.claimApplyNotify(fresh));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/* ---------- 领用确认：通过（设备借出；审批人本人或管理员） ---------- */
router.post('/:id/claim-approve', requireAuth, async (req, res, next) => {
  try {
    const { group, canManage } = await getOwnedGroup(req);
    if (!canManage) throw httpError(403, '仅审批人或管理员可确认领用');
    // 待领用(借出人未拍照):管理员确认领用,照片可选(0-9 张)
    const photos = group.status === 'claiming'
      ? (Array.isArray(req.body.claim_photos)
          ? [...new Set(req.body.claim_photos.map((p) => String(p || '').trim()).filter((p) => p.startsWith('/uploads/')))].slice(0, 9)
          : [])
      : null;
    const fresh = await db.confirmClaimGroup(group.id, req.user.userid, photos);
    fireAndForget(notify.claimResultNotify(fresh, true));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/* ---------- 领用确认：驳回（照片不合格，借出人重新拍照） ---------- */
router.post('/:id/claim-reject', requireAuth, async (req, res, next) => {
  try {
    const { group, canManage } = await getOwnedGroup(req);
    if (!canManage) throw httpError(403, '仅审批人或管理员可操作');
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw httpError(400, '请填写驳回原因');
    const fresh = await db.rejectClaimGroup(group.id, reason);
    fireAndForget(notify.claimResultNotify(fresh, false, reason));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/* ---------- 发起归还（整组，至少3张照片；借出人） ---------- */
router.post('/:id/return', requireAuth, async (req, res, next) => {
  try {
    const { group, isBorrower } = await getOwnedGroup(req);
    if (!isBorrower) throw httpError(403, '仅借出人可发起归还');
    const returnPhotos = parsePhotos(req.body.return_photos, '归还照片');
    const fresh = await db.submitReturnGroup(group.id, returnPhotos);
    fireAndForget(notify.returnApplyNotify(fresh));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/* ---------- 强制归还（管理员兜底：线下收回设备直接了结，设备回库） ---------- */
router.post('/:id/force-return', requireAuth, async (req, res, next) => {
  try {
    const { group, isAdmin } = await getOwnedGroup(req);
    if (!isAdmin) throw httpError(403, '仅管理员可强制归还');
    const fresh = await db.forceReturnGroup(group.id, req.user.userid);
    fireAndForget(notify.returnResultNotify(fresh, true));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/* ---------- 归还确认：通过（全部设备回库；审批人本人或管理员） ---------- */
router.post('/:id/return-approve', requireAuth, async (req, res, next) => {
  try {
    const { group, canManage } = await getOwnedGroup(req);
    if (!canManage) throw httpError(403, '仅审批人或管理员可确认归还');
    const fresh = await db.confirmReturnGroup(group.id, req.user.userid);
    fireAndForget(notify.returnResultNotify(fresh, true));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

/* ---------- 归还确认：驳回（设备保持借出，借出人可重新发起） ---------- */
router.post('/:id/return-reject', requireAuth, async (req, res, next) => {
  try {
    const { group, canManage } = await getOwnedGroup(req);
    if (!canManage) throw httpError(403, '仅审批人或管理员可操作');
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw httpError(400, '请填写驳回原因');
    const fresh = await db.rejectReturnGroup(group.id, reason, req.user.userid);
    fireAndForget(notify.returnResultNotify(fresh, false, reason));
    res.json({ borrow: fresh });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
