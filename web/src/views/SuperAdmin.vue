<script setup>
/** /superadmin 隐藏超管入口：PC 控制台（账号密码在 .env 配置，独立于企微账号体系） */
import { ref, reactive, computed, onMounted } from 'vue';
import apiSuper from '../api-super';
import { DEVICE_STATUS_TEXT, BORROW_STATUS_TEXT, isOverdue, deviceIdText, devicesText } from '../utils/status';

/* ---------- 会话 ---------- */
const authed = ref(false);
const checking = ref(true);
const loginForm = reactive({ username: '', password: '' });
const loginError = ref('');
const loggingIn = ref(false);

async function tryResume() {
  try {
    await apiSuper.get('/me');
    authed.value = true;
    enterConsole();
  } catch {
    authed.value = false;
  } finally {
    checking.value = false;
  }
}

async function login() {
  if (!loginForm.username || !loginForm.password) {
    loginError.value = '请输入账号和密码';
    return;
  }
  loginError.value = '';
  loggingIn.value = true;
  try {
    await apiSuper.post('/login', { ...loginForm });
    authed.value = true;
    enterConsole();
  } catch (e) {
    loginError.value = e.response?.data?.error || '登录失败';
  } finally {
    loggingIn.value = false;
  }
}

async function logout() {
  try {
    await apiSuper.post('/logout');
  } catch {
    /* 忽略 */
  }
  authed.value = false;
  loginForm.username = '';
  loginForm.password = '';
}

/* ---------- 控制台框架 ---------- */
const tab = ref('overview');
const toast = ref('');
let toastTimer = null;
function showToastMsg(msg, isError = false) {
  toast.value = msg;
  toastClass.value = isError ? 'toast error' : 'toast';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 2600);
}
const toastClass = ref('toast');

function enterConsole() {
  tab.value = 'overview';
  loadOverview();
}

function switchTab(t) {
  tab.value = t;
  if (t === 'overview') loadOverview();
  if (t === 'devices') reloadDevices();
  if (t === 'borrows') reloadBorrows();
  if (t === 'users') loadUsers();
  if (t === 'system') loadSystem();
}

/* ---------- 概览 ---------- */
const overview = ref(null);
async function loadOverview() {
  try {
    overview.value = await apiSuper.get('/overview');
  } catch (e) {
    handle401(e);
  }
}

/* ---------- 设备管理 ---------- */
const devices = reactive({ items: [], total: 0, page: 1, pageSize: 10, categories: [] });
const deviceQuery = reactive({ keyword: '', category: '', status: '' });
const deviceLoading = ref(false);

async function loadDevices() {
  deviceLoading.value = true;
  try {
    const res = await apiSuper.get('/devices', {
      params: {
        keyword: deviceQuery.keyword,
        category: deviceQuery.category,
        status: deviceQuery.status,
        page: devices.page,
        pageSize: devices.pageSize,
      },
    });
    devices.items = res.items;
    devices.total = res.total;
    devices.categories = res.categories;
  } catch (e) {
    handle401(e);
  } finally {
    deviceLoading.value = false;
  }
}
function reloadDevices() {
  devices.page = 1;
  loadDevices();
}
function searchDevices() {
  reloadDevices();
}
const devicePageCount = computed(() => Math.max(1, Math.ceil(devices.total / devices.pageSize)));
function pageDevices(delta) {
  const next = devices.page + delta;
  if (next < 1 || next > devicePageCount.value) return;
  devices.page = next;
  loadDevices();
}

/* 设备新增/编辑弹窗 */
const deviceModal = ref(null); // { id?, name, category, model, serial_no, location, remark, image }
const deviceSaving = ref(false);
function openDeviceCreate() {
  deviceModal.value = { id: null, name: '', category: '', model: '', serial_no: '', location: '', remark: '', images: [] };
}
function openDeviceEdit(d) {
  deviceModal.value = {
    id: d.id,
    name: d.name,
    category: d.category,
    model: d.model,
    serial_no: d.serial_no,
    location: d.location,
    remark: d.remark,
    images: d.images && d.images.length ? d.images : d.image ? [d.image] : [],
  };
}
async function saveDevice() {
  const m = deviceModal.value;
  if (!m.name.trim()) return showToastMsg('请填写设备名称', true);
  deviceSaving.value = true;
  try {
    if (m.id) {
      await apiSuper.put(`/devices/${m.id}`, { ...m, images: m.images });
      showToastMsg('已保存');
    } else {
      await apiSuper.post('/devices', { ...m, images: m.images });
      showToastMsg('设备已添加');
    }
    deviceModal.value = null;
    loadDevices();
  } catch (e) {
    showToastMsg(e.response?.data?.error || '保存失败', true);
    handle401(e);
  } finally {
    deviceSaving.value = false;
  }
}

/* 设备图片上传 */
const uploadingImage = ref(false);
function removeModalImage(i) {
  deviceModal.value.images.splice(i, 1);
}
async function onImagePick(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  uploadingImage.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiSuper.post('/upload', fd);
    deviceModal.value.images.push(res.url);
  } catch (e) {
    showToastMsg(e.response?.data?.error || '上传失败', true);
  } finally {
    uploadingImage.value = false;
  }
}

