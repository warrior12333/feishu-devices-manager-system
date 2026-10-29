/**
 * 一次性迁移脚本：SQLite（data/app.db）-> MySQL。
 * 用法：cd server && node scripts/migrate-sqlite-to-mysql.js
 *
 * 规则：
 *  - MySQL 各表必须为空才执行（防止重复导入）；
 *  - users 剔除 DEV_MODE 内置测试账号（成员改由企微通讯录同步）；
 *  - devices 的负责人若为被剔除的测试账号或为空，改指 .env 第一位管理员；
 *  - 全部表保持原 id，AUTO_INCREMENT 随显式插入自动对齐。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../src/config');
const db = require('../src/db');

const DEV_USERIDS = ['zhangsan', 'lisi', 'wangwu'];

async function tableCount(table) {
  const [rows] = await db.pool.query(`SELECT COUNT(*) AS c FROM ${table}`);
  return rows[0].c;
}

async function insertRows(table, columns, rows) {
  if (!rows.length) return 0;
  const placeholders = rows.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
  const flat = rows.flatMap((r) => columns.map((c) => r[c] ?? null));
  await db.pool.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`, flat);
  return rows.length;
}

(async () => {
  await db.ready;

  for (const t of ['users', 'devices', 'borrows', 'message_log', 'corp_config']) {
    if ((await tableCount(t)) > 0) {
      console.error(`MySQL 表 ${t} 非空，中止迁移（避免重复导入）`);
      process.exit(1);
    }
  }

  const sqlitePath = path.resolve(__dirname, '..', process.env.SQLITE_FILE || './data/app.db');
  if (!fs.existsSync(sqlitePath)) {
    console.log('未找到 SQLite 文件，跳过迁移（全新部署）');
    process.exit(0);
  }
  const sqlite = new Database(sqlitePath, { readonly: true });
  const all = (sql) => sqlite.prepare(sql).all();

  const fallbackOwner = config.adminUserids[0] || '';
  const cleanOwner = (uid) => (!uid || DEV_USERIDS.includes(uid) ? fallbackOwner : uid);

  const users = all('SELECT * FROM users').filter((u) => !DEV_USERIDS.includes(u.userid));
  console.log(`users: ${users.length}（已剔除内置测试账号 ${DEV_USERIDS.join('/')}）`);
  await insertRows('users', ['id', 'userid', 'name', 'avatar', 'role', 'created_at'], users);

  const devices = all('SELECT * FROM devices').map((d) => ({ ...d, owner_userid: cleanOwner(d.owner_userid) }));
  console.log(`devices: ${devices.length}`);
  await insertRows(
    'devices',
    ['id', 'name', 'category', 'model', 'serial_no', 'status', 'location', 'image', 'owner_userid', 'remark', 'created_at', 'updated_at'],
    devices
  );

  const borrows = all('SELECT * FROM borrows');
  console.log(`borrows: ${borrows.length}`);
  await insertRows(
    'borrows',
    ['id', 'device_id', 'borrower_userid', 'reason', 'expect_return_date', 'borrow_photo', 'approver_userid', 'status', 'reject_reason', 'return_photo', 'return_reject_reason', 'apply_at', 'approve_at', 'return_apply_at', 'finish_at', 'updated_at'],
    borrows
  );

  const messages = all('SELECT * FROM message_log');
  console.log(`message_log: ${messages.length}`);
  await insertRows('message_log', ['id', 'to_userid', 'title', 'description', 'url', 'mock', 'sent', 'error', 'created_at'], messages);

  const corp = all('SELECT * FROM corp_config');
  console.log(`corp_config: ${corp.length}`);
  await insertRows('corp_config', ['id', 'corpid', 'corp_name', 'agentid', 'permanent_code', 'suite_ticket', 'suite_ticket_at', 'installed_at'], corp);

  // 外键指向被删测试账号的历史借单不阻碍迁移（borrower/approver 是字符串无外键），
  // 但为保审批链路一致，把测试账号名下的待办借单审批人改指当前管理员
  if (fallbackOwner) {
    await db.pool.query('UPDATE devices SET owner_userid=? WHERE owner_userid=? OR owner_userid=?', [
      fallbackOwner,
      '',
      fallbackOwner,
    ]);
    await db.pool.query(
      "UPDATE borrows SET approver_userid=? WHERE approver_userid IN ('zhangsan','lisi','wangwu') AND status IN ('pending','returning')",
      [fallbackOwner]
    );
  }

  sqlite.close();
  await db.pool.end();
  console.log('✓ 迁移完成');
  process.exit(0);
})().catch((e) => {
  console.error('迁移失败:', e);
  process.exit(1);
});
