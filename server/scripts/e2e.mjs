/**
 * 端到端流程测试（DEV_MODE）：
 * 先启动服务（node src/index.js），再运行: node scripts/e2e.mjs [baseUrl]
 * 覆盖：管理员建设备 -> 成员选设备申请借用（上传照片） -> 负责人审批
 *       -> 成员拍照归还 -> 负责人确认归还 -> 状态与消息通知校验。
 */
const BASE = process.argv[2] || 'http://localhost:3000';

const jars = {};
async function api(user, method, path, body, isForm) {
  const headers = {};
  if (jars[user]) headers.Cookie = jars[user];
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    redirect: 'manual', // 登录接口 302 时需要拿到 Set-Cookie，不跟随
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jars[user] = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const must = (cond, label) => {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
};

// 1x1 红色像素 PNG
const pngB64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const photoBlob = () => new Blob([Buffer.from(pngB64, 'base64')], { type: 'image/png' });

async function upload(user, label) {
  const form = new FormData();
  form.append('file', photoBlob(), `${label}.png`);
  const r = await api(user, 'POST', '/api/upload', form, true);
  must(r.status === 200 && r.data.url?.startsWith('/uploads/'), `${user} 上传照片成功 (${r.data.url})`);
  return r.data.url;
}

(async () => {
  // 登录三个测试账号
  for (const u of ['zhangsan', 'lisi', 'wangwu']) {
    const r = await api(u, 'GET', `/api/auth/dev-login?u=${u}`);
    must(r.status === 200 || r.status === 302, `${u} 开发登录`);
  }
  const me = await api('zhangsan', 'GET', '/api/auth/me');
  must(me.data.user.role === 'admin', '张三为管理员');

  // 管理员新增设备（负责人 = 王五，即借还审批人）
  const dev = await api('zhangsan', 'POST', '/api/devices', {
    name: 'Sony A7M4 相机',
    category: '相机',
    model: 'ILCE-7M4',
    serial_no: 'SN-2026-001',
    location: '器材室A柜',
    owner_userid: 'wangwu',
    remark: '含 24-70 镜头',
  });
  must(dev.status === 200 && dev.data.device.owner_name === '王五', `建设备成功：${dev.data.device.name} / 负责人 ${dev.data.device.owner_name}`);
  const deviceId = dev.data.device.id;

  // 分类与列表
  const cats = await api('lisi', 'GET', '/api/devices/categories');
  must(cats.data.items.some((c) => c.name === '相机'), '分类列表包含「相机」');

  // 非负责人不能审批、成员不能建设备
  const noPerm = await api('lisi', 'POST', '/api/devices', { name: 'x' });
  must(noPerm.status === 403, '成员建设备被拒绝（403）');

  // 李四申请借用
  const photo1 = await upload('lisi', 'borrow');
  const apply = await api('lisi', 'POST', '/api/borrows', {
    device_id: deviceId,
    reason: '栏目外拍，需要全画幅相机',
    expect_return_date: '2026-09-20',
    borrow_photo: photo1,
  });
  must(apply.status === 200 && apply.data.borrow.status === 'pending', '借出申请提交，状态=待审批，审批人=' + apply.data.borrow.approver_userid);
  const borrowId = apply.data.borrow.id;

  // 缺照片应被拒绝
  const badApply = await api('lisi', 'POST', '/api/borrows', {
    device_id: deviceId,
    reason: 'test',
    expect_return_date: '2026-09-20',
    borrow_photo: '',
  });
  must(badApply.status === 400, '缺少借出照片被拒绝');

  // 借出中的设备不能删除
  // （先审批通过再验证删除保护）
  const todo = await api('wangwu', 'GET', '/api/borrows?tab=todo');
  must(todo.data.total === 1, '王五待办收到 1 条借出审批');

  const approve = await api('wangwu', 'POST', `/api/borrows/${borrowId}/approve`);
  must(approve.status === 200 && approve.data.borrow.status === 'approved', '王五审批通过，状态=使用中');
  const devAfter = await api('lisi', 'GET', `/api/devices/${deviceId}`);
  must(devAfter.data.device.status === 'borrowed', '设备状态变为已借出');
  must(devAfter.data.activeBorrow?.borrower_name === '李四', '设备详情返回当前借用人');

  // 重复申请被拒
  const dup = await api('lisi', 'POST', '/api/borrows', {
    device_id: deviceId,
    reason: '再借一次',
    expect_return_date: '2026-09-21',
    borrow_photo: photo1,
  });
  must(dup.status === 400, '已借出设备再次申请被拒绝');

  const delDeny = await api('zhangsan', 'DELETE', `/api/devices/${deviceId}`);
  must(delDeny.status === 400, '借出中设备删除被拒绝');

  // 李四归还（拍照）
  const photo2 = await upload('lisi', 'return');
  const ret = await api('lisi', 'POST', `/api/borrows/${borrowId}/return`, { return_photo: photo2 });
  must(ret.status === 200 && ret.data.borrow.status === 'returning', '归还申请提交，状态=归还待确认');

  // 只有原审批人能确认归还
  const notApprover = await api('zhangsan', 'POST', `/api/borrows/${borrowId}/return-approve`);
  must(notApprover.status === 403, '非该借单审批人确认归还被拒绝');

  const ra = await api('wangwu', 'POST', `/api/borrows/${borrowId}/return-approve`);
  must(ra.status === 200 && ra.data.borrow.status === 'returned', '王五确认归还，状态=已归还');
  const devFinal = await api('lisi', 'GET', `/api/devices/${deviceId}`);
  must(devFinal.data.device.status === 'idle', '设备回到在库');

  // 消息通知落库校验（生产模式下同步推送企微），取最近 4 条 = 本轮流程
  const { fileURLToPath } = await import('url');
  const Database = (await import('better-sqlite3')).default;
  const logs = new Database(fileURLToPath(new URL('../data/app.db', import.meta.url)))
    .prepare('SELECT to_userid, title FROM message_log ORDER BY id DESC LIMIT 4')
    .all()
    .reverse();
  const titles = logs.map((m) => `${m.to_userid}:${m.title}`).join(' | ');
  const expect = ['wangwu:设备借出审批', 'lisi:借出申请已通过', 'wangwu:设备归还确认', 'lisi:归还已确认'];
  must(
    logs.length === 4 && expect.every((e, i) => `${logs[i].to_userid}:${logs[i].title}` === e),
    `消息通知 4 条依次为：${titles}`
  );

  console.log('\n全部通过 ✅');
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