/* 状态切换 / 删除 */
async function changeStatus(d, status) {
  try {
    await apiSuper.patch(`/devices/${d.id}/status`, { status });
    showToastMsg(`「${d.name}」已设为${DEVICE_STATUS_TEXT[status]}`);
    loadDevices();
  } catch (e) {
    showToastMsg(e.response?.data?.error || '操作失败', true);
    handle401(e);
    loadDevices();
  }
}
async function removeDevice(d) {
  if (!window.confirm(`确定删除「${d.name}」吗？删除后不可恢复。`)) return;
  try {
    await apiSuper.delete(`/devices/${d.id}`);
    showToastMsg('已删除');
    loadDevices();
  } catch (e) {
    showToastMsg(e.response?.data?.error || '删除失败', true);
    handle401(e);
  }
}

/* ---------- 借单管理 ---------- */
const borrows = reactive({ items: [], total: 0, page: 1, pageSize: 10 });
const borrowStatus = ref('');
const borrowRange = ref(30); // 默认最近30天
const borrowLoading = ref(false);
const reasonModal = ref(null); // { title, action, id, reason }

async function loadBorrows() {
  borrowLoading.value = true;
  try {
    const res = await apiSuper.get('/borrows', {
      params: { status: borrowStatus.value, days: borrowRange.value, page: borrows.page, pageSize: borrows.pageSize },
    });
    borrows.items = res.items;
    borrows.total = res.total;
  } catch (e) {
    handle401(e);
  } finally {
    borrowLoading.value = false;
  }
}
function reloadBorrows() {
  borrows.page = 1;
  loadBorrows();
}
const borrowPageCount = computed(() => Math.max(1, Math.ceil(borrows.total / borrows.pageSize)));
function pageBorrows(delta) {
  const next = borrows.page + delta;
  if (next < 1 || next > borrowPageCount.value) return;
  borrows.page = next;
  loadBorrows();
}

async function borrowAction(id, action, reason = '') {
  try {
    await apiSuper.post(`/borrows/${id}/${action}`, { reason });
    showToastMsg('操作成功');
    loadBorrows();
  } catch (e) {
    showToastMsg(e.response?.data?.error || '操作失败', true);
    handle401(e);
  }
}
function actApprove(b) {
  if (window.confirm(`通过 ${b.borrower_name} 借用「${b.device_name}」的申请？`)) borrowAction(b.id, 'approve');
}
function actReject(b) {
  reasonModal.value = { title: '驳回借出申请', action: 'reject', id: b.id, reason: '' };
}
function actClaimApprove(b) {
  if (window.confirm(`确认 ${b.borrower_name} 已领用「${devicesText(b)}」？设备将置为借出状态。`)) {
    borrowAction(b.id, 'claim-approve');
  }
}
function actReturnApprove(b) {
  if (window.confirm(`确认「${b.device_name}」已归还入库？`)) borrowAction(b.id, 'return-approve');
}
function actReturnReject(b) {
  reasonModal.value = { title: '驳回归还申请', action: 'return-reject', id: b.id, reason: '' };
}
function actForceReturn(b) {
  if (window.confirm(`强制完成「${b.device_name}」的借单？设备将直接回库。`)) borrowAction(b.id, 'force-return');
}
async function confirmReason() {
  const m = reasonModal.value;
  if (!m.reason.trim()) return showToastMsg('请填写原因', true);
  await borrowAction(m.id, m.action, m.reason.trim());
  reasonModal.value = null;
}

/* ---------- 成员管理（企业微信通讯录同步） ---------- */
const users = ref([]);
const syncing = ref(false);

async function loadUsers() {
  try {
    const res = await apiSuper.get('/users');
    users.value = res.items;
  } catch (e) {
    handle401(e);
  }
}

async function syncWecomUsers() {
  syncing.value = true;
  try {
    const res = await apiSuper.post('/users/sync-wecom');
    users.value = res.items;
    showToastMsg(`已同步 ${res.synced} 名成员`);
  } catch (e) {
    showToastMsg(e.response?.data?.error || '同步失败', true);
    handle401(e);
  } finally {
    syncing.value = false;
  }
}

async function changeRole(u, role) {
  if (u.role === role) return;
  try {
    await apiSuper.patch(`/users/${u.userid}/role`, { role });
    u.role = role;
    showToastMsg(`已将 ${u.name || u.userid} 设为${role === 'admin' ? '管理员' : '成员'}`);
  } catch (e) {
    showToastMsg(e.response?.data?.error || '操作失败', true);
    handle401(e);
  }
}

/* ---------- 系统设置（系统开关 + 公告管理） ---------- */
const sysSettings = ref({ systemClosed: false, closeReason: '' });
const sysLoading = ref(false);
const sysSaving = ref(false);

