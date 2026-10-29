/**
 * 数据访问层（当前实现：MySQL / mysql2 连接池）
 *
 * 设计约定：
 *  - 所有 SQL 集中在本文件，业务路由只调用这里的函数，全部为 async；
 *  - 查询全部使用 ? 占位符参数绑定，禁止任何字符串拼接 SQL；
 *  - 连接 dateStrings:true —— DATETIME 以 'YYYY-MM-DD HH:MM:SS' 字符串返回，前端无需时区换算；
 *  - 跨表强一致的操作（审批通过、归还确认、强制归还）封装为 db 层事务函数；
 *  - borrows.device_id 外键 ON DELETE CASCADE：删除设备自动清理其全部借单。
 *
 * .env 配置：DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
 */
const mysql = require('mysql2/promise');
const config = require('./config');

const bizErr = (status, message) => {
  const e = new Error(message);
  e.status = status;
  return e;
};

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4_unicode_ci',
  dateStrings: true, // DATETIME/DATE 返回字符串，保持与前端既有展示逻辑兼容
});

/** 表结构（优化点：InnoDB + utf8mb4、状态用 ENUM、外键级联删除、常用条件建索引） */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    userid VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL DEFAULT '',
    avatar VARCHAR(512) NOT NULL DEFAULT '',
    role ENUM('admin','member') NOT NULL DEFAULT 'member',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_users_role (role)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS devices (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '设备ID（展示为 DEV-0001 样式）',
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT '未分类',
    model VARCHAR(128) NOT NULL DEFAULT '',
    serial_no VARCHAR(128) NOT NULL DEFAULT '',
    status ENUM('idle','borrowed','disabled') NOT NULL DEFAULT 'idle',
    location VARCHAR(128) NOT NULL DEFAULT '',
    image VARCHAR(512) NOT NULL DEFAULT '' COMMENT '封面图（= images 首图，列表缩略图用）',
    images TEXT NULL COMMENT '设备图片 JSON 数组，首张为封面',
    owner_userid VARCHAR(64) NOT NULL DEFAULT '' COMMENT '负责人=借还审批人，缺省取 .env 管理员',
    remark VARCHAR(1000) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_devices_category (category),
    KEY idx_devices_owner (owner_userid),
    KEY idx_devices_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS borrows (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    device_id INT UNSIGNED NOT NULL,
    borrower_userid VARCHAR(64) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    expect_return_date DATE NOT NULL,
    borrow_photo TEXT NOT NULL COMMENT '借出照片 JSON 数组（至少3张）',
    approver_userid VARCHAR(64) NOT NULL,
    approver_userids TEXT NULL COMMENT '审批人 userid JSON 数组（默认全部管理员）',
    status ENUM('pending','claiming','claim_confirming','approved','rejected','returning','returned','return_rejected') NOT NULL DEFAULT 'pending',
    reject_reason VARCHAR(200) NOT NULL DEFAULT '',
    return_photo TEXT NOT NULL COMMENT '归还照片 JSON 数组（至少3张）',
    return_reject_reason VARCHAR(200) NOT NULL DEFAULT '',
    claim_at DATETIME NULL COMMENT '领用拍照提交时间',
    claim_approve_at DATETIME NULL COMMENT '领用确认时间',
    apply_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approve_at DATETIME NULL,
    return_apply_at DATETIME NULL,
    finish_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_borrows_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    KEY idx_borrows_borrower (borrower_userid, status),
    KEY idx_borrows_approver (approver_userid, status),
    KEY idx_borrows_device (device_id),
    KEY idx_borrows_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS message_log (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    to_userid VARCHAR(64) NOT NULL,
    title VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    url VARCHAR(512) NOT NULL DEFAULT '',
    mock TINYINT(1) NOT NULL DEFAULT 0,
    sent TINYINT(1) NOT NULL DEFAULT 0,
    error VARCHAR(512) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_message_to (to_userid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS corp_config (
    id INT UNSIGNED PRIMARY KEY,
    corpid VARCHAR(64) NOT NULL DEFAULT '',
    corp_name VARCHAR(128) NOT NULL DEFAULT '',
    agentid VARCHAR(64) NOT NULL DEFAULT '',
    permanent_code TEXT NOT NULL,
    suite_ticket TEXT NOT NULL,
    suite_ticket_at DATETIME NULL,
    installed_at DATETIME NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /** 企业微信之外、通过微信扫码借出的人员（openid 唯一绑定学籍信息） */
  `CREATE TABLE IF NOT EXISTS external_users (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    openid VARCHAR(64) NOT NULL UNIQUE,
    unionid VARCHAR(64) NOT NULL DEFAULT '',
    nickname VARCHAR(64) NOT NULL DEFAULT '',
    avatar VARCHAR(512) NOT NULL DEFAULT '',
    class_name VARCHAR(64) NOT NULL DEFAULT '' COMMENT '班级',
    student_name VARCHAR(64) NOT NULL DEFAULT '' COMMENT '姓名',
    student_no VARCHAR(32) NOT NULL DEFAULT '' COMMENT '学号',
    phone VARCHAR(20) NOT NULL DEFAULT '' COMMENT '手机号（外部借出必填）',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    bound_at DATETIME NULL,
    KEY idx_external_student_no (student_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /** 系统设置（键值对）：system_closed / system_close_reason 等 */
  `CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(64) PRIMARY KEY,
    v TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /** 系统公告：超管维护，启用中的公告在前端首页轮播展示 */
  `CREATE TABLE IF NOT EXISTS announcements (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(128) NOT NULL,
    content VARCHAR(2000) NOT NULL DEFAULT '',
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_announcements_enabled (enabled)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

/** 已存在的表补充新列（MySQL 不支持 ADD COLUMN IF NOT EXISTS，查 information_schema 判断） */
async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [config.db.database, table, column]
  );
  if (!rows[0].c) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureSchema() {
  for (const ddl of SCHEMA) await pool.query(ddl);
  // 借单来源：企微成员 / 微信扫码的外部人员
  await ensureColumn('borrows', 'borrower_type', "ENUM('wecom','wechat') NOT NULL DEFAULT 'wecom'");
  // 一次申请可含多台设备：同组借单共享 group_id（= 首行 id），审批/归还均按组进行
  await ensureColumn('borrows', 'group_id', 'INT UNSIGNED NULL');
  await pool.query('CREATE INDEX idx_borrows_group ON borrows (group_id)').catch(() => {});
  // 存量单设备借单补 group_id = 自身 id
  await pool.query('UPDATE borrows SET group_id = id WHERE group_id IS NULL');
  // 借出/归还照片升级为多图：字段转 TEXT，存量单图迁移为 JSON 数组
  await pool.query('ALTER TABLE borrows MODIFY borrow_photo TEXT NOT NULL').catch(() => {});
  await pool.query('ALTER TABLE borrows MODIFY return_photo TEXT NOT NULL').catch(() => {});
  const [legacy] = await pool.query(
    `SELECT id, borrow_photo, return_photo FROM borrows
     WHERE (borrow_photo <> '' AND borrow_photo NOT LIKE '[%')
        OR (return_photo <> '' AND return_photo NOT LIKE '[%')`
  );
  for (const row of legacy) {
    const toArr = (v) => (v ? JSON.stringify([v]) : '[]');
    await pool.query('UPDATE borrows SET borrow_photo=?, return_photo=? WHERE id=?', [
      toArr(row.borrow_photo),
      toArr(row.return_photo),
      row.id,
    ]);
  }
  // 审批人升级为多选：存量单审批人迁移为 JSON 数组
  await ensureColumn('borrows', 'approver_userids', "TEXT NULL COMMENT '审批人 userid JSON 数组'");
  await pool.query(
    "UPDATE borrows SET approver_userids = JSON_ARRAY(approver_userid) WHERE approver_userids IS NULL OR approver_userids = ''"
  );
  // 流程升级：新增「待领用 / 领用待确认」状态与领用时间字段
  await pool.query(
    `ALTER TABLE borrows MODIFY status ENUM('pending','claiming','claim_confirming','approved','rejected','returning','returned','return_rejected') NOT NULL DEFAULT 'pending'`
  ).catch(() => {});
  await ensureColumn('borrows', 'claim_at', 'DATETIME NULL COMMENT "领用拍照提交时间"');
  await ensureColumn('borrows', 'claim_approve_at', 'DATETIME NULL COMMENT "领用确认时间"');
  await ensureColumn('borrows', 'claim_reject_reason', "VARCHAR(200) NOT NULL DEFAULT '' COMMENT '领用驳回原因'");
  await ensureColumn('borrows', 'approved_by', "VARCHAR(64) NOT NULL DEFAULT '' COMMENT '实际审批操作人'");
  await ensureColumn('borrows', 'confirm_by', "VARCHAR(64) NOT NULL DEFAULT '' COMMENT '领用/归还确认操作人'");
  // 「待领用」状态计入管理员的进行中/待办视角（borrow_photo 列现语义为领用凭证照片）
  await pool.query(
    `ALTER TABLE borrows MODIFY borrow_photo TEXT NOT NULL COMMENT '领用凭证照片 JSON 数组（至少3张）'`
  ).catch(() => {});
  // 飞书身份绑定：users 表加 open_id 列（飞书端 /f 免登 + 通知按平台路由）
  await ensureColumn('users', 'feishu_openid', "VARCHAR(64) NOT NULL DEFAULT '' COMMENT '飞书 open_id'");
  await pool.query('CREATE INDEX idx_users_feishu ON users (feishu_openid)').catch(() => {});
  // 设备多图：images JSON 数组，存量单图迁移；image 列保留为首图（封面）
  await ensureColumn('devices', 'images', "TEXT NULL COMMENT '设备图片 JSON 数组，首张为封面'");
  await pool.query(
    "UPDATE devices SET images = JSON_ARRAY(image) WHERE (images IS NULL OR images = '') AND image <> ''"
  );
  // 外部借出人手机号（本次新增，必填校验在路由层；存量记录为空时由前端引导补填）
  await ensureColumn('external_users', 'phone', "VARCHAR(20) NOT NULL DEFAULT '' COMMENT '手机号（外部借出必填）'");
}

/** 应用启动（或迁移脚本）先等表结构就绪 */
const ready = ensureSchema();

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ==================== users ==================== */

async function upsertUser({ userid, name = '', avatar = '' }) {
  const role = config.adminUserids.includes(userid) ? 'admin' : 'member';
  await pool.query(
    `INSERT INTO users (userid, name, avatar, role) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = IF(VALUES(name) <> '', VALUES(name), name),
       avatar = IF(VALUES(avatar) <> '', VALUES(avatar), avatar),
       role = IF(VALUES(role) = 'admin', 'admin', role)`,
    [userid, name, avatar, role]
  );
  return getUser(userid);
}

const getUser = async (userid) => (await pool.query('SELECT * FROM users WHERE userid = ?', [userid]))[0][0];

const getUserByFeishuOpenid = async (openid) =>
  (await pool.query('SELECT * FROM users WHERE feishu_openid = ? AND feishu_openid <> ?', [openid, '']))[0][0];

/** 按姓名精确匹配（飞书登录时身份打通用，同名取最早注册的） */
const getUserByNameExact = async (name) =>
  (await pool.query("SELECT * FROM users WHERE name = ? AND name <> '' ORDER BY id LIMIT 1", [name]))[0][0];

/** 将飞书 open_id 绑定到已有用户（登录身份打通） */
const bindFeishuOpenid = async (userid, openid) => {
  await pool.query('UPDATE users SET feishu_openid=? WHERE userid=?', [openid, userid]);
  return getUser(userid);
};

/** 全部管理员的 userid 列表 */
const listAdmins = async () =>
  (await pool.query("SELECT userid FROM users WHERE role='admin'"))[0].map((r) => r.userid);

const listUsers = async () =>
  (await pool.query('SELECT userid, name, avatar, role FROM users ORDER BY id'))[0];

/* ==================== devices ==================== */

const DEVICE_SELECT = `
  SELECT d.*, COALESCE(NULLIF(u.name, ''), d.owner_userid, '') AS owner_name
  FROM devices d
  LEFT JOIN users u ON u.userid = d.owner_userid
`;

/** 设备行附加 images 数组（兼容旧单图 image 列） */
function withImages(d) {
  if (!d) return d;
  const list = parsePhotos(d.images);
  return { ...d, images: list.length ? list : d.image ? [d.image] : [] };
}

const getDevice = async (id) => withImages((await pool.query(`${DEVICE_SELECT} WHERE d.id = ?`, [id]))[0][0]);

async function listDevices({ keyword = '', category = '', status = '', offset = 0, limit = 20 }) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(d.name LIKE ? OR d.model LIKE ? OR d.serial_no LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (category) {
    where.push('d.category = ?');
    params.push(category);
  }
  if (status) {
    where.push('d.status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ c: total }]] = await pool.query(`SELECT COUNT(*) AS c FROM devices d ${whereSql}`, params);
  const [items] = await pool.query(
    `${DEVICE_SELECT} ${whereSql} ORDER BY d.category, d.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { items: items.map(withImages), total };
}

const listCategories = async () =>
  (await pool.query('SELECT category AS name, COUNT(*) AS count FROM devices GROUP BY category ORDER BY name'))[0];

async function createDevice(d) {
  const [info] = await pool.query(
    `INSERT INTO devices (name, category, model, serial_no, location, image, images, owner_userid, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.name, d.category, d.model, d.serial_no, d.location, d.image || '', d.images || '[]', d.owner_userid, d.remark]
  );
  return getDevice(info.insertId);
}

async function updateDevice(id, d) {
  await pool.query(
    `UPDATE devices SET name=?, category=?, model=?, serial_no=?, location=?, image=?, images=?, owner_userid=?, remark=? WHERE id=?`,
    [d.name, d.category, d.model, d.serial_no, d.location, d.image || '', d.images || '[]', d.owner_userid, d.remark, id]
  );
  return getDevice(id);
}

const setDeviceStatus = async (id, status) =>
  pool.query('UPDATE devices SET status=? WHERE id=?', [status, id]);

/**
 * 删除设备。borrows.device_id 外键 ON DELETE CASCADE，
 * 该设备的全部借单（含进行中）一并清除——管理兜底操作。
 */
const deleteDevice = async (id) => {
  const [info] = await pool.query('DELETE FROM devices WHERE id=?', [id]);
  return info.affectedRows > 0;
};

const hasActiveBorrow = async (deviceId) => {
  const [[{ c }]] = await pool.query(
    "SELECT COUNT(*) AS c FROM borrows WHERE device_id=? AND status IN ('pending','approved','returning')",
    [deviceId]
  );
  return c > 0;
};

/* ==================== borrows（按申请分组：一次申请可含多台设备） ====================
 *  - 同一申请的 N 台设备 = N 行借单共享 group_id（= 首行 id）；
 *  - 审批（通过/驳回）与归还（提交/确认/驳回）均按整组进行，组内状态始终一致；
 *  - 对外返回「申请组」对象：标量字段取首行 + devices[] 设备明细。
 */

const BORROW_SELECT = `
  SELECT b.*,
         d.name AS device_name, d.image AS device_image, d.category AS device_category, d.location AS device_location,
         COALESCE(NULLIF(ub.name, ''), NULLIF(e.student_name, ''), b.borrower_userid) AS borrower_name,
         COALESCE(NULLIF(ua.name, ''), b.approver_userid) AS approver_name
  FROM borrows b
  JOIN devices d ON d.id = b.device_id
  LEFT JOIN users ub ON b.borrower_type = 'wecom' AND ub.userid = b.borrower_userid
  LEFT JOIN external_users e ON b.borrower_type = 'wechat' AND b.borrower_userid = CONCAT('ext:', e.id)
  LEFT JOIN users ua ON ua.userid = b.approver_userid
`;

/** 行集合 -> 申请组对象 */
function toGroup(rows) {
  if (!rows.length) return null;
  const f = rows[0];
  return {
    id: f.group_id,
    status: f.status,
    reason: f.reason,
    expect_return_date: f.expect_return_date,
    borrow_photos: parsePhotos(f.borrow_photo),
    return_photos: parsePhotos(f.return_photo),
    reject_reason: f.reject_reason,
    return_reject_reason: f.return_reject_reason,
    apply_at: f.apply_at,
    approve_at: f.approve_at,
    return_apply_at: f.return_apply_at,
    finish_at: f.finish_at,
    borrower_userid: f.borrower_userid,
    borrower_type: f.borrower_type,
    borrower_name: f.borrower_name,
    approver_userid: f.approver_userid,
    approver_userids: parseApprovers(f.approver_userids, f.approver_userid),
    approver_name: f.approver_name,
    approved_by: f.approved_by || '',
    confirm_by: f.confirm_by || '',
    devices: rows.map((r) => ({
      row_id: r.id,
      device_id: r.device_id,
      name: r.device_name,
      image: r.device_image,
      category: r.device_category,
      location: r.device_location,
    })),
  };
}

/** 照片字段解析：JSON 数组 / 兼容历史单图字符串 */
function parsePhotos(v) {
  if (!v) return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.filter(Boolean) : [];
  } catch {
    return [v];
  }
}

/** 审批人解析：JSON 数组，兜底单值列 */
function parseApprovers(v, fallbackSingle) {
  const list = parsePhotos(v);
  if (list.length) return list;
  return fallbackSingle ? [fallbackSingle] : [];
}

/** 为申请组补齐审批人姓名（一次查询解析全部组） */
async function decorateApproverNames(groups) {
  const ids = [...new Set(groups.flatMap((g) => g.approver_userids))].filter(Boolean);
  if (!ids.length) return groups;
  const [rows] = await pool.query(
    `SELECT userid, COALESCE(NULLIF(name, ''), userid) AS name FROM users WHERE userid IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  const map = new Map(rows.map((r) => [r.userid, r.name]));
  for (const g of groups) {
    g.approver_names = g.approver_userids.map((id) => map.get(id) || id);
    g.approver_names_text = g.approver_names.join('、');
  }
  return groups;
}

const getBorrow = async (id) => (await pool.query(`${BORROW_SELECT} WHERE b.id = ?`, [id]))[0][0];

/** 解析一组 userid 的显示名 */
async function resolveUserNames(ids) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {};
  const [rows] = await pool.query(
    `SELECT userid, COALESCE(NULLIF(name, ''), userid) AS name FROM users WHERE userid IN (${clean.map(() => '?').join(',')})`,
    clean
  );
  return Object.fromEntries(rows.map((r) => [r.userid, r.name]));
}

const getBorrowGroup = async (groupId) => {
  const [rows] = await pool.query(`${BORROW_SELECT} WHERE b.group_id = ? ORDER BY b.id`, [groupId]);
  const g = (await decorateApproverNames([toGroup(rows)].filter(Boolean)))[0] || null;
  if (g) {
    const names = await resolveUserNames([g.approved_by, g.confirm_by]);
    g.approved_by_name = names[g.approved_by] || '';
    g.confirm_by_name = names[g.confirm_by] || '';
  }
  return g;
};

/** id 兼容组 id（=首行 id）与行 id（旧通知链接），一律解析到所属申请组 */
async function resolveBorrowGroup(id) {
  const row = await getBorrow(id);
  if (row) return getBorrowGroup(row.group_id || row.id);
  return getBorrowGroup(id);
}

/** 设备当前借用中的申请组 */
async function getActiveBorrowByDevice(deviceId) {
  const [rows] = await pool.query(
    `${BORROW_SELECT} WHERE b.device_id = ? AND b.status IN ('approved','returning') ORDER BY b.id DESC`,
    [deviceId]
  );
  return rows.length ? getBorrowGroup(rows[0].group_id) : null;
}

/** 审批人包含判断（兼容历史单值列） */
const IN_APPROVERS_SQL = 'JSON_CONTAINS(COALESCE(b.approver_userids, JSON_ARRAY(b.approver_userid)), JSON_QUOTE(?))';

/**
 * tab:
 *  - mine     我申请的（borrower = 我）
 *  - todo     待我审批（我在审批人名单 且 pending/returning）
 *  - done     我已处理的审批（我在审批人名单 且 已有结论）
 *  - all      全部（仅管理员，审计用）
 */
async function listBorrowGroups({ tab = 'mine', userid, status = '', days = 0, offset = 0, limit = 20 }) {
  const where = [];
  const params = [];
  if (tab === 'mine') {
    where.push('b.borrower_userid = ?');
    params.push(userid);
  } else if (tab === 'todo') {
    where.push(`${IN_APPROVERS_SQL} AND b.status IN ('pending','returning')`);
    params.push(userid);
  } else if (tab === 'done') {
    where.push(`${IN_APPROVERS_SQL} AND b.status IN ('approved','rejected','returned','return_rejected')`);
    params.push(userid);
  } else if (tab === 'all') {
    where.push('1=1');
  }
  if (status === 'active') {
    where.push("b.status IN ('pending','claiming','claim_confirming','approved','returning','return_rejected')");
  } else if (status === 'claim') {
    // 待领用:审批已通过,领用环节未完成
    where.push("b.status IN ('claiming','claim_confirming')");
  } else if (status === 'overdue') {
    // 已逾期:进行中且已过应还日期
    where.push("b.status IN ('approved','returning','return_rejected') AND b.expect_return_date < CURDATE()");
  } else if (status) {
    where.push('b.status = ?');
    params.push(status);
  }
  // 日期范围(按申请时间):days 为天数,不传则不限
  if (days) {
    where.push('b.apply_at >= DATE_SUB(NOW(), INTERVAL ? DAY)');
    params.push(days);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const [[{ c: total }]] = await pool.query(
    `SELECT COUNT(DISTINCT b.group_id) AS c FROM borrows b ${whereSql}`,
    params
  );
  const [groups] = await pool.query(
    `SELECT b.group_id FROM borrows b ${whereSql} GROUP BY b.group_id ORDER BY MAX(b.id) DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  if (!groups.length) return { items: [], total };
  const ids = groups.map((g) => g.group_id);
  const [rows] = await pool.query(
    `${BORROW_SELECT} WHERE b.group_id IN (${ids.map(() => '?').join(',')}) ORDER BY b.group_id DESC, b.id`,
    ids
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.group_id)) map.set(r.group_id, []);
    map.get(r.group_id).push(r);
  }
  const groupItems = [...map.values()].map(toGroup).filter(Boolean);
  return { items: await decorateApproverNames(groupItems), total };
}

/** 待办审批数（按组计，我在审批人名单） */
const countPendingApproval = async (userid) => {
  const [[{ c }]] = await pool.query(
    `SELECT COUNT(DISTINCT group_id) AS c FROM borrows
     WHERE JSON_CONTAINS(COALESCE(approver_userids, JSON_ARRAY(approver_userid)), JSON_QUOTE(?))
       AND status IN ('pending','returning')`,
    [userid]
  );
  return c;
};

/** 创建申请组：N 台设备一个申请（事务），group_id = 首行 id；照片/审批人为 TEXT 无默认值，需显式写入 */
async function createBorrowGroup({ device_ids, borrower_userid, borrower_type = 'wecom', reason, expect_return_date, borrow_photo, approver_userids, approver_userid }) {
  const conn = await pool.getConnection();
  let groupId = 0;
  try {
    await conn.beginTransaction();
    for (const deviceId of device_ids) {
      const [info] = await conn.query(
        `INSERT INTO borrows (device_id, group_id, borrower_userid, borrower_type, reason, expect_return_date, borrow_photo, return_photo, approver_userid, approver_userids)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
        [deviceId, groupId, borrower_userid, borrower_type, reason, expect_return_date, borrow_photo, approver_userid, approver_userids]
      );
      if (!groupId) {
        groupId = info.insertId;
        await conn.query('UPDATE borrows SET group_id=? WHERE id=?', [groupId, groupId]);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return getBorrowGroup(groupId);
}

/* ---------- 整组事务操作：组内行状态必须一致且符合预期 ---------- */

async function groupTx(groupId, expectStatus, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM borrows WHERE group_id=? ORDER BY id FOR UPDATE', [groupId]);
    if (!rows.length) throw bizErr(404, '借单不存在');
    if (expectStatus && rows.some((r) => r.status !== expectStatus)) {
      throw bizErr(400, '组内借单状态不一致，请联系管理员处理');
    }
    await fn(conn, rows);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return getBorrowGroup(groupId);
}

/** 借出审批通过：整组进入「待领用」（claiming），设备保持在库，领用确认后才置借出 */
function approveBorrowGroup(groupId, operator) {
  operator = operator || 'unknown';
  return groupTx(groupId, 'pending', async (conn, rows) => {
    const deviceIds = rows.map((r) => r.device_id);
    const [devices] = await conn.query(`SELECT * FROM devices WHERE id IN (${deviceIds.map(() => '?').join(',')}) FOR UPDATE`, deviceIds);
    const notIdle = devices.filter((d) => d.status !== 'idle');
    if (notIdle.length) throw bizErr(400, `「${notIdle[0].name}」已被借出，无法通过本申请`);
    // 审批通过即置借出:待领用期间其他成员不可再申请该设备
    await conn.query(`UPDATE devices SET status='borrowed' WHERE id IN (${deviceIds.map(() => '?').join(',')})`, deviceIds);
    await conn.query("UPDATE borrows SET status='claiming', approve_at=NOW(), approved_by=? WHERE group_id=?", [operator, groupId]);
  });
}

/** 借出人领用：拍照提交凭证，整组 claiming -> claim_confirming */
function claimBorrowGroup(groupId, photos) {
  return groupTx(groupId, 'claiming', async (conn) => {
    await conn.query(
      "UPDATE borrows SET status='claim_confirming', borrow_photo=?, claim_at=NOW() WHERE group_id=?",
      [JSON.stringify(photos), groupId]
    );
  });
}

/** 领用照片驳回：整组回到 claiming，借出人重新拍照 */
function rejectClaimGroup(groupId, reason) {
  return groupTx(groupId, 'claim_confirming', async (conn) => {
    await conn.query(
      "UPDATE borrows SET status='claiming', borrow_photo='[]', claim_at=NOW(), claim_reject_reason=? WHERE group_id=?",
      [reason, groupId]
    );
  });
}

/** 领用确认：全部设备置借出，整组 approved */
function confirmClaimGroup(groupId, operator, photos = null) {
  operator = operator || 'unknown';
  return groupTx(groupId, null, async (conn, rows) => {
    // 管理员代确认(claiming):领用照片可选;借出人已拍照(claim_confirming)直接确认
    if (rows[0].status === 'claiming') {
      await conn.query(
        "UPDATE borrows SET status='approved', borrow_photo=?, claim_at=NOW(), claim_approve_at=NOW(), confirm_by=? WHERE group_id=?",
        [JSON.stringify(photos || []), operator, groupId]
      );
      return;
    }
    const deviceIds = rows.map((r) => r.device_id);
    const [devices] = await conn.query(`SELECT * FROM devices WHERE id IN (${deviceIds.map(() => '?').join(',')}) FOR UPDATE`, deviceIds);
    await conn.query("UPDATE borrows SET status='approved', claim_approve_at=NOW(), confirm_by=? WHERE group_id=?", [operator, groupId]);
  });
}

/** 借出审批驳回：整组 rejected */
function rejectBorrowGroup(groupId, reason, operator) {
  operator = operator || 'unknown';
  return groupTx(groupId, 'pending', async (conn) => {
    await conn.query("UPDATE borrows SET status='rejected', reject_reason=?, approve_at=NOW(), approved_by=? WHERE group_id=?", [reason, operator, groupId]);
  });
}

/** 借出人发起归还：归还照片（JSON 数组）覆盖整组，组内全部 approved -> returning */
function submitReturnGroup(groupId, returnPhotos) {
  return groupTx(groupId, 'approved', async (conn) => {
    await conn.query(
      "UPDATE borrows SET status='returning', return_photo=?, return_apply_at=NOW(), return_reject_reason='' WHERE group_id=?",
      [JSON.stringify(returnPhotos), groupId]
    );
  });
}

/** 归还确认通过：全部设备回库，整组 returned */
function confirmReturnGroup(groupId, operator) {
  operator = operator || 'unknown';
  return groupTx(groupId, 'returning', async (conn, rows) => {
    const deviceIds = rows.map((r) => r.device_id);
    await conn.query(`UPDATE devices SET status='idle' WHERE id IN (${deviceIds.map(() => '?').join(',')})`, deviceIds);
    await conn.query("UPDATE borrows SET status='returned', finish_at=NOW(), confirm_by=? WHERE group_id=?", [operator, groupId]);
  });
}

/** 归还确认驳回：设备保持借出，整组回到 approved */
function rejectReturnGroup(groupId, reason) {
  return groupTx(groupId, 'returning', async (conn) => {
    await conn.query("UPDATE borrows SET status='approved', return_reject_reason=? WHERE group_id=?", [reason, groupId]);
  });
}

/** 强制归还（管理兜底）：线下收回设备时直接了结整组并回库（使用中/归还中均可） */
function forceReturnGroup(groupId, operator) {
  operator = operator || 'unknown';
  return groupTx(groupId, null, async (conn, rows) => {
    if (rows.some((r) => !['approved', 'returning', 'return_rejected', 'claiming', 'claim_confirming'].includes(r.status))) {
      throw bizErr(400, '仅使用中 / 归还流程中的借单可强制归还');
    }
    const deviceIds = rows.map((r) => r.device_id);
    await conn.query(`UPDATE devices SET status='idle' WHERE id IN (${deviceIds.map(() => '?').join(',')})`, deviceIds);
    await conn.query("UPDATE borrows SET status='returned', finish_at=NOW() WHERE group_id=?", [groupId]);
  });
}

/* ==================== external_users（微信扫码借出的外部人员） ==================== */

const EXT_PREFIX = 'ext:';

/** borrows.borrower_userid 中外部人员的标识前缀（ext:<id>） */
const extUserId = (id) => `${EXT_PREFIX}${id}`;

const getExternalByOpenid = async (openid) =>
  (await pool.query('SELECT * FROM external_users WHERE openid = ?', [openid]))[0][0];

/** 学号是外部借出人的身份键：同一学号填写视为同一人（换浏览器可续接历史借单） */
const getExternalByStudentNo = async (studentNo) =>
  (await pool.query('SELECT * FROM external_users WHERE student_no = ? LIMIT 1', [studentNo]))[0][0];

const getExternalById = async (id) => (await pool.query('SELECT * FROM external_users WHERE id = ?', [id]))[0][0];

const createExternalUser = async ({ openid = '', unionid = '', nickname = '', avatar = '', class_name = '', student_name = '', student_no = '', phone = '' }) => {
  const [info] = await pool.query(
    'INSERT INTO external_users (openid, unionid, nickname, avatar, class_name, student_name, student_no, phone, bound_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [openid, unionid, nickname, avatar, class_name, student_name, student_no, phone]
  );
  return getExternalById(info.insertId);
};

/** 绑定/更新学籍信息（班级、姓名、学号、手机号） */
async function bindExternalUser(id, { class_name, student_name, student_no, phone }) {
  await pool.query(
    'UPDATE external_users SET class_name=?, student_name=?, student_no=?, phone=?, bound_at=NOW() WHERE id=?',
    [class_name, student_name, student_no, phone || '', id]
  );
  return getExternalById(id);
}

/* ==================== settings（系统设置，键值对） ==================== */

const getSetting = async (key, def = '') => {
  const [rows] = await pool.query('SELECT v FROM settings WHERE k = ?', [key]);
  return rows[0]?.v ?? def;
};

const setSetting = async (key, value) => {
  await pool.query(
    'INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    [key, String(value)]
  );
};

/** 系统开关状态：closed = 借用申请是否被暂停 */
async function getSystemStatus() {
  const [closed, reason] = await Promise.all([
    getSetting('system_closed', '0'),
    getSetting('system_close_reason', ''),
  ]);
  return { closed: closed === '1', reason };
}

/* ==================== announcements（系统公告） ==================== */

/** 公告列表；onlyEnabled 只返回启用中的（按创建时间倒序） */
const listAnnouncements = async (onlyEnabled = false) =>
  (
    await pool.query(
      `SELECT id, title, content, enabled, created_at, updated_at FROM announcements
       ${onlyEnabled ? 'WHERE enabled = 1' : ''} ORDER BY id DESC`
    )
  )[0];

const getAnnouncement = async (id) =>
  (await pool.query('SELECT * FROM announcements WHERE id = ?', [id]))[0][0];

const createAnnouncement = async ({ title, content = '', enabled = 1 }) => {
  const [info] = await pool.query(
    'INSERT INTO announcements (title, content, enabled) VALUES (?, ?, ?)',
    [title, content, enabled ? 1 : 0]
  );
  return getAnnouncement(info.insertId);
};

const updateAnnouncement = async (id, { title, content = '', enabled = 1 }) => {
  await pool.query('UPDATE announcements SET title=?, content=?, enabled=? WHERE id=?', [
    title,
    content,
    enabled ? 1 : 0,
    id,
  ]);
  return getAnnouncement(id);
};

const deleteAnnouncement = async (id) => {
  const [info] = await pool.query('DELETE FROM announcements WHERE id = ?', [id]);
  return info.affectedRows > 0;
};

/* ==================== corp_config（开发者中心·网页应用：安装企业授权信息，单行） ==================== */

const getCorpConfig = async () => (await pool.query('SELECT * FROM corp_config WHERE id = 1'))[0][0];

const saveInstalledCorp = async ({ corpid, corp_name, agentid, permanent_code }) => {
  await pool.query(
    `INSERT INTO corp_config (id, corpid, corp_name, agentid, permanent_code, suite_ticket, installed_at)
     VALUES (1, ?, ?, ?, ?, '', NOW())
     ON DUPLICATE KEY UPDATE
       corpid=VALUES(corpid), corp_name=VALUES(corp_name), agentid=VALUES(agentid),
       permanent_code=VALUES(permanent_code), installed_at=NOW()`,
    [corpid, corp_name || '', String(agentid ?? ''), permanent_code]
  );
  return getCorpConfig();
};

const saveSuiteTicket = async (ticket) => {
  await pool.query('INSERT IGNORE INTO corp_config (id) VALUES (1)');
  await pool.query('UPDATE corp_config SET suite_ticket=?, suite_ticket_at=NOW() WHERE id=1', [ticket]);
};

/* ==================== message_log ==================== */

const addMessage = async ({ to_userid, title, description = '', url = '' }) => {
  const [info] = await pool.query(
    'INSERT INTO message_log (to_userid, title, description, url) VALUES (?, ?, ?, ?)',
    [to_userid, title, description, url]
  );
  return info.insertId;
};

const finishMessage = async (id, { mock, sent, error = '' }) =>
  pool.query('UPDATE message_log SET mock=?, sent=?, error=? WHERE id=?', [mock ? 1 : 0, sent ? 1 : 0, error, id]);

module.exports = {
  pool,
  ready,
  nowStr,
  upsertUser,
  getUser,
  getUserByFeishuOpenid,
  getUserByNameExact,
  bindFeishuOpenid,
  listAdmins,
  listUsers,
  getDevice,
  listDevices,
  listCategories,
  createDevice,
  updateDevice,
  setDeviceStatus,
  deleteDevice,
  hasActiveBorrow,
  getBorrow,
  getBorrowGroup,
  resolveBorrowGroup,
  getActiveBorrowByDevice,
  listBorrowGroups,
  countPendingApproval,
  createBorrowGroup,
  approveBorrowGroup,
  claimBorrowGroup,
  rejectClaimGroup,
  confirmClaimGroup,
  rejectBorrowGroup,
  submitReturnGroup,
  confirmReturnGroup,
  rejectReturnGroup,
  forceReturnGroup,
  getCorpConfig,
  saveInstalledCorp,
  saveSuiteTicket,
  addMessage,
  finishMessage,
  extUserId,
  getExternalByOpenid,
  getExternalByStudentNo,
  getExternalById,
  createExternalUser,
  bindExternalUser,
  getSetting,
  setSetting,
  getSystemStatus,
  listAnnouncements,
  getAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
};
