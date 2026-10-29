const express = require('express');
const QRCode = require('qrcode');
const config = require('../config');
const db = require('../db');
const { requireAuth, requireAdmin, httpError } = require('../middleware/auth');

const router = express.Router();

const cleanStr = (v, max = 255) => String(v ?? '').trim().slice(0, max);

/** 校验并规整设备图片列表：站内路径、最多9张；image 列 = 首图（封面） */
function parseDeviceImages(body) {
  let list = Array.isArray(body.images)
    ? body.images.map((p) => String(p || '').trim()).filter((p) => p.startsWith('/uploads/'))
    : [];
  // 兼容旧版单图字段
  if (!list.length && body.image && String(body.image).startsWith('/uploads/')) list = [String(body.image)];
  list = [...new Set(list)].slice(0, 9);
  return { images: JSON.stringify(list), image: list[0] || '' };
}

async function validateDeviceBody(body, { partial = false } = {}) {
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
  if (!partial || data.name) {
    if (!data.name) throw httpError(400, '请填写设备名称');
  }
  // 负责人（借出审批人）缺省取 .env 配置的第一位管理员
  if (!data.owner_userid) data.owner_userid = config.adminUserids[0] || '';
  if (data.owner_userid && !(await db.getUser(data.owner_userid))) {
    throw httpError(400, '负责人不存在，请先在成员中添加该用户');
  }
  return data;
}

/** 分类列表（供选设备侧边栏 / 筛选项） */
router.get('/categories', requireAuth, async (_req, res, next) => {
  try {
    res.json({ items: await db.listCategories() });
  } catch (e) {
    next(e);
  }
});

/** 设备列表：keyword / category / status / page / pageSize */
router.get('/', requireAuth, async (req, res, next) => {
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
    res.json({ items, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const device = await db.getDevice(Number(req.params.id));
    if (!device) throw httpError(404, '设备不存在');
    res.json({ device, activeBorrow: (await db.getActiveBorrowByDevice(device.id)) || null });
  } catch (e) {
    next(e);
  }
});

/** 设备二维码：扫码直达设备详情页 */
router.get('/:id/qrcode', requireAuth, async (req, res, next) => {
  try {
    const device = await db.getDevice(Number(req.params.id));
    if (!device) throw httpError(404, '设备不存在');
    const buf = await QRCode.toBuffer(`${config.baseUrl}/device/${device.id}`, {
      width: 512,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    });
    res.type('png').set('Cache-Control', 'public, max-age=3600').send(buf);
  } catch (e) {
    next(e);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const device = await db.createDevice(await validateDeviceBody(req.body));
    res.json({ device });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await db.getDevice(id))) throw httpError(404, '设备不存在');
    const device = await db.updateDevice(id, await validateDeviceBody(req.body));
    res.json({ device });
  } catch (e) {
    next(e);
  }
});

/**
 * 管理员直接改设备状态：停用/启用（borrowed 需走借还流程；存在进行中借单时不可变更）。
 */
router.patch('/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const device = await db.getDevice(id);
    if (!device) throw httpError(404, '设备不存在');
    const status = cleanStr(req.body.status, 16);
    if (!['idle', 'disabled'].includes(status)) throw httpError(400, '状态仅支持 启用（在库）/ 停用');
    if (device.status === 'borrowed') throw httpError(400, '设备已借出，请先完成借还流程');
    if (await db.hasActiveBorrow(id)) throw httpError(400, '该设备存在进行中的借单，请先在借单中处理');
    await db.setDeviceStatus(id, status);
    res.json({ device: await db.getDevice(id) });
  } catch (e) {
    next(e);
  }
});

/**
 * 删除设备：该设备全部借单随外键级联清除（管理兜底操作，历史借单一并删除）。
 * 注意：db.getUser 现在是异步，这里先 await 再抛错校验负责人。
 */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await db.getDevice(id))) throw httpError(404, '设备不存在');
    await db.deleteDevice(id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
