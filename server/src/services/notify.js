/**
 * 审批相关消息通知：先落库（审计 + DEV_MODE 下可查看），再尝试走企微应用消息。
 * 借出/归均按「申请组」通知（一次申请可含多台设备）：
 *  - 借出申请 / 归还申请 -> 全部管理员（任一管理员可处理）
 *  - 审批结果 / 归还确认结果 -> 借出人
 */
const db = require('../db');
const config = require('../config');
const feishu = require('./feishu');

async function notify({ toUserid, title, description, url }) {
  if (!toUserid) return;
  const logId = await db.addMessage({ to_userid: toUserid, title, description, url });
  try {
    // 通知统一走飞书卡片；未绑定飞书的账号无法送达（需在飞书打开应用登录一次完成绑定）
    const user = await db.getUser(toUserid);
    if (!user || !user.feishu_openid) {
      throw new Error(`${toUserid} 未绑定飞书（请在飞书打开应用登录一次完成绑定）`);
    }
    const r = await feishu.sendCard({ openId: user.feishu_openid, title, html: description, url });
    await db.finishMessage(logId, { mock: r.mock, sent: !r.mock, error: '' });
  } catch (e) {
    await db.finishMessage(logId, { mock: false, sent: false, error: String(e.message || e) });
  }
}

const pageUrl = (path) => `${config.baseUrl}${path}`;

/** 申请组设备描述：「A、B、C」或「A 等 N 台」 */
const devicesText = (group) => {
  const names = group.devices.map((d) => d.name);
  return names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')} 等${names.length}台`;
};

/** 审批类通知的接收人：全部管理员（users 表 admin 角色 ∪ .env ADMIN_USERIDS，去重） */
async function adminRecipients() {
  const admins = await db.listAdmins();
  return [...new Set([...admins, ...config.adminUserids])];
}

/** 审批类通知的接收人：申请所选审批人名单（为空时兜底全部管理员） */
async function broadcast(payload, recipients) {
  const list = (recipients && recipients.length ? recipients : null) || (await adminRecipients());
  return Promise.all(list.map((toUserid) => notify({ toUserid, ...payload })));
}

// 借出申请 -> 所选审批人
function borrowApplyNotify(group) {
  const payload = {
    title: '设备借出审批',
    description: `<div class="gray">${group.apply_at}</div><div class="normal">${group.borrower_name} 申请借用「${devicesText(group)}」（${group.devices.length}台）</div><div class="highlight">事由：${group.reason}</div><div class="gray">应归还日期：${group.expect_return_date}</div>`,
    url: pageUrl(`/borrow/${group.id}`),
  };
  return broadcast(payload, group.approver_userids);
}

// 借出审批结果 -> 借出人（通过后进入领用环节）
function borrowResultNotify(group, approved, reason = '') {
  return notify({
    toUserid: group.borrower_userid,
    title: approved ? '借出申请已通过，请领用设备' : '借出申请被驳回',
    description: approved
      ? `你申请借用的「${devicesText(group)}」已通过审批，请前往领用设备，领用时需现场拍照确认（应于 ${group.expect_return_date} 前归还）。`
      : `你申请借用的「${devicesText(group)}」被驳回。原因：${reason || '未填写'}`,
    url: pageUrl(`/borrow/${group.id}`),
  });
}

// 领用确认 -> 审批人（核对领用照片）
function claimApplyNotify(group) {
  return broadcast({
    title: '设备领用确认',
    description: `${group.borrower_name} 已拍摄领用照片（「${devicesText(group)}」共${group.devices.length}台），请核对后确认领用。`,
    url: pageUrl(`/borrow/${group.id}`),
  }, group.approver_userids);
}

// 领用确认结果 -> 借出人
function claimResultNotify(group, approved, reason = '') {
  return notify({
    toUserid: group.borrower_userid,
    title: approved ? '领用已确认，设备借出' : '领用照片被驳回',
    description: approved
      ? `「${devicesText(group)}」领用已确认，设备正式借出，请按时于 ${group.expect_return_date} 前归还。`
      : `「${devicesText(group)}」领用照片被驳回，请重新拍照领用。原因：${reason || '未填写'}`,
    url: pageUrl(`/borrow/${group.id}`),
  });
}

// 归还申请 -> 所选审批人
function returnApplyNotify(group) {
  const payload = {
    title: '设备归还确认',
    description: `${group.borrower_name} 已归还「${devicesText(group)}」（${group.devices.length}台），请核对归还照片并确认。`,
    url: pageUrl(`/borrow/${group.id}`),
  };
  return broadcast(payload, group.approver_userids);
}

// 归还确认结果 -> 借出人
function returnResultNotify(group, approved, reason = '') {
  return notify({
    toUserid: group.borrower_userid,
    title: approved ? '归还已确认' : '归还确认被驳回',
    description: approved
      ? `「${devicesText(group)}」归还已确认，设备已回库，感谢配合。`
      : `「${devicesText(group)}」归还确认被驳回。原因：${reason || '未填写'}`,
    url: pageUrl(`/borrow/${group.id}`),
  });
}

module.exports = { borrowApplyNotify, borrowResultNotify, claimApplyNotify, claimResultNotify, returnApplyNotify, returnResultNotify };
