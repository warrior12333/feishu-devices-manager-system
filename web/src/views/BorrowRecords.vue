<script setup>
/**
 * 借还记录（管理员）：以卡片列表查看全部申请组，三类筛选
 *  - 未归还：流程进行中（待审批/待领用/领用待确认/归还待确认/归还驳回）
 *  - 使用中：已确认领用、在借
 *  - 已逾期：进行中且已过应还日期
 */
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '../api';
import { BORROW_STATUS_TEXT, BORROW_STATUS_TYPE, isOverdue, devicesText } from '../utils/status';
import RangeFilter from '../components/RangeFilter.vue';

const router = useRouter();
const activeTab = ref(0);
const tabs = [
  { label: '待领用', status: 'claim' },
  { label: '使用中', status: 'approved' },
  { label: '已逾期', status: 'overdue' },
  { label: '已归还', status: 'returned' },
];
const items = ref([]);
const total = ref(0);
const loading = ref(false);
const range = ref(30); // 默认最近30天

const currentTab = computed(() => tabs[activeTab.value] || { label: '', status: '' });
const emptyText = computed(() => `暂无${currentTab.value.label}的记录`);

async function load() {
  loading.value = true;
  try {
    const params = { tab: 'all', pageSize: 100, status: currentTab.value.status };
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
  <div class="page">
    <van-nav-bar title="借还记录" />
    <van-tabs v-model:active="activeTab" sticky @change="load">
      <van-tab v-for="t in tabs" :key="t.label" :title="t.label" />
    </van-tabs>
    <RangeFilter v-model="range" @change="load" />

    <div class="list-grid">
      <div v-for="b in items" :key="b.id" class="row-item" @click="router.push(`/borrow/${b.id}`)">
        <img v-if="b.devices?.[0]?.image" :src="b.devices[0].image" class="thumb" alt="" />
        <div v-else class="thumb-empty"><van-icon name="photo-o" size="26" /></div>
        <div class="info">
          <div class="title">
            <span class="txt">{{ devicesText(b) }}</span>
            <van-tag v-if="(b.devices?.length || 0) > 1" plain type="primary">{{ b.devices.length }}台</van-tag>
            <van-tag :type="BORROW_STATUS_TYPE[b.status]">{{ BORROW_STATUS_TEXT[b.status] }}</van-tag>
          </div>
          <div class="sub">借出人：{{ b.borrower_name }} · 审批人：{{ b.approver_names_text || '—' }}</div>
          <div class="sub">事由：{{ b.reason }}</div>
          <div class="sub">
            应还 {{ b.expect_return_date }}
            <span v-if="isOverdue(b)" class="overdue">已逾期</span>
            <span class="apply-time">申请于 {{ b.apply_at }}</span>
          </div>
        </div>
        <van-icon name="arrow" color="#c8c9cc" />
      </div>
    </div>

    <van-loading v-if="loading && !items.length" class="loading" vertical>加载中...</van-loading>
    <van-empty v-if="!loading && !items.length" :description="emptyText" />
  </div>
</template>

<style scoped>
.loading {
  margin-top: 40px;
}
.apply-time {
  margin-left: auto;
}
</style>