async function loadSystem() {
  sysLoading.value = true;
  try {
    const [settings, anns] = await Promise.all([apiSuper.get('/settings'), apiSuper.get('/announcements')]);
    sysSettings.value = { systemClosed: settings.systemClosed, closeReason: settings.closeReason || '' };
    announcements.value = anns.items;
  } catch (e) {
    handle401(e);
  } finally {
    sysLoading.value = false;
  }
}

async function saveSystemSettings() {
  const s = sysSettings.value;
  if (s.systemClosed && !s.closeReason.trim()) return showToastMsg('关闭系统时请填写关闭原因', true);
  if (!window.confirm(s.systemClosed
    ? '确定关闭系统吗？关闭后所有用户将无法提交新的借用申请。'
    : '确定开启系统吗？开启后用户可正常提交借用申请。')) return;
  sysSaving.value = true;
  try {
    const res = await apiSuper.put('/settings', { systemClosed: s.systemClosed, closeReason: s.closeReason.trim() });
    sysSettings.value = { systemClosed: res.systemClosed, closeReason: res.closeReason || '' };
    showToastMsg(res.systemClosed ? '系统已关闭' : '系统已开启');
  } catch (e) {
    showToastMsg(e.response?.data?.error || '保存失败', true);
    handle401(e);
  } finally {
    sysSaving.value = false;
  }
}

const announcements = ref([]);
const annModal = ref(null); // { id?, title, content, enabled }
const annSaving = ref(false);

function openAnnCreate() {
  annModal.value = { id: null, title: '', content: '', enabled: true };
}
function openAnnEdit(a) {
  annModal.value = { id: a.id, title: a.title, content: a.content, enabled: Boolean(a.enabled) };
}
async function saveAnn() {
  const m = annModal.value;
  if (!m.title.trim()) return showToastMsg('请填写公告标题', true);
  annSaving.value = true;
  try {
    if (m.id) {
      await apiSuper.put(`/announcements/${m.id}`, { ...m });
      showToastMsg('公告已保存');
    } else {
      await apiSuper.post('/announcements', { ...m });
      showToastMsg('公告已发布');
    }
    annModal.value = null;
    announcements.value = (await apiSuper.get('/announcements')).items;
  } catch (e) {
    showToastMsg(e.response?.data?.error || '保存失败', true);
    handle401(e);
  } finally {
    annSaving.value = false;
  }
}
async function toggleAnn(a) {
  try {
    await apiSuper.put(`/announcements/${a.id}`, { title: a.title, content: a.content, enabled: !a.enabled });
    a.enabled = a.enabled ? 0 : 1;
    showToastMsg(a.enabled ? '公告已启用' : '公告已停用');
  } catch (e) {
    showToastMsg(e.response?.data?.error || '操作失败', true);
    handle401(e);
  }
}
async function removeAnn(a) {
  if (!window.confirm(`确定删除公告「${a.title}」吗？`)) return;
  try {
    await apiSuper.delete(`/announcements/${a.id}`);
    announcements.value = announcements.value.filter((x) => x.id !== a.id);
    showToastMsg('已删除');
  } catch (e) {
    showToastMsg(e.response?.data?.error || '删除失败', true);
    handle401(e);
  }
}

/* ---------- 通用 ---------- */
function handle401(e) {
  if (e?.unauthorized) {
    authed.value = false;
  }
}
function fmtTime(s) {
  return s ? String(s).replace('T', ' ') : '';
}

onMounted(tryResume);
</script>

