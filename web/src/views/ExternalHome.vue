<script setup>
/**
 * /m 外部借用·借用设备页（与企微首页一致的 UI）。
 * 底部标签栏为路由驱动（route 模式，与企微端同款实现）：借用设备 /m、我的借还 /m/borrows。
 */
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast, showConfirmDialog } from 'vant';
import { deviceIdText } from '../utils/status';
import { extApi } from '../ext-api';
import ExternalBindForm from './ExternalBindForm.vue';

const router = useRouter();

const loading = ref(true);
const me = ref(null);
const binding = ref(false);

/* ---------- 系统状态与公告（与企微端共用 /api/meta/status） ---------- */
const meta = ref({ systemClosed: false, closeReason: '', announcements: [] });
const showAnns = ref(false);
const latestAnn = computed(() => meta.value.announcements[0] || null);
const annText = (a) => (a ? (a.content ? `${a.title}：${a.content}` : a.title) : '');

/** 未登记，或已登记但缺手机号（老用户强制补填，回显原有信息） */
const needBind = computed(() => !me.value || !me.value.phone);

const keyword = ref('');
const activeCat = ref('');
const categories = ref([]);
const items = ref([]);
const page = ref(1);
const listLoading = ref(false);
const finished = ref(false);

async function fetchMe() {
  const data = await extApi.get('/me');
  me.value = data.user;
}

async function submitBind(form) {
  if (!form.className.trim()) return showToast('请填写班级');
  if (!form.studentName.trim()) return showToast('请填写姓名');
  if (!/^[0-9]{6,15}$/.test(form.studentNo.trim())) return showToast('学号格式不正确（例：24137020806）');
  if (!/^1[3-9]\d{9}$/.test(form.phone.trim())) return showToast('请填写正确的11位手机号');
  binding.value = true;
  try {
    const data = await extApi.post('/register', form);
    me.value = data.user;
    showToast('信息已保存');
    onLoad();
  } catch (e) {
    showToast(e.message);
  } finally {
    binding.value = false;
  }
}

async function onLoad() {
  if (!me.value) return;
  listLoading.value = true;
  try {
    const params = new URLSearchParams({ page: page.value, pageSize: '15' });
    if (keyword.value) params.set('keyword', keyword.value);
    if (activeCat.value) params.set('category', activeCat.value);
    const data = await extApi.get(`/devices?${params}`);
    if (!categories.value.length) categories.value = data.categories || [];
    items.value.push(...data.items);
    page.value += 1;
    finished.value = items.value.length >= data.total;
  } catch {
    finished.value = true;
  } finally {
    listLoading.value = false;
  }
}

function reload() {
  page.value = 1;
  items.value = [];
  finished.value = false;
  onLoad();
}

function setCat(name) {
  activeCat.value = name;
  reload();
}

async function logout() {
  try {
    await showConfirmDialog({ title: '切换登记', message: '退出后将重新填写借出人信息，确定吗？' });
  } catch {
    return;
  }
  await extApi.post('/auth/logout');
  me.value = null;
  items.value = [];
  categories.value = [];
}

