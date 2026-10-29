/** 设备编号展示格式：id -> DEV-0001 */
export function deviceIdText(id) {
  return `DEV-${String(id).padStart(4, '0')}`;
}

/** 申请组设备描述：「A、B、C」或「A 等 N 台」 */
export function devicesText(group) {
  const names = (group.devices || []).map((d) => d.name);
  if (!names.length) return '';
  return names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')} 等${names.length}台`;
}

/** 设备 / 借单状态文案与标签颜色 */
export const DEVICE_STATUS_TEXT = { idle: '在库', borrowed: '已借出', disabled: '停用' };
export const DEVICE_STATUS_TYPE = { idle: 'success', borrowed: 'default', disabled: 'danger' };

export const BORROW_STATUS_TEXT = {
  pending: '待审批',
  claiming: '待领用',
  claim_confirming: '领用待确认',
  approved: '使用中',
  rejected: '已驳回',
  returning: '归还待确认',
  returned: '已归还',
  return_rejected: '归还驳回',
};
export const BORROW_STATUS_TYPE = {
  pending: 'warning',
  claiming: 'primary',
  claim_confirming: 'warning',
  approved: 'primary',
  rejected: 'danger',
  returning: 'warning',
  returned: 'success',
  return_rejected: 'danger',
};

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 借用未结束且已过应归还日期 */
export function isOverdue(borrow) {
  if (!['approved', 'returning', 'return_rejected'].includes(borrow.status)) return false;
  return borrow.expect_return_date < today();
}
