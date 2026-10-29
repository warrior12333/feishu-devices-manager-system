<script setup>
/** 我的借还记录（按申请组）：查看状态、逾期提醒、发起归还入口 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '../api';
import {
  BORROW_STATUS_TEXT,
  BORROW_STATUS_TYPE,
  isOverdue,
  devicesText,
} from '../utils/status';
import RangeFilter from '../components/RangeFilter.vue';

const router = useRouter();
const activeTab = ref(0);
const tabs = [
  { label: '全部', status: '' },
  { label: '进行中', status: 'active' },
  { label: '已归还', status: 'returned' },
  { label: '已驳回', status: 'rejected' },
];
const items = ref([]);
const total = ref(0);
const loading = ref(false);
const range = ref(30); // 默认最近30天

async function load() {
  loading.value = true;
  try {
    const params = { tab: 'mine', pageSize: 100 };
    const status = tabs[activeTab.value].status;
    if (status) params.status = status;
    if (range.value) params.days = range.value;
    const data = await api.get('/borrows', { params });
    items.value = data.items;
    total.value = data.total;
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
      <van-tab v-for="t in tabs" :key="t.label" :title="t.label" />
    </van-tabs>
    <RangeFilter v-model="range" @change="load" />

    <van-loading v-if="loading && !items.length" class="loading" vertical>加载中...</van-loading>

    <div class="list-grid">
      <div
        v-for="b in items"
        :key="b.id"
        class="row-item"
        @click="router.push(`/borrow/${b.id}`)"
      >
        <img v-if="b.devices?.[0]?.image" :src="b.devices[0].image" class="thumb" alt="" />
        <div v-else class="thumb-empty"><van-icon name="photo-o" size="26" /></div>
        <div class="info">
          <div class="title">
            <span class="txt">{{ devicesText(b) }}</span>
            <van-tag v-if="(b.devices?.length || 0) > 1" plain type="primary">{{ b.devices.length }}台</van-tag>
            <van-tag :type="BORROW_STATUS_TYPE[b.status]">{{ BORROW_STATUS_TEXT[b.status] }}</van-tag>
          </div>
          <div class="sub">事由：{{ b.reason }}</div>
          <div v-if="b.status === 'rejected'" class="sub reject">驳回原因：{{ b.reject_reason || '未填写' }}</div>
          <div v-else-if="b.status === 'return_rejected'" class="sub reject">
            归还被驳回：{{ b.return_reject_reason || '未填写' }}
          </div>
          <div class="sub">
            应还 {{ b.expect_return_date }}
            <span v-if="isOverdue(b)" class="overdue">已逾期</span>
          </div>
        </div>
        <van-icon name="arrow" color="#c8c9cc" />
      </div>
    </div>

    <van-empty
      v-if="!loading && !items.length"
      :description="activeTab === 0 ? '还没有借还记录，去「申请设备借出」吧' : '暂无记录'"
    />
  </div>
</template>

<style scoped>
.loading {
  margin-top: 40px;
}
.overdue {
  color: #ff4d4f;
  font-weight: 600;
}
.reject {
  color: #ff4d4f;
}
</style>
