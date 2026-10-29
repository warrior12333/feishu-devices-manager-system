<script setup>
/** 审批中心（按申请组）：待我审批（借出申请 / 归还确认）与已处理记录 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '../api';
import { BORROW_STATUS_TEXT, BORROW_STATUS_TYPE, devicesText } from '../utils/status';
import RangeFilter from '../components/RangeFilter.vue';

const router = useRouter();
const activeTab = ref(0);
const items = ref([]);
const loading = ref(false);
const range = ref(30); // 默认最近30天

async function load() {
  loading.value = true;
  try {
    const tab = activeTab.value === 0 ? 'todo' : 'done';
    const params = { tab, pageSize: 100 };
    if (range.value) params.days = range.value;
    const data = await api.get('/borrows', { params });
    items.value = data.items;
  } catch (e) {
    showToast(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}
load();
</script>

<template>
  <div class="page with-tabbar">
    <van-tabs v-model:active="activeTab" sticky @change="load">
      <van-tab title="待我审批" />
      <van-tab title="已处理" />
    </van-tabs>
    <RangeFilter v-model="range" @change="load" />

    <van-loading v-if="loading && !items.length" class="loading" vertical>加载中...</van-loading>

    <div class="list-grid">
      <div v-for="b in items" :key="b.id" class="row-item" @click="router.push(`/borrow/${b.id}`)">
      <img v-if="b.devices?.[0]?.image" :src="b.devices[0].image" class="thumb" alt="" />
      <div v-else class="thumb-empty"><van-icon name="photo-o" size="26" /></div>
      <div class="info">
        <div class="title">
          <span class="txt">{{ devicesText(b) || b.device_name }}</span>
          <van-tag v-if="(b.devices?.length || 0) > 1" plain type="primary">{{ b.devices.length }}台</van-tag>
          <van-tag
            :type="activeTab === 0 ? (b.status === 'pending' ? 'warning' : 'blue') : BORROW_STATUS_TYPE[b.status]"
          >
            {{ activeTab === 0 ? (b.status === 'pending' ? '借出审批' : '归还确认') : BORROW_STATUS_TEXT[b.status] }}
          </van-tag>
        </div>
        <div class="sub">借出人：{{ b.borrower_name }}</div>
        <div class="sub">
          {{ b.status === 'returning' ? '归还申请时间' : '申请时间' }}：
          {{ b.status === 'returning' ? b.return_apply_at : b.apply_at }}
        </div>
      </div>
      <van-button
        v-if="activeTab === 0"
        size="small"
        round
        type="primary"
        @click.stop="router.push(`/borrow/${b.id}`)"
      >
        去处理
      </van-button>
      </div>
    </div>

    <van-empty v-if="!loading && !items.length" :description="activeTab === 0 ? '暂无待审批事项' : '暂无已处理记录'" />
  </div>
</template>

<style scoped>
.loading {
  margin-top: 40px;
}
</style>
