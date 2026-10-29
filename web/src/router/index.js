import { createRouter, createWebHistory } from 'vue-router';
import { showToast } from 'vant';
import { fetchMe, user } from '../store';

const routes = [
  { path: '/', name: 'home', component: () => import('../views/Home.vue'), meta: { tabbar: true, title: '设备管理' } },
  { path: '/device/new', name: 'deviceNew', component: () => import('../views/DeviceEdit.vue'), meta: { title: '新增设备', admin: true } },
  { path: '/device/:id(\\d+)', name: 'deviceDetail', component: () => import('../views/DeviceDetail.vue'), meta: { title: '设备详情' } },
  { path: '/device/:id(\\d+)/edit', name: 'deviceEdit', component: () => import('../views/DeviceEdit.vue'), meta: { title: '编辑设备', admin: true } },
  { path: '/borrow/new', name: 'selectDevice', component: () => import('../views/SelectDevice.vue'), meta: { title: '申请设备借出' } },
  { path: '/borrow/apply', name: 'borrowApply', component: () => import('../views/BorrowApply.vue'), meta: { title: '填写借出申请' } },
  { path: '/borrow/:id(\\d+)', name: 'borrowDetail', component: () => import('../views/ApprovalDetail.vue'), meta: { title: '借单详情' } },
  { path: '/my-borrows', name: 'myBorrows', component: () => import('../views/MyBorrows.vue'), meta: { tabbar: true, title: '我的借还' } },
  { path: '/approvals', name: 'approvals', component: () => import('../views/ApprovalList.vue'), meta: { tabbar: true, title: '审批' } },
  { path: '/records', name: 'borrowRecords', component: () => import('../views/BorrowRecords.vue'), meta: { admin: true, title: '借还记录' } },
  { path: '/superadmin', name: 'superAdmin', component: () => import('../views/SuperAdmin.vue'), meta: { super: true, title: '超级管理' } },
  // 外部借用（/m）：UI 与企微内一致，独立会话，不走企微登录检查
  { path: '/m', name: 'externalHome', component: () => import('../views/ExternalHome.vue'), meta: { public: true, title: '设备借用' } },
  { path: '/m/borrows', name: 'externalBorrowList', component: () => import('../views/ExternalBorrowList.vue'), meta: { public: true, title: '我的借还' } },
  { path: '/m/select', name: 'externalSelect', component: () => import('../views/ExternalSelect.vue'), meta: { public: true, title: '申请设备借出' } },
  { path: '/m/apply', name: 'externalApply', component: () => import('../views/ExternalApply.vue'), meta: { public: true, title: '填写借出申请' } },
  { path: '/m/borrow/:id(\\d+)', name: 'externalBorrowDetail', component: () => import('../views/ExternalBorrowDetail.vue'), meta: { public: true, title: '借单详情' } },
  { path: '/f', name: 'feishuEntry', component: () => import('../views/FeishuEntry.vue'), meta: { public: true, title: '设备管理' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  document.title = to.meta.title ? `${to.meta.title} · 设备管理` : '设备管理';
  // 超管入口使用独立账号密码会话，不走企微登录检查
  if (to.meta.super) return true;
  // 外部微信扫码借用页：独立会话，不走企微登录检查
  if (to.meta.public) return true;
  let me;
  try {
    me = await fetchMe();
  } catch {
    return false; // 401 时 api.js 已跳转登录
  }
  if (to.meta.admin && me.role !== 'admin') {
    showToast('该功能需要管理员权限');
    return '/';
  }
  return true;
});

export default router;