onMounted(async () => {
  try {
    extApi.get('/meta/status').then((data) => (meta.value = data)).catch(() => {});
    await fetchMe();
    if (me.value) onLoad();
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page with-tabbar">
    <div v-if="loading" class="center-tip"><van-loading>加载中…</van-loading></div>

    <!-- 未登记 / 老用户缺手机号：填写基础信息（回显原有登记） -->
    <ExternalBindForm v-else-if="needBind" :binding="binding" :initial="me" @submit="submitBind" />

    <template v-else>
      <div class="me-bar">
        <span>{{ me.studentName }}（{{ me.className }} · {{ me.studentNo }}）</span>
        <van-tag plain @click="logout">切换登记</van-tag>
      </div>

      <!-- 系统关闭提示（超管在控制台关闭系统后展示） -->
      <van-notice-bar
        v-if="meta.systemClosed"
        wrapable
        :scrollable="false"
        color="#b91c1c"
        background="#fee2e2"
        left-icon="info-o"
      >
        系统已关闭，暂停借用申请{{ meta.closeReason ? `：${meta.closeReason}` : '' }}
      </van-notice-bar>

      <!-- 系统公告：每条停留 5 秒垂直轮播，点击查看全部 -->
      <div v-if="meta.announcements.length" class="ann-bar" @click="showAnns = true">
        <van-icon name="volume-o" class="ann-icon" />
        <van-swipe
          v-if="meta.announcements.length > 1"
          vertical
          :autoplay="5000"
          :duration="600"
          :show-indicators="false"
          :touchable="false"
          class="ann-swipe"
        >
          <van-swipe-item v-for="a in meta.announcements" :key="a.id">{{ annText(a) }}</van-swipe-item>
        </van-swipe>
        <div v-else class="ann-single">{{ annText(latestAnn) }}</div>
      </div>

      <van-search
        v-model="keyword"
        placeholder="搜索设备名称 / 型号 / 序列号"
        @search="reload"
        @clear="reload"
      />

      <div class="actions">
        <van-button type="primary" round block icon="edit" :disabled="meta.systemClosed" @click="router.push('/m/select')">
          申请设备借出
        </van-button>
      </div>

      <div class="cats">
        <van-tag :type="activeCat === '' ? 'primary' : 'default'" size="large" class="cat" @click="setCat('')">
          全部
        </van-tag>
        <van-tag
          v-for="c in categories"
          :key="c.name"
          :type="activeCat === c.name ? 'primary' : 'default'"
          size="large"
          class="cat"
          @click="setCat(c.name)"
        >
          {{ c.name }} {{ c.count }}
        </van-tag>
      </div>

      <van-list
        v-model:loading="listLoading"
        :finished="finished"
        finished-text="没有更多了"
        @load="onLoad"
      >
        <div
          v-for="d in items"
          :key="d.id"
          class="row-item"
          @click="router.push({ path: '/m/select', query: { preselect: d.id } })"
        >
          <img v-if="d.image" :src="d.image" class="thumb" alt="" />
          <div v-else class="thumb-empty"><van-icon name="photo-o" size="26" /></div>
          <div class="info">
            <div class="title">
              <span class="txt">{{ d.name }}</span>
              <van-tag type="success">在库</van-tag>
            </div>
            <div class="sub">
              <van-tag plain type="primary">{{ d.category }}</van-tag>
              <span class="dev-id">{{ deviceIdText(d.id) }}</span>
              <span class="ellipsis">{{ d.model || '未填写型号' }}</span>
            </div>
            <div class="sub">{{ d.location || '未设置存放位置' }}</div>
          </div>
          <van-icon name="arrow" color="#c8c9cc" />
        </div>
      </van-list>

      <van-empty v-if="finished && !items.length" description="暂无可借设备" />
    </template>

    <!-- 公告列表弹窗 -->
    <van-popup v-model:show="showAnns" round position="bottom" class="ann-popup">
      <div class="ann-popup-body">
        <h3>系统公告</h3>
        <div v-for="a in meta.announcements" :key="a.id" class="ann-item">
          <div class="ann-t">{{ a.title }}</div>
          <div v-if="a.content" class="ann-c">{{ a.content }}</div>
          <div class="ann-date">{{ (a.created_at || '').slice(0, 10) }}</div>
        </div>
      </div>
    </van-popup>

    <!-- 底部标签栏：路由驱动（与企微端同款实现） -->
    <van-tabbar route safe-area-inset-bottom>
      <van-tabbar-item to="/m" icon="wap-nav">借用设备</van-tabbar-item>
      <van-tabbar-item to="/m/borrows" icon="orders-o">我的借还</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.center-tip {
  padding: 80px 0;
  text-align: center;
}
.ann-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  background: #fffbe8;
  color: #ed6a0c;
  font-size: 13px;
  cursor: pointer;
}
.ann-icon {
  flex-shrink: 0;
}
.ann-swipe {
  flex: 1;
  min-width: 0;
  height: 40px;
}
.ann-swipe :deep(.van-swipe-item) {
  height: 40px;
  line-height: 40px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ann-single {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 40px;
}

/* 公告弹窗 */
.ann-popup-body {
  padding: 20px 16px 28px;
  max-height: 65vh;
  overflow-y: auto;
}
.ann-popup-body h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.ann-item {
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}
.ann-item:last-child {
  border-bottom: 0;
}
.ann-t {
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}
.ann-c {
  margin-top: 6px;
  font-size: 13px;
  color: #646566;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.ann-date {
  margin-top: 6px;
  font-size: 11px;
  color: #c8c9cc;
}
.me-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #eef3ff;
  color: #475569;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 10px;
  padding: 4px 12px 0;
}
.cats {
  display: flex;
  gap: 8px;
  padding: 12px;
  overflow-x: auto;
  white-space: nowrap;
}
.cat {
  flex-shrink: 0;
  padding: 5px 12px;
  cursor: pointer;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dev-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #969799;
  flex-shrink: 0;
}
</style>
