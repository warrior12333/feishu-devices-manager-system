<script setup>
/** /m/select 外部借用第一步：按分类多选设备（与企微内选设备页一致），支持 ?preselect=<id> 预勾选 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { extApi } from '../ext-api';
import { DEVICE_STATUS_TEXT, DEVICE_STATUS_TYPE } from '../utils/status';

const route = useRoute();
const router = useRouter();
const cats = ref([]);
const activeCat = ref('');
const items = ref([]);
const loading = ref(false);
const selected = ref([]);

const navCats = computed(() => [{ name: '全部', count: null }, ...cats.value]);
const selectedIds = computed(() => new Set(selected.value.map((d) => d.id)));

async function loadCats() {
  const data = await extApi.get('/devices?pageSize=1');
  cats.value = data.categories || [];
}

async function loadItems() {
  loading.value = true;
  try {
    const params = new URLSearchParams({ pageSize: '100' });
    if (activeCat.value) params.set('category', activeCat.value);
    const data = await extApi.get(`/devices?${params}`);
    items.value = data.items;
  } finally {
    loading.value = false;
  }
}

function setCat(name) {
  activeCat.value = name === '全部' ? '' : name;
  loadItems();
}

function toggle(d) {
  const idx = selected.value.findIndex((x) => x.id === d.id);
  if (idx >= 0) selected.value.splice(idx, 1);
  else selected.value.push(d);
}

function removeSelected(id) {
  const idx = selected.value.findIndex((x) => x.id === id);
  if (idx >= 0) selected.value.splice(idx, 1);
}

function next() {
  if (!selected.value.length) return showToast('请先选择设备');
  const ids = selected.value.map((d) => d.id).join(',');
  router.push({ path: '/m/apply', query: { ids } });
}

onMounted(async () => {
  await loadCats();
  loadItems();
  const preselect = Number(route.query.preselect);
  if (preselect) {
    try {
      const data = await extApi.get(`/devices/${preselect}`);
      selected.value.push(data.device);
    } catch {
      /* 设备不可借则忽略预选 */
    }
  }
});
</script>

<template>
  <div class="page">
    <van-nav-bar title="申请设备借出" left-arrow @click-left="router.back()" />
    <van-steps :active="0" active-color="#1677ff">
      <van-step>选择设备</van-step>
      <van-step>填写申请</van-step>
    </van-steps>

    <div class="selector">
      <aside class="nav">
        <div
          v-for="c in navCats"
          :key="c.name"
          class="nav-item"
          :class="{ active: (activeCat || '全部') === c.name }"
          @click="setCat(c.name)"
        >
          {{ c.name }}
        </div>
      </aside>

      <main class="list">
        <van-loading v-if="loading && !items.length" class="loading" vertical>加载中...</van-loading>
        <div
          v-for="d in items"
          :key="d.id"
          class="row-item"
          :class="{ picked: selectedIds.has(d.id) }"
          @click="toggle(d)"
        >
          <img v-if="d.image" :src="d.image" class="thumb" alt="" />
          <div v-else class="thumb-empty"><van-icon name="photo-o" size="26" /></div>
          <div class="info">
            <div class="title">
              <span class="txt">{{ d.name }}</span>
            </div>
            <div class="sub">
              <van-tag plain type="primary">{{ d.category }}</van-tag>
              <van-tag :type="DEVICE_STATUS_TYPE[d.status]">{{ DEVICE_STATUS_TEXT[d.status] }}</van-tag>
            </div>
            <div class="sub">{{ d.location || '未设置位置' }}</div>
          </div>
          <van-icon
            :name="selectedIds.has(d.id) ? 'checked' : 'circle'"
            :color="selectedIds.has(d.id) ? '#1677ff' : '#dcdee0'"
            size="22"
          />
        </div>
        <van-empty v-if="!loading && !items.length" description="暂无可借设备" />
      </main>
    </div>

    <!-- 已选设备 + 下一步 -->
    <div v-if="selected.length" class="sel-bar">
      <div class="sel-list">
        <van-tag
          v-for="d in selected"
          :key="d.id"
          closeable
          type="primary"
          plain
          size="large"
          class="sel-tag"
          @close.stop="removeSelected(d.id)"
        >
          {{ d.name }}
        </van-tag>
      </div>
      <van-button type="primary" round class="next-btn" @click="next">
        已选 {{ selected.length }} 台 · 去申请
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.selector {
  display: flex;
  height: calc(100vh - 130px);
  padding-bottom: 96px;
  box-sizing: border-box;
}
.nav {
  width: 92px;
  background: #f2f3f5;
  overflow-y: auto;
  flex-shrink: 0;
}
.nav-item {
  padding: 14px 10px;
  font-size: 13px;
  color: #646566;
  border-left: 3px solid transparent;
  cursor: pointer;
}
.nav-item.active {
  background: #fff;
  color: var(--van-primary-color);
  font-weight: 600;
  border-left-color: var(--van-primary-color);
}
.list {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 24px;
}
.loading {
  margin-top: 40px;
}
.row-item {
  margin: 8px 8px 0;
}
.row-item.picked {
  background: #fdf1f1;
}
.sel-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.06);
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  z-index: 10;
}
.sel-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 66px;
  overflow-y: auto;
  margin-bottom: 8px;
}
.sel-tag {
  padding: 3px 8px;
}
.next-btn {
  width: 100%;
}
</style>