<template>
  <!-- 登录视图 -->
  <div v-if="checking" class="login-wrap"><div class="login-card">正在检查会话…</div></div>
  <div v-else-if="!authed" class="login-wrap">
    <form class="login-card" @submit.prevent="login">
      <div class="login-logo"><img src="/logo.png?v=20260918" alt="logo" /></div>
      <h1>设备管理控制台</h1>
      <p class="login-sub">Super Admin</p>
      <input v-model="loginForm.username" type="text" placeholder="账号" autocomplete="username" />
      <input v-model="loginForm.password" type="password" placeholder="密码" autocomplete="current-password" />
      <div v-if="loginError" class="login-error">{{ loginError }}</div>
      <button type="submit" :disabled="loggingIn">{{ loggingIn ? '登录中…' : '登 录' }}</button>
    </form>
  </div>

  <!-- 控制台 -->
  <div v-else class="shell">
    <aside class="side">
      <div class="side-logo"><img src="/logo.png?v=20260918" alt="设备管理" /><span class="side-logo-txt">设备管理</span></div>
      <nav>
        <a :class="{ active: tab === 'overview' }" @click="switchTab('overview')">📊 概览</a>
        <a :class="{ active: tab === 'devices' }" @click="switchTab('devices')">📦 设备管理</a>
        <a :class="{ active: tab === 'borrows' }" @click="switchTab('borrows')">🔄 借单管理</a>
        <a :class="{ active: tab === 'users' }" @click="switchTab('users')">👥 成员管理</a>
        <a :class="{ active: tab === 'system' }" @click="switchTab('system')">⚙️ 系统设置</a>
      </nav>
      <button class="logout" @click="logout">退出登录</button>
    </aside>

    <main class="main">
      <!-- 概览 -->
      <section v-if="tab === 'overview'">
        <h2>概览</h2>
        <div v-if="overview" class="cards">
          <div class="card"><b>{{ overview.devices.total }}</b><span>设备总数</span></div>
          <div class="card ok"><b>{{ overview.devices.idle }}</b><span>在库</span></div>
          <div class="card warn"><b>{{ overview.devices.borrowed }}</b><span>已借出</span></div>
          <div class="card err"><b>{{ overview.devices.disabled }}</b><span>停用</span></div>
          <div class="card"><b>{{ overview.borrows.active }}</b><span>进行中借单</span></div>
          <div class="card warn"><b>{{ overview.borrows.pendingApproval }}</b><span>待审批</span></div>
          <div class="card warn"><b>{{ overview.borrows.returning }}</b><span>归还待确认</span></div>
          <div class="card"><b>{{ overview.users }}</b><span>成员数</span></div>
        </div>
      </section>

      <!-- 设备管理 -->
      <section v-if="tab === 'devices'">
        <div class="section-head">
          <h2>设备管理</h2>
          <button class="btn primary" @click="openDeviceCreate">＋ 新增设备</button>
        </div>
        <div class="filters">
          <input v-model="deviceQuery.keyword" placeholder="搜索名称/型号/序列号" @keyup.enter="searchDevices" />
          <select v-model="deviceQuery.category" @change="searchDevices">
            <option value="">全部分类</option>
            <option v-for="c in devices.categories" :key="c.name" :value="c.name">{{ c.name }}（{{ c.count }}）</option>
          </select>
          <select v-model="deviceQuery.status" @change="searchDevices">
            <option value="">全部状态</option>
            <option value="idle">在库</option>
            <option value="borrowed">已借出</option>
            <option value="disabled">停用</option>
          </select>
          <button class="btn" @click="searchDevices">查询</button>
        </div>
        <div class="tbl-wrap"><table class="tbl">
          <thead>
            <tr>
              <th>编号</th><th>设备</th><th>分类</th><th>型号</th><th>序列号</th><th>位置</th><th>负责人</th><th>状态</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in devices.items" :key="d.id">
              <td class="mono">{{ deviceIdText(d.id) }}</td>
              <td class="dev-cell">
                <img v-if="d.image" :src="d.image" class="thumb" />
                <span class="dev-name">{{ d.name }}</span>
              </td>
              <td>{{ d.category }}</td>
              <td>{{ d.model || '—' }}</td>
              <td>{{ d.serial_no || '—' }}</td>
              <td>{{ d.location || '—' }}</td>
              <td>{{ d.owner_name || '—' }}</td>
              <td>
                <select v-if="d.status !== 'borrowed'" class="status-select" :value="d.status" @change="changeStatus(d, $event.target.value)">
                  <option value="idle">在库</option>
                  <option value="disabled">停用</option>
                </select>
                <span v-else class="badge borrowed">已借出</span>
              </td>
              <td class="ops">
                <button class="btn sm" @click="openDeviceEdit(d)">编辑</button>
                <button class="btn sm danger" @click="removeDevice(d)">删除</button>
              </td>
            </tr>
            <tr v-if="!devices.items.length && !deviceLoading">
              <td colspan="9" class="empty">暂无设备</td>
            </tr>
          </tbody>
        </table></div>
        <div class="pager" v-if="devices.total > devices.pageSize">
          <button class="btn sm" :disabled="devices.page <= 1" @click="pageDevices(-1)">上一页</button>
          <span>{{ devices.page }} / {{ devicePageCount }}（共 {{ devices.total }} 条）</span>
          <button class="btn sm" :disabled="devices.page >= devicePageCount" @click="pageDevices(1)">下一页</button>
        </div>
      </section>

      <!-- 借单管理 -->
      <section v-if="tab === 'borrows'">
        <div class="section-head">
          <h2>借单管理</h2>
          <select v-model="borrowRange" @change="reloadBorrows" class="status-filter">
            <option :value="7">最近7天</option>
            <option :value="30">最近30天</option>
            <option :value="90">最近90天</option>
            <option :value="0">全部记录</option>
          </select>
          <select v-model="borrowStatus" @change="reloadBorrows" class="status-filter">
            <option value="">全部状态</option>
            <option v-for="(text, key) in BORROW_STATUS_TEXT" :key="key" :value="key">{{ text }}</option>
          </select>
        </div>
        <div class="tbl-wrap"><table class="tbl">
          <thead>
            <tr>
              <th>设备</th><th>借出人</th><th>事由</th><th>应归还</th><th>状态</th><th>审批人</th><th>申请时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in borrows.items" :key="b.id">
              <td>
                <div class="dev-names">
                  <span class="dev-count">{{ b.devices?.length || 0 }}台</span>
                  <span class="dev-names-txt" :title="(b.devices || []).map(d => d.name).join('、')">{{ devicesText(b) }}</span>
                </div>
              </td>
              <td>{{ b.borrower_name }}</td>
              <td>
                <div class="reason" :title="b.reason">
                  {{ b.reason }}
                  <div v-if="b.status === 'rejected'" class="reject-line">驳回：{{ b.reject_reason || '未填写' }}</div>
                  <div v-else-if="b.status === 'return_rejected'" class="reject-line">归还驳回：{{ b.return_reject_reason || '未填写' }}</div>
                </div>
              </td>
              <td>
                <span :class="{ overdue: isOverdue(b) }">{{ b.expect_return_date }}</span>
              </td>
              <td><span class="badge" :data-status="b.status">{{ BORROW_STATUS_TEXT[b.status] }}</span></td>
              <td>{{ b.approver_names_text || b.approver_name || '—' }}</td>
              <td>{{ fmtTime(b.apply_at) }}</td>
              <td class="ops">
                <template v-if="b.status === 'pending'">
                  <button class="btn sm primary" @click="actApprove(b)">通过</button>
                  <button class="btn sm danger" @click="actReject(b)">驳回</button>
                </template>
                <template v-else-if="b.status === 'claim_confirming'">
                  <button class="btn sm primary" @click="actClaimApprove(b)">确认领用</button>
                </template>
                <template v-else-if="b.status === 'returning'">
                  <button class="btn sm primary" @click="actReturnApprove(b)">确认归还</button>
                  <button class="btn sm danger" @click="actReturnReject(b)">驳回归还</button>
                </template>
                <template v-else-if="['approved', 'return_rejected'].includes(b.status)">
                  <button class="btn sm warn" @click="actForceReturn(b)">强制归还</button>
                </template>
                <span v-else class="muted">—</span>
              </td>
            </tr>
            <tr v-if="!borrows.items.length && !borrowLoading">
              <td colspan="8" class="empty">暂无借单</td>
            </tr>
          </tbody>
        </table></div>
        <div class="pager" v-if="borrows.total > borrows.pageSize">
          <button class="btn sm" :disabled="borrows.page <= 1" @click="pageBorrows(-1)">上一页</button>
          <span>{{ borrows.page }} / {{ borrowPageCount }}（共 {{ borrows.total }} 条）</span>
          <button class="btn sm" :disabled="borrows.page >= borrowPageCount" @click="pageBorrows(1)">下一页</button>
        </div>
      </section>

      <!-- 成员管理 -->
      <section v-if="tab === 'users'">
        <div class="section-head">
          <h2>成员管理</h2>
          <button class="btn primary" :disabled="syncing" @click="syncWecomUsers">
            {{ syncing ? '同步中…' : '⟳ 从飞书同步成员' }}
          </button>
        </div>
        <p class="sync-hint">成员来自企业微信通讯录（应用可见范围），点击同步按钮拉取最新名单；角色调整仅在本系统生效。</p>
        <div class="tbl-wrap"><table class="tbl">
          <thead>
            <tr><th>头像</th><th>userid</th><th>姓名</th><th>角色</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.userid">
              <td><img v-if="u.avatar" :src="u.avatar" class="avatar" /><span v-else class="avatar placeholder">{{ (u.name || u.userid)[0] }}</span></td>
              <td>{{ u.userid }}</td>
              <td>{{ u.name || '—' }}</td>
              <td>
                <span class="badge" :class="u.role === 'admin' ? 'admin-badge' : 'borrowed'">
                  {{ u.role === 'admin' ? '管理员' : '成员' }}
                </span>
              </td>
              <td class="ops">
                <button v-if="u.role === 'member'" class="btn sm" @click="changeRole(u, 'admin')">设为管理员</button>
                <button v-else class="btn sm" @click="changeRole(u, 'member')">设为成员</button>
              </td>
            </tr>
            <tr v-if="!users.length">
              <td colspan="5" class="empty">暂无成员，点击右上角从飞书同步</td>
            </tr>
          </tbody>
        </table></div>
      </section>
      <!-- 系统设置 -->
      <section v-if="tab === 'system'">
        <h2>系统设置</h2>

        <!-- 系统开关 -->
        <div class="sys-card">
          <div class="sys-head">
            <h3>系统开关</h3>
            <span class="badge" :class="sysSettings.systemClosed ? 'sys-off' : 'sys-on'">
              {{ sysSettings.systemClosed ? '已关闭' : '运行中' }}
            </span>
          </div>
          <p class="sys-desc">
            关闭后，企微端与外部借用页均暂停提交新的借用申请（返回提示关闭原因）；归还、审批等既有流程不受影响。
          </p>
          <label class="sys-reason">
            关闭原因（关闭时必填，展示给借用用户）
            <textarea
              v-model="sysSettings.closeReason"
              rows="2"
              maxlength="200"
              :placeholder="sysSettings.systemClosed ? '' : '如：设备盘点，今日 18:00 恢复'"
            />
          </label>
          <div class="sys-ops">
            <button v-if="!sysSettings.systemClosed" class="btn danger" :disabled="sysSaving || sysLoading" @click="sysSettings.systemClosed = true; saveSystemSettings()">
              {{ sysSaving ? '处理中…' : '关闭系统' }}
            </button>
            <button v-else class="btn primary" :disabled="sysSaving || sysLoading" @click="sysSettings.systemClosed = false; saveSystemSettings()">
              {{ sysSaving ? '处理中…' : '开启系统' }}
            </button>
            <span v-if="sysLoading" class="muted">加载中…</span>
          </div>
        </div>

        <!-- 公告管理 -->
        <div class="section-head" style="margin-top: 24px;">
          <h3 style="margin: 0; font-size: 16px;">系统公告</h3>
          <button class="btn primary" @click="openAnnCreate">＋ 发布公告</button>
        </div>
        <p class="sync-hint">启用中的公告展示在企微端首页与外部借用页顶部，按发布时间倒序轮播。</p>
        <div class="tbl-wrap"><table class="tbl">
          <thead>
            <tr><th>标题</th><th>内容</th><th>状态</th><th>更新时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="a in announcements" :key="a.id">
              <td class="ann-title">{{ a.title }}</td>
              <td><div class="ann-content" :title="a.content">{{ a.content || '—' }}</div></td>
              <td>
                <span class="badge" :class="a.enabled ? 'sys-on' : ''">{{ a.enabled ? '启用中' : '已停用' }}</span>
              </td>
              <td>{{ fmtTime(a.updated_at) }}</td>
              <td class="ops">
                <button class="btn sm" @click="toggleAnn(a)">{{ a.enabled ? '停用' : '启用' }}</button>
                <button class="btn sm" @click="openAnnEdit(a)">编辑</button>
                <button class="btn sm danger" @click="removeAnn(a)">删除</button>
              </td>
            </tr>
            <tr v-if="!announcements.length && !sysLoading">
              <td colspan="5" class="empty">暂无公告，点击右上角发布</td>
            </tr>
          </tbody>
        </table></div>
      </section>
    </main>

    <!-- 设备编辑弹窗 -->
    <div v-if="deviceModal" class="modal-mask" @click.self="deviceModal = null">
      <div class="modal">
        <h3>{{ deviceModal.id ? '编辑设备' : '新增设备' }}</h3>
        <div class="form-grid">
          <label>设备名称 *<input v-model="deviceModal.name" maxlength="128" placeholder="如：Sony A7M4 相机" /></label>
          <label>分类<input v-model="deviceModal.category" maxlength="64" placeholder="如：相机 / 镜头" /></label>
          <label>型号规格<input v-model="deviceModal.model" maxlength="128" /></label>
          <label>序列号<input v-model="deviceModal.serial_no" maxlength="128" /></label>
          <label>存放位置<input v-model="deviceModal.location" maxlength="128" /></label>
          <label>备注<textarea v-model="deviceModal.remark" rows="2" maxlength="1000" /></label>
          <label class="full">设备图片（首张为封面）
            <span class="img-list">
              <span v-for="(img, i) in deviceModal.images" :key="img" class="img-cell">
                <img :src="img" class="thumb lg" />
                <button type="button" class="img-del" @click.prevent="removeModalImage(i)">×</button>
                <span v-if="i === 0" class="img-cover-tag">封面</span>
              </span>
              <span class="img-add">
                <input type="file" accept="image/jpeg,image/png,image/webp" @change="onImagePick" />
                <span v-if="uploadingImage">上传中…</span>
                <template v-else>+ 上传</template>
              </span>
            </span>
          </label>
        </div>
        <p class="form-hint">负责人（借还审批人）自动为系统管理员，无需选择。</p>
        <div class="modal-ops">
          <button class="btn" @click="deviceModal = null">取消</button>
          <button class="btn primary" :disabled="deviceSaving" @click="saveDevice">{{ deviceSaving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 原因输入弹窗 -->
    <div v-if="reasonModal" class="modal-mask" @click.self="reasonModal = null">
      <div class="modal small">
        <h3>{{ reasonModal.title }}</h3>
        <textarea v-model="reasonModal.reason" rows="3" placeholder="请填写原因（必填）" />
        <div class="modal-ops">
          <button class="btn" @click="reasonModal = null">取消</button>
          <button class="btn danger" @click="confirmReason">确认驳回</button>
        </div>
      </div>
    </div>

    <!-- 公告编辑弹窗 -->
    <div v-if="annModal" class="modal-mask" @click.self="annModal = null">
      <div class="modal">
        <h3>{{ annModal.id ? '编辑公告' : '发布公告' }}</h3>
        <div class="form-grid">
          <label class="full">公告标题 *
            <input v-model="annModal.title" maxlength="128" placeholder="如：国庆期间借用安排" />
          </label>
          <label class="full">公告内容
            <textarea v-model="annModal.content" rows="4" maxlength="2000" placeholder="公告正文（可选，展示在详情弹窗中）" />
          </label>
        </div>
        <label class="ann-enable">
          <input v-model="annModal.enabled" type="checkbox" />
          立即启用（启用后展示在前端首页）
        </label>
        <div class="modal-ops">
          <button class="btn" @click="annModal = null">取消</button>
          <button class="btn primary" :disabled="annSaving" @click="saveAnn">{{ annSaving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>

    <div v-if="toast" :class="toastClass">{{ toast }}</div>
  </div>
</template>

<style scoped>
/* ---------- 登录 ---------- */
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #001529 0%, #1e293b 100%);
}
.login-card {
  width: 340px;
  background: #fff;
  border-radius: 14px;
  padding: 36px 32px;
  text-align: center;
  box-shadow: 0 20px 60px rgb(0 0 0 / 35%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: #1f2937;
}
.login-logo img { height: 44px; width: auto; display: block; margin: 0 auto; }
.login-card h1 { font-size: 20px; margin: 0; }
.login-sub { margin: 0 0 8px; color: #94a3b8; font-size: 12px; letter-spacing: 2px; }
.login-card input {
  height: 42px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 14px;
  outline: none;
}
.login-card input:focus { border-color: #1677ff; }
.login-error { color: #dc2626; font-size: 13px; }
.login-card button {
  height: 42px;
  border: 0;
  border-radius: 8px;
  background: #1677ff;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
.login-card button:disabled { opacity: 0.6; }

/* ---------- 控制台布局 ---------- */
.shell { display: flex; min-height: 100vh; background: #f1f5f9; color: #1f2937; }
.side {
  width: 220px;
  background: #001529;
  color: #cbd5e1;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}
.side-logo { display: flex; align-items: center; gap: 8px; padding: 16px 14px 14px; }
.side-logo img { height: 26px; width: auto; display: block; }
.side-logo-txt { font-size: 14px; font-weight: 600; color: #fff; }
.side nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.side nav a {
  padding: 12px 20px;
  cursor: pointer;
  font-size: 14px;
  border-left: 3px solid transparent;
}
.side nav a:hover { background: rgb(255 255 255 / 6%); }
.side nav a.active { background: rgb(37 99 235 / 18%); color: #fff; border-left-color: #1677ff; }
.logout {
  margin: 16px 20px;
  height: 36px;
  border: 1px solid #475569;
  border-radius: 8px;
  background: transparent;
  color: #cbd5e1;
  cursor: pointer;
}
.logout:hover { background: rgb(255 255 255 / 8%); }
.main { flex: 1; padding: 24px 32px; min-width: 0; }
.main h2 { margin: 0 0 18px; font-size: 20px; }
.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.section-head h2 { margin: 0; }

/* ---------- 概览卡片 ---------- */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; }
.card {
  background: #fff;
  border-radius: 10px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}
.card b { font-size: 28px; }
.card span { color: #64748b; font-size: 13px; }
.card.ok b { color: #16a34a; }
.card.warn b { color: #d97706; }
.card.err b { color: #dc2626; }

/* ---------- 筛选 / 表格 ---------- */
.filters { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.filters input, .filters select {
  height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  font-size: 13px;
}
.filters input { width: 220px; }
.tbl {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
  font-size: 13px;
}
.tbl th, .tbl td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
.tbl th { background: #f8fafc; color: #64748b; font-weight: 500; white-space: nowrap; }
.tbl tr:hover td { background: #f8fafc; }
.dev-cell { display: flex; align-items: center; gap: 10px; min-width: 160px; }
.dev-name { font-weight: 500; }
.thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; }
.thumb.lg { width: 56px; height: 56px; }
.reason { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reject-line { color: #dc2626; font-size: 12px; white-space: normal; }
.empty { text-align: center; color: #94a3b8; padding: 32px !important; }
.muted { color: #cbd5e1; }
.overdue { color: #dc2626; font-weight: 600; }
.ops { white-space: nowrap; display: flex; gap: 6px; }

.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: #e2e8f0;
  color: #475569;
  white-space: nowrap;
}
.badge[data-status='pending'] { background: #fef3c7; color: #b45309; }
.badge[data-status='approved'] { background: #dbeafe; color: #0958d9; }
.badge[data-status='rejected'] { background: #fee2e2; color: #b91c1c; }
.badge[data-status='returning'] { background: #fef3c7; color: #b45309; }
.badge[data-status='returned'] { background: #dcfce7; color: #15803d; }
.badge[data-status='return_rejected'] { background: #fee2e2; color: #b91c1c; }
.badge.borrowed { background: #e2e8f0; color: #475569; }
.admin-badge { background: #ede9fe; color: #6d28d9; }

.status-select { border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 6px; font-size: 12px; background: #fff; }

/* ---------- 按钮 ---------- */
.btn {
  height: 32px;
  padding: 0 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.btn:hover { border-color: #94a3b8; }
.btn.primary { background: #1677ff; border-color: #1677ff; color: #fff; }
.btn.danger { background: #dc2626; border-color: #dc2626; color: #fff; }
.btn.warn { background: #d97706; border-color: #d97706; color: #fff; }
.btn.sm { height: 27px; padding: 0 10px; font-size: 12px; border-radius: 6px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.pager { display: flex; align-items: center; gap: 14px; justify-content: center; margin-top: 16px; color: #64748b; font-size: 13px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #64748b; white-space: nowrap; }
.dev-names { display: flex; align-items: center; gap: 6px; max-width: 220px; }
.dev-count { background: #e2e8f0; color: #475569; border-radius: 999px; font-size: 11px; padding: 1px 8px; flex-shrink: 0; }
.dev-names-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sync-hint { margin: -6px 0 14px; color: #94a3b8; font-size: 12px; }
.status-filter { height: 32px; border: 1px solid #d1d5db; border-radius: 8px; padding: 0 8px; background: #fff; }

/* ---------- 弹窗 ---------- */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgb(15 23 42 / 45%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  width: 560px;
  max-width: 92vw;
  max-height: 86vh;
  overflow: auto;
  background: #fff;
  border-radius: 12px;
  padding: 22px 24px;
}
.modal.small { width: 400px; }
.modal h3 { margin: 0 0 16px; font-size: 16px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
.form-grid label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: #475569; }
.form-grid .full { grid-column: 1 / -1; }
.form-grid input, .form-grid textarea {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
}
.form-grid input:focus, .form-grid textarea:focus { border-color: #1677ff; }
.img-list { display: flex; flex-wrap: wrap; gap: 10px; }
.img-cell { position: relative; }
.img-del { position: absolute; top: -7px; right: -7px; width: 18px; height: 18px; border-radius: 50%; border: 0; background: #ff4d4f; color: #fff; font-size: 12px; line-height: 18px; cursor: pointer; }
.img-cover-tag { position: absolute; left: 0; bottom: 0; background: rgba(22, 119, 255, 0.9); color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 0 4px 0 4px; }
.img-add { width: 56px; height: 56px; border: 1px dashed #d9d9d9; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: #98a1b0; cursor: pointer; position: relative; }
.img-add input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.img-row { display: flex; align-items: center; gap: 10px; }
.form-hint { margin: 12px 0 0; color: #94a3b8; font-size: 12px; }
.modal textarea { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px; font-size: 13px; resize: vertical; }
.modal-ops { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }

/* ---------- 系统设置 ---------- */
.sys-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
  max-width: 720px;
}
.sys-head { display: flex; align-items: center; gap: 10px; }
.sys-head h3 { margin: 0; font-size: 16px; }
.sys-on { background: #dcfce7; color: #15803d; }
.sys-off { background: #fee2e2; color: #b91c1c; }
.sys-desc { margin: 10px 0 14px; color: #64748b; font-size: 13px; line-height: 1.6; }
.sys-reason { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #475569; }
.sys-reason textarea {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  resize: vertical;
}
.sys-reason textarea:focus { border-color: #1677ff; }
.sys-ops { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.ann-title { font-weight: 500; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ann-content { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64748b; }
.ann-enable { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 13px; color: #475569; cursor: pointer; }

/* ---------- 其他 ---------- */
.avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
.avatar.placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #e2e8f0;
  color: #64748b;
  font-size: 14px;
}
.toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #001529;
  color: #fff;
  padding: 9px 18px;
  border-radius: 8px;
  font-size: 13px;
  z-index: 99;
}
.toast.error { background: #dc2626; }
</style>

<!-- 响应式追加（见 scoped 样式） -->
<style scoped>
.tbl-wrap {
  overflow-x: auto;
  border-radius: var(--radius, 14px);
  background: #fff;
  box-shadow: 0 1px 3px rgba(23, 30, 48, 0.06);
}
.tbl-wrap .tbl {
  min-width: 680px;
  box-shadow: none;
  border-radius: 0;
}
@media (max-width: 820px) {
  .shell {
    flex-direction: column;
  }
  .side {
    position: sticky;
    top: 0;
    z-index: 20;
    width: 100%;
    height: auto;
    flex-direction: row;
    align-items: center;
    padding: 8px 10px;
    gap: 6px;
  }
  .side-logo {
    padding: 4px 6px;
  }
  .side-logo img {
    height: 20px;
  }
  .side-logo-txt {
    font-size: 13px;
  }
  .side nav {
    flex-direction: row;
    overflow-x: auto;
    gap: 2px;
  }
  .side nav a {
    padding: 8px 10px;
    border-left: 0;
    border-bottom: 3px solid transparent;
    white-space: nowrap;
    border-radius: 8px;
  }
  .side nav a.active {
    border-left: 0;
    border-bottom: 0;
    background: rgba(37, 99, 235, 0.24);
  }
  .logout {
    margin: 0 4px;
    height: 32px;
    padding: 0 10px;
    flex-shrink: 0;
  }
  .main {
    padding: 14px 12px 24px;
  }
  .cards {
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: 10px;
  }
  .card {
    padding: 12px;
  }
  .card b {
    font-size: 22px;
  }
  .filters input {
    width: 100%;
  }
  .section-head {
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
