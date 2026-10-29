/** 开发模式内置测试账号（仅 DEV_MODE=true 时存在，模拟企业微信成员） */
module.exports = [
  { userid: 'zhangsan', name: '张三' }, // .env ADMIN_USERIDS 含 zhangsan，登录后为管理员
  { userid: 'lisi', name: '李四' },
  { userid: 'wangwu', name: '王五' },
];
