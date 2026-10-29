<script setup>
/**
 * 设备首页（AntD 风格重构）：分类左侧栏（带数量角标）+ 右侧设备卡片列表，
 * 桌面端设备列表为多列网格。缩略图取设备封面（首图）。
 */
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api';
import { user } from '../store';
import { DEVICE_STATUS_TEXT, DEVICE_STATUS_TYPE, deviceIdText } from '../utils/status';

const router = useRouter();
const keyword = ref('');
const activeCat = ref('');
const categories = ref([]);
const items = ref([]);
const allTotal = ref(0);
const page = ref(1);
const loading = ref(false);
const finished = ref(false);

const isAdmin = computed(() => user.value?.role === 'admin');

/* ---------- 系统状态与公告（/api/meta/status 公开接口） ---------- */
const meta = ref({ systemClosed: false, closeReason: '', announcements: [] });
const showAnns = ref(false);
const latestAnn = computed(() => meta.value.announcements[0] || null);
const annText = (a) => (a ? (a.content ? `${a.title}：${a.content}` : a.title) : '');

async function loadCategories() {
  categories.value = (await api.get('/devices/categories')).items;
}

async function onLoad() {
  loading.value = true;
  try {
    const params = { page: page.value, pageSize: 15 };
    if (keyword.value) params.keyword = keyword.value;
    if (activeCat.value) params.category = activeCat.value;
    const data = await api.get('/devices', { params });
    if (!activeCat.value && !keyword.value) allTotal.value = data.total;
    items.value.push(...data.items);
    page.value += 1;
    finished.value = items.value.length >= data.total;
  } catch {
    finished.value = true;
  } finally {
    loading.value = false;
  }
}

function reload() {
  page.value = 1;
  items.value = [];
  finished.value = false;
  onLoad();
}

function setCat(name) {
  if (activeCat.value === name) return;
  activeCat.value = name;
  reload();
}

onMounted(async () => {
  try {
    meta.value = await api.get('/meta/status');
  } catch {
    /* 元信息加载失败不影响首页浏览 */
  }
});

loadCategories();
</script>

<template>
  <div class="page with-tabbar home-page">
    <van-search
      v-model="keyword"
      placeholder="搜索设备名称 / 型号 / 序列号"
      @search="reload"
      @clear="reload"
    />

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

    <div class="actions">
      <van-button type="primary" block icon="edit" :disabled="meta.systemClosed" @click="router.push('/borrow/new')">
        申请设备借出
      </van-button>
      <van-button
        v-if="isAdmin"
        icon="records-o"
        class="admin-btn"
        @click="router.push('/records')"
      >
        借还记录
      </van-button>
      <van-button
        v-if="isAdmin"
        icon="plus"
        class="admin-btn"
        @click="router.push('/device/new')"
      >
        新增设备
      </van-button>
    </div>

    <div class="home-body">
      <!-- 分类侧栏 -->
      <aside class="cat-rail">
        <div class="rail-item" :class="{ on: activeCat === '' }" @click="setCat('')">
          <span class="ri-name">全部</span>
          <span class="ri-count">{{ allTotal }}</span>
        </div>
        <div
          v-for="c in categories"
          :key="c.name"
          class="rail-item"
          :class="{ on: activeCat === c.name }"
          @click="setCat(c.name)"
        >
          <span class="ri-name">{{ c.name }}</span>
          <span class="ri-count">{{ c.count }}</span>
        </div>
      </aside>

      <!-- 设备列表 -->
      <main class="home-main">
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="没有更多了"
          class="dev-list"
          @load="onLoad"
        >
          <div v-for="d in items" :key="d.id" class="row-item" @click="router.push(`/device/${d.id}`)">
            <img v-if="d.image" :src="d.image" class="thumb" alt="" />
            <div v-else class="thumb-empty"><van-icon name="photo-o" size="26" /></div>
            <div class="info">
              <div class="title">
                <span class="txt">{{ d.name }}</span>
                <van-tag :type="DEVICE_STATUS_TYPE[d.status]">{{ DEVICE_STATUS_TEXT[d.status] }}</van-tag>
              </div>
              <div class="sub">
                <span class="dev-id">{{ deviceIdText(d.id) }}</span>
                <van-tag plain type="primary">{{ d.category }}</van-tag>
              </div>
              <div class="sub loc">{{ d.model || d.location || '未设置存放位置' }}</div>
            </div>
            <van-icon name="arrow" color="#c8c9cc" />
          </div>
        </van-list>

        <van-empty v-if="finished && !items.length" description="暂无设备" />
      </main>
    </div>

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
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 10px;
  padding: 4px 12px 0;
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

.admin-btn {
  flex-shrink: 0;
  height: 34px;
  padding: 0 14px;
}

.home-body {
  display: flex;
  gap: 10px;
  padding: 10px 12px 0;
  align-items: flex-start;
}

/* 分类侧栏（AntD 菜单风格） */
.cat-rail {
  width: 94px;
  flex-shrink: 0;
  position: sticky;
  top: 8px;
  background: var(--ant-card);
  border: 1px solid var(--ant-border);
  border-radius: var(--ant-radius);
  max-height: calc(100vh - 150px);
  overflow-y: auto;
  box-shadow: var(--ant-shadow);
}
.rail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
  padding: 10px 8px 10px 10px;
  font-size: 12px;
  color: var(--ant-text-2);
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: all 0.15s ease;
}
.rail-item:active {
  background: #fafafa;
}
.rail-item.on {
  color: var(--ant-primary);
  background: #f0f7ff;
  border-left-color: var(--ant-primary);
  font-weight: 600;
}
.ri-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ri-count {
  font-size: 10px;
  color: var(--ant-text-3);
  background: #f5f5f5;
  border-radius: 8px;
  padding: 0 5px;
  flex-shrink: 0;
}
.rail-item.on .ri-count {
  background: #e6f4ff;
  color: var(--ant-primary);
}

.home-main {
  flex: 1;
  min-width: 0;
}
.home-main .row-item {
  margin: 0 0 10px;
}
.home-main .sub.loc {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 桌面端：侧栏加宽，列表多列网格 */
@media (min-width: 768px) {
  .home-body {
    padding: 12px 0 0;
    gap: 16px;
  }
  .cat-rail {
    width: 128px;
    top: 12px;
  }
  .rail-item {
    padding: 11px 10px 11px 12px;
    font-size: 13px;
  }
  .home-main .row-item {
    margin: 0;
  }
}
</style>
