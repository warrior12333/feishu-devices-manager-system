<script setup>
/**
 * 设备详情（AntD 风格重构）：
 * PageHeader（名称/状态/编号 + 管理员操作）→ 头图卡片 → 基本信息 Descriptions
 * → 当前借出 → 设备二维码 → 吸底操作（申请借用）。桌面端双栏布局。
 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showImagePreview, showToast, showConfirmDialog } from 'vant';
import api from '../api';
import { user } from '../store';
import { DEVICE_STATUS_TEXT, DEVICE_STATUS_TYPE, deviceIdText, isOverdue } from '../utils/status';

const route = useRoute();
const router = useRouter();

const device = ref(null);
const activeBorrow = ref(null);

const isAdmin = computed(() => user.value?.role === 'admin');
const images = computed(() => device.value?.images || (device.value?.image ? [device.value.image] : []));
const cover = computed(() => images.value[0] || '');

async function load() {
  const res = await api.get(`/devices/${route.params.id}`);
  device.value = res.device;
  activeBorrow.value = res.activeBorrow;
}

async function toggleStatus() {
  const d = device.value;
  const target = d.status === 'idle' ? 'disabled' : 'idle';
  const label = target === 'disabled' ? '停用' : '启用';
  try {
    await showConfirmDialog({
      title: `${label}设备`,
      message: target === 'disabled' ? `停用后「${d.name}」将不可被借用，确定停用？` : `启用后「${d.name}」可正常借用，确定启用？`,
    });
  } catch {
    return;
  }
  try {
    await api.patch(`/devices/${d.id}/status`, { status: target });
    showToast(`已${label}`);
    load();
  } catch {
    /* 拦截器已提示（如存在进行中借单） */
  }
}

async function removeDevice() {
  const d = device.value;
  try {
    await showConfirmDialog({
      title: '删除设备',
      message: `确定删除「${d.name}」吗？该设备的全部借还记录将一并删除，删除后不可恢复。`,
    });
  } catch {
    return;
  }
  try {
    await api.delete(`/devices/${d.id}`);
    showToast('已删除');
    router.replace('/');
  } catch {
    /* 拦截器已提示（如存在进行中借单） */
  }
}

onMounted(load);
</script>

<template>
  <div class="page page-detail has-action" v-if="device">
    <!-- 页头 -->
    <div class="pg-header">
      <div class="pg-title">
        {{ device.name }}
        <van-tag :type="DEVICE_STATUS_TYPE[device.status]">{{ DEVICE_STATUS_TEXT[device.status] }}</van-tag>
      </div>
      <div class="pg-sub">
        <span class="dev-id">{{ deviceIdText(device.id) }}</span>
        <span>{{ device.category }}</span>
        <span v-if="device.model">{{ device.model }}</span>
      </div>
      <div class="pg-extra" v-if="isAdmin">
        <button class="btn" @click="router.push(`/device/${device.id}/edit`)">编辑信息</button>
        <button
          v-if="device.status !== 'borrowed'"
          class="btn danger-ghost"
          @click="toggleStatus"
        >
          {{ device.status === 'idle' ? '停用设备' : '启用设备' }}
        </button>
        <button class="btn danger-ghost" @click="removeDevice">删除设备</button>
      </div>
    </div>

    <div class="detail-cols">
    <div class="detail-main">
    <!-- 头图（封面 = 首图） -->
    <div class="card hero">
      <img v-if="cover" :src="cover" alt="" @click="showImagePreview(images)" />
      <div v-else class="hero-placeholder"><van-icon name="photo-o" size="44" /></div>
    </div>

    <!-- 设备图库（多图时展示） -->
    <div class="card" v-if="images.length > 1">
      <div class="card-head">
        设备图片
        <span class="card-extra">{{ images.length }} 张 · 点击查看大图</span>
      </div>
      <div class="card-body">
        <div class="photo-grid">
          <img v-for="(p, i) in images" :key="p" :src="p" alt="设备图片" @click="showImagePreview({ images, startPosition: i })" />
        </div>
      </div>
    </div>

    <!-- 基本信息 -->
    <div class="card">
      <div class="card-head">基本信息</div>
      <div class="card-body">
        <dl class="desc">
          <div class="desc-row"><dt class="desc-label">设备编号</dt><dd class="desc-value mono">{{ deviceIdText(device.id) }}</dd></div>
          <div class="desc-row"><dt class="desc-label">分类</dt><dd class="desc-value">{{ device.category }}</dd></div>
          <div class="desc-row"><dt class="desc-label">型号规格</dt><dd class="desc-value">{{ device.model || '—' }}</dd></div>
          <div class="desc-row"><dt class="desc-label">序列号</dt><dd class="desc-value">{{ device.serial_no || '—' }}</dd></div>
          <div class="desc-row"><dt class="desc-label">存放位置</dt><dd class="desc-value">{{ device.location || '—' }}</dd></div>
          <div class="desc-row"><dt class="desc-label">负责人</dt><dd class="desc-value">{{ device.owner_name || '未设置' }}</dd></div>
          <div class="desc-row" v-if="device.remark"><dt class="desc-label">备注</dt><dd class="desc-value">{{ device.remark }}</dd></div>
        </dl>
      </div>
    </div>


    </div>

    <!-- 右侧栏：当前借出 + 设备二维码 -->
    <aside class="detail-side">
    <div class="card" v-if="activeBorrow">
      <div class="card-head">
        当前借出
        <span class="card-extra">{{ activeBorrow.devices.length }}台 · #{{ activeBorrow.id }}</span>
      </div>
      <div class="card-body">
        <dl class="desc">
          <div class="desc-row"><dt class="desc-label">借出人</dt><dd class="desc-value">{{ activeBorrow.borrower_name }}</dd></div>
          <div class="desc-row">
            <dt class="desc-label">应还日期</dt>
            <dd class="desc-value">
              <span :class="{ overdue: isOverdue(activeBorrow) }">{{ activeBorrow.expect_return_date }}</span>
              <span v-if="isOverdue(activeBorrow)" class="overdue"> · 已逾期</span>
            </dd>
          </div>
        </dl>
        <div style="margin-top: 8px">
          <button class="btn" style="width: 100%" @click="router.push(`/borrow/${activeBorrow.id}`)">查看借单详情</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head">设备二维码<span class="card-extra">扫码直达本页</span></div>
      <div class="card-body" style="text-align: center; padding: 16px">
        <img :src="`/api/devices/${device.id}/qrcode`" alt="设备二维码" style="width: 168px; height: 168px" />
        <div style="margin-top: 8px; font-size: 12px; color: var(--ant-text-3)">
          扫码可查看设备并直接申请借用
        </div>
      </div>
    </div>
    </aside>
    </div>

    <!-- 吸底操作 -->
    <div class="action-bar">
      <van-button
        block
        type="primary"
        :disabled="device.status !== 'idle'"
        @click="router.push({ path: '/borrow/new', query: { preselect: device.id } })"
      >
        {{ device.status === 'idle' ? '申请借用此设备' : DEVICE_STATUS_TEXT[device.status] + '，暂不可借' }}
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.dev-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--ant-text-3);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
