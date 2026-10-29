<script setup>
/** 借出第二步：填写借出申请（多设备 + 事由 + 归还日期 + 现场拍照一次），提交后通知负责人审批 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '../api';
import { formatDate, today } from '../utils/status';

const route = useRoute();
const router = useRouter();

const devices = ref([]);
const reason = ref('');
const returnDate = ref('');
const approvers = ref([]); // 可选审批人（管理员）
const checkedApprovers = ref([]); // 已选审批人 userid
const showCalendar = ref(false);
const submitting = ref(false);

const minDate = computed(() => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
});

function removeDevice(id) {
  devices.value = devices.value.filter((d) => d.id !== id);
  if (!devices.value.length) {
    showToast('至少保留一台设备');
    router.replace('/borrow/new');
  }
}

onMounted(async () => {
  // 审批人：管理员列表，默认全选
  try {
    const usersRes = await api.get('/users');
    approvers.value = usersRes.items.filter((u) => u.role === 'admin');
    checkedApprovers.value = approvers.value.map((u) => u.userid);
  } catch {
    /* 拉取失败时后端会默认全部管理员 */
  }
  const ids = String(route.query.ids || '')
    .split(',')
    .map(Number)
    .filter(Boolean);
  if (!ids.length) {
    showToast('请先选择设备');
    return router.replace('/borrow/new');
  }
  // 并发拉取所选设备详情
  devices.value = await Promise.all(
    ids.map(async (id) => {
      const res = await api.get(`/devices/${id}`);
      return res.device;
    })
  );
  const notIdle = devices.value.filter((d) => d.status !== 'idle');
  if (notIdle.length) {
    showToast(`「${notIdle[0].name}」当前不可借用，请重新选择`);
    return router.replace('/borrow/new');
  }
});

async function submit() {
  if (!devices.value.length) return showToast('请先选择设备');
  if (!reason.value.trim()) return showToast('请填写借出事由');
  if (!returnDate.value) return showToast('请选择归还日期');
  if (!checkedApprovers.value.length) return showToast('请至少选择一位审批人');
  submitting.value = true;
  try {
    await api.post('/borrows', {
      device_ids: devices.value.map((d) => d.id),
      reason: reason.value.trim(),
      expect_return_date: returnDate.value,
      approver_userids: checkedApprovers.value,
    });
    showToast({ type: 'success', message: '已提交，等待负责人审批' });
    router.replace('/my-borrows');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="填写借出申请" left-arrow @click-left="router.back()" />
    <van-steps :active="1" active-color="#1677ff">
      <van-step>选择设备</van-step>
      <van-step>填写申请</van-step>
    </van-steps>

    <template v-if="devices.length">
      <van-cell-group inset class="form">
        <van-cell :title="`已选设备（${devices.length} 台）`" required>
          <template #label>
            <div class="dev-list">
              <div v-for="d in devices" :key="d.id" class="dev-row">
                <img v-if="d.image" :src="d.image" class="thumb" alt="" />
                <div v-else class="thumb-empty"><van-icon name="photo-o" size="22" /></div>
                <div class="dev-info">
                  <div class="dev-name">{{ d.name }}</div>
                  <div class="dev-sub">{{ d.category }}{{ d.model ? ` · ${d.model}` : '' }}</div>
                </div>
                <van-icon name="cross" color="#c8c9cc" size="16" @click="removeDevice(d.id)" />
              </div>
            </div>
            <van-button size="small" plain round type="primary" class="add-btn" @click="router.back()">
              重新选择
            </van-button>
          </template>
        </van-cell>
      </van-cell-group>

      <van-cell-group inset class="form">
        <van-field
          v-model="reason"
          label="借出事由"
          type="textarea"
          rows="2"
          autosize
          maxlength="500"
          show-word-limit
          required
          placeholder="请填写借用用途 / 事由（全部设备共用）"
        />
        <van-cell
          title="归还日期"
          required
          is-link
          :value="returnDate || '请选择'"
          :value-class="returnDate ? '' : 'placeholder'"
          @click="showCalendar = true"
        />
        <van-cell title="审批人" required>
          <template #label>
            <van-checkbox-group v-model="checkedApprovers" direction="horizontal" class="approver-group">
              <van-checkbox v-for="a in approvers" :key="a.userid" :name="a.userid" shape="square" class="approver-item">
                {{ a.name || a.userid }}
              </van-checkbox>
            </van-checkbox-group>
            <div class="photo-tip">默认通知全部管理员，可按需减少；任一被选审批人可通过</div>
          </template>
        </van-cell>
      </van-cell-group>

      <div class="submit">
        <van-button type="primary" round block :loading="submitting" @click="submit">
          提交申请（{{ devices.length }} 台设备）
        </van-button>
        <div class="tip">提交后将通知设备负责人审批，审批结果会推送给你</div>
      </div>
    </template>
    <van-loading v-else class="loading" vertical>加载中...</van-loading>

    <van-calendar
      v-model:show="showCalendar"
      :min-date="minDate"
      :default-date="returnDate ? new Date(returnDate) : minDate"
      @confirm="(d) => { returnDate = formatDate(d); showCalendar = false; }"
    />
  </div>
</template>

<style scoped>
.form {
  margin-top: 12px;
}
.placeholder {
  color: #c8c9cc;
}
.dev-list {
  margin-top: 4px;
}
.dev-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}
.thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 6px;
}
.thumb-empty {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  background: #f2f3f5;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c8c9cc;
}
.dev-info {
  flex: 1;
  min-width: 0;
}
.dev-name {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dev-sub {
  font-size: 12px;
  color: #969799;
}
.add-btn {
  margin-top: 6px;
}
.photo-tip {
  margin-top: 6px;
  font-size: 11px;
  color: #c8c9cc;
}
.approver-group {
  margin-top: 6px;
  row-gap: 8px;
}
.approver-item {
  margin-right: 14px;
}
.submit {
  padding: 20px 16px 8px;
}
.tip {
  margin-top: 10px;
  text-align: center;
  font-size: 12px;
  color: #969799;
}
.loading {
  margin-top: 60px;
}
</style>
