<script setup>
/**
 * 借单详情（AntD 风格重构，申请组）：
 * 状态头卡 → 借用设备清单 → 申请信息 Descriptions → 借出/归还照片网格
 * → 流程时间线 → 吸底操作（审批 / 归还）。桌面端双栏布局。
 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast, showImagePreview, showConfirmDialog } from 'vant';
import api from '../api';
import PhotoMultiInput from '../components/PhotoMultiInput.vue';
import { BORROW_STATUS_TEXT, BORROW_STATUS_TYPE, isOverdue, devicesText } from '../utils/status';
import { refreshMe } from '../store';

const route = useRoute();
const router = useRouter();

const borrow = ref(null);
const me = ref({ userid: '', role: 'member' });

// 审批弹窗（借出驳回 / 归还驳回归用）
const showReject = ref(false);
const rejectMode = ref('borrow'); // borrow | return
const rejectReason = ref('');
// 归还弹窗
const showReturn = ref(false);
const returnPhotos = ref([]);
// 领用弹窗(借出人)
const showClaim = ref(false);
const claimPhotos = ref([]);
// 管理员代确认领用弹窗
const showAdminClaim = ref(false);
const adminClaimPhotos = ref([]);
const submitting = ref(false);

const isApprover = computed(() => borrow.value && me.value.userid === borrow.value.approver_userid);
const isAdmin = computed(() => me.value.role === 'admin');
const isBorrower = computed(() => borrow.value && me.value.userid === borrow.value.borrower_userid);
const inApprovers = computed(() => borrow.value && (borrow.value.approver_userids || []).includes(me.value.userid));
const canManage = computed(() => isApprover.value || isAdmin.value || inApprovers.value);
const deviceCount = computed(() => (borrow.value && borrow.value.devices ? borrow.value.devices.length : 0));
const deviceList = computed(() => (borrow.value && borrow.value.devices) || []);

const statusHint = computed(() => {
  if (!borrow.value) return '';
  const b = borrow.value;
  switch (b.status) {
    case 'pending':
      return '等待审批人处理';
    case 'claiming':
      return isBorrower.value ? '审批已通过，请领用设备并现场拍照确认' : '设备已为该申请保留（视为借出），等待领用拍照确认';
    case 'claim_confirming':
      return '领用照片已提交，等待审批人核对确认';
    case 'approved':
      return isOverdue(b) ? '已超过应归还日期，请尽快归还' : `请于 ${b.expect_return_date} 前归还`;
    case 'rejected':
      return `驳回原因：${b.reject_reason || '未填写'}`;
    case 'returning':
      return '归还申请已提交，等待审批人核对照片确认';
    case 'returned':
      return '设备已确认归还回库';
    case 'return_rejected':
      return `归还确认被驳回：${b.return_reject_reason || '未填写'}，请补充后重新发起归还`;
    default:
      return '';
  }
});

const bannerType = computed(() => BORROW_STATUS_TYPE[borrow.value?.status] || 'default');

async function load() {
  const res = await api.get(`/borrows/${route.params.id}`);
  borrow.value = res.borrow;
  me.value = res.me;
}

async function act(path, body) {
  submitting.value = true;
  try {
    const res = await api.post(`/borrows/${borrow.value.id}/${path}`, body || {});
    borrow.value = res.borrow;
    showReject.value = false;
    showReturn.value = false;
    showToast({ type: 'success', message: '操作成功' });
    refreshMe().catch(() => {});
  } finally {
    submitting.value = false;
  }
}

function openReject(mode) {
  rejectMode.value = mode;
  rejectReason.value = '';
  showReject.value = true;
}
const rejectTitle = computed(() =>
  rejectMode.value === 'borrow' ? '驳回借出申请' : rejectMode.value === 'claim' ? '驳回领用' : '驳回归还申请'
);

async function confirmReject() {
  if (!rejectReason.value.trim()) return showToast('请填写驳回原因');
  const path = rejectMode.value === 'borrow' ? 'reject' : rejectMode.value === 'claim' ? 'claim-reject' : 'return-reject';
  await act(path, { reason: rejectReason.value.trim() });
}

function openClaim() {
  claimPhotos.value = [];
  showClaim.value = true;
}

function confirmClaim() {
  if (claimPhotos.value.length < 3) {
    return showToast(`请至少拍摄 3 张领用照片（当前 ${claimPhotos.value.length} 张）`);
  }
  act('claim', { claim_photos: claimPhotos.value });
}

async function forceReturn() {
  try {
    await showConfirmDialog({
      title: '强制归还',
      message: '确定强制归还吗？设备将直接回库，借单立即了结（适用于线下已收回设备的场景）。',
    });
  } catch {
    return;
  }
  await act('force-return');
}

function openAdminClaim() {
  adminClaimPhotos.value = [];
  showAdminClaim.value = true;
}

async function confirmAdminClaim() {
  submitting.value = true;
  try {
    const res = await api.post(`/borrows/${borrow.value.id}/claim-approve`, { claim_photos: adminClaimPhotos.value });
    borrow.value = res.borrow;
    showAdminClaim.value = false;
    showToast({ type: 'success', message: '已确认领用，设备置为使用中' });
    refreshMe().catch(() => {});
  } finally {
    submitting.value = false;
  }
}

function confirmReturn() {
  if (returnPhotos.value.length < 3) {
    return showToast(`请至少拍摄 3 张归还照片（当前 ${returnPhotos.value.length} 张）`);
  }
  act('return', { return_photos: returnPhotos.value });
}

const showPreviewList = (list, idx) => showImagePreview({ images: list, startPosition: idx });

onMounted(load);
</script>

<template>
  <div class="page has-action" v-if="borrow">
    <!-- 状态头卡 -->
    <div class="status-card" :class="bannerType">
      <div class="sc-row">
        <div class="sc-title">{{ BORROW_STATUS_TEXT[borrow.status] }}</div>
        <span class="sc-no">借单 #{{ borrow.id }}</span>
      </div>
      <div class="sc-hint">{{ statusHint }}</div>
    </div>

    <!-- 借用设备 -->
    <div class="card">
      <div class="card-head">
        借用设备
        <span class="card-extra">{{ deviceCount }} 台</span>
      </div>
      <div class="card-body tight">
        <div
          v-for="d in deviceList"
          :key="d.row_id"
          class="dev-row"
          @click="router.push(`/device/${d.device_id}`)"
        >
          <img v-if="d.image" :src="d.image" class="dev-thumb" alt="" />
          <div v-else class="dev-thumb empty"><van-icon name="photo-o" size="20" /></div>
          <div class="dev-info">
            <div class="dev-name">{{ d.name }}</div>
            <div class="dev-sub">
              <van-tag plain type="primary" size="medium">{{ d.category }}</van-tag>
              <span>{{ d.location || '' }}</span>
            </div>
          </div>
          <van-icon name="arrow" color="#c8c9cc" />
        </div>
      </div>
    </div>

    <!-- 申请信息 -->
    <div class="card">
      <div class="card-head">申请信息</div>
      <div class="card-body">
        <dl class="desc">
          <div class="desc-row"><dt class="desc-label">借出人</dt><dd class="desc-value">{{ borrow.borrower_name }}</dd></div>
          <div class="desc-row"><dt class="desc-label">借出事由</dt><dd class="desc-value">{{ borrow.reason }}</dd></div>
          <div class="desc-row">
            <dt class="desc-label">应还日期</dt>
            <dd class="desc-value">
              <span :class="{ overdue: isOverdue(borrow) }">{{ borrow.expect_return_date }}</span>
              <span v-if="isOverdue(borrow)" class="overdue"> · 已逾期</span>
            </dd>
          </div>
          <div class="desc-row"><dt class="desc-label">审批人</dt><dd class="desc-value">{{ borrow.approver_names_text || borrow.approver_name || '—' }}</dd></div>
        </dl>
      </div>
    </div>

    <!-- 照片 -->
    <div class="card">
      <div class="card-head">
        领用照片
        <span class="card-extra">{{ (borrow.borrow_photos || []).length }} 张 · 领用凭证</span>
      </div>
      <div class="card-body">
        <div class="photo-grid" v-if="(borrow.borrow_photos || []).length">
          <img
            v-for="(p, i) in borrow.borrow_photos"
            :key="p"
            :src="p"
            alt="领用照片"
            @click="showPreviewList(borrow.borrow_photos, i)"
          />
        </div>
        <div v-else class="empty-tip">未上传</div>
      </div>
      <template v-if="(borrow.return_photos || []).length">
        <div class="card-head" style="border-top: 1px solid var(--ant-border)">
          归还照片
          <span class="card-extra">{{ borrow.return_photos.length }} 张</span>
        </div>
        <div class="card-body">
          <div class="photo-grid">
            <img
              v-for="(p, i) in borrow.return_photos"
              :key="p"
              :src="p"
              alt="归还照片"
              @click="showPreviewList(borrow.return_photos, i)"
            />
          </div>
        </div>
      </template>
    </div>

    <!-- 流程时间线 -->
    <div class="card">
      <div class="card-head">流程记录</div>
      <div class="card-body">
        <div class="timeline">
          <div class="tl-item">
            <div class="tl-time">{{ borrow.apply_at }}</div>
            <div class="tl-label">提交申请（{{ borrow.borrower_name }}）</div>
          </div>
          <div class="tl-item" :class="{ gray: !borrow.approve_at }">
            <div class="tl-time">{{ borrow.approve_at || '—' }}</div>
            <div class="tl-label">
              {{ borrow.status === 'rejected' ? `审批驳回：${borrow.reject_reason || '未填写'}` : '审批通过，等待领用' }}{{ borrow.approved_by_name ? `（${borrow.approved_by_name}）` : '' }}
            </div>
          </div>
          <div class="tl-item" :class="{ gray: !borrow.claim_at }">
            <div class="tl-time">{{ borrow.claim_at || '—' }}</div>
            <div class="tl-label">领用拍照提交</div>
          </div>
          <div class="tl-item" :class="{ gray: !borrow.claim_approve_at }">
            <div class="tl-time">{{ borrow.claim_approve_at || '—' }}</div>
            <div class="tl-label">领用确认，设备借出{{ borrow.confirm_by_name ? `（${borrow.confirm_by_name}）` : '' }}</div>
          </div>
          <div class="tl-item" :class="{ gray: !borrow.return_apply_at }">
            <div class="tl-time">{{ borrow.return_apply_at || '—' }}</div>
            <div class="tl-label">发起归还（拍照提交）</div>
          </div>
          <div class="tl-item" :class="{ gray: !borrow.finish_at }">
            <div class="tl-time">{{ borrow.finish_at || '—' }}</div>
            <div class="tl-label">归还确认，设备回库{{ borrow.confirm_by_name ? `（${borrow.confirm_by_name}）` : '' }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 吸底操作 -->
    <div class="action-bar" v-if="isBorrower && borrow.status === 'claiming'">
      <van-button block type="primary" @click="showClaim = true">
        领用设备（{{ deviceCount }} 台 · 拍照）
      </van-button>
    </div>
    <div class="action-bar" v-else-if="canManage && !isBorrower && borrow.status === 'claiming'">
      <div class="admin-acting">设备已为该申请保留（视为借出）；借出人尚未拍照领用，可补充照片代为确认</div>
      <van-button block plain type="warning" @click="openAdminClaim">代确认领用（补充照片）</van-button>
    </div>
    <div class="action-bar" v-if="canManage && borrow.status === 'claim_confirming'">
      <div v-if="isAdmin && !isApprover && !inApprovers" class="admin-acting">管理员代审批</div>
      <van-button block plain type="danger" @click="openReject('claim')">驳回领用</van-button>
      <van-button block type="primary" :loading="submitting" @click="act('claim-approve')">确认领用</van-button>
    </div>
    <div class="action-bar" v-if="canManage && ['pending', 'returning'].includes(borrow.status)">
      <div v-if="isAdmin && !isApprover && !inApprovers" class="admin-acting">管理员代审批</div>
      <van-button block plain type="danger" @click="openReject(borrow.status === 'pending' ? 'borrow' : 'return')">
        {{ borrow.status === 'pending' ? '驳回' : '驳回归还' }}
      </van-button>
      <van-button
        block
        type="primary"
        :loading="submitting"
        @click="act(borrow.status === 'pending' ? 'approve' : 'return-approve')"
      >
        {{ borrow.status === 'pending' ? '通过' : '确认归还' }}
      </van-button>
    </div>
    <div class="action-bar" v-else-if="isBorrower && ['approved', 'return_rejected'].includes(borrow.status)">
      <van-button block type="primary" @click="showReturn = true">
        发起归还（{{ deviceCount }} 台设备 · 拍照）
      </van-button>
    </div>
    <div class="action-bar" v-else-if="isAdmin && ['approved', 'return_rejected', 'returning'].includes(borrow.status)">
      <van-button block plain type="warning" :loading="submitting" @click="forceReturn">
        强制归还（线下收回设备，直接回库）
      </van-button>
    </div>

    <!-- 驳回原因 -->
    <van-dialog
      v-model:show="showReject"
      :title="rejectTitle"
      show-cancel-button
      :before-close="(a) => (a === 'confirm' ? (confirmReject(), false) : true)"
    >
      <div class="dialog-pad">
        <van-field
          v-model="rejectReason"
          type="textarea"
          rows="2"
          autosize
          maxlength="500"
          placeholder="请填写驳回原因"
        />
      </div>
    </van-dialog>

    <!-- 领用设备（整组，至少3张照片） -->
    <van-popup v-model:show="showClaim" round position="bottom" :style="{ minHeight: '35%' }">
      <div class="return-box">
        <div class="return-title">领用 {{ deviceCount }} 台设备</div>
        <div class="return-devs">{{ devicesText(borrow) }}</div>
        <div class="return-sub">请现场拍摄设备照片（可拍合影），至少 3 张，管理员核对后设备正式借出</div>
        <div class="return-photo">
          <PhotoMultiInput v-model="claimPhotos" label="拍摄领用照片" />
        </div>
        <van-button type="primary" round block class="return-btn" :loading="submitting" @click="confirmClaim">
          确认领用
        </van-button>
      </div>
    </van-popup>

    <!-- 管理员代确认领用弹窗（补充照片） -->
    <van-popup v-model:show="showAdminClaim" round position="bottom" :style="{ minHeight: '35%' }">
      <div class="return-box">
        <div class="return-title">代确认领用 {{ deviceCount }} 台设备</div>
        <div class="return-devs">{{ devicesText(borrow) }}</div>
        <div class="return-sub">确认后借单将直接置为「使用中」；领用照片为可选项，可后续在借单中补充</div>
        <div class="return-photo">
          <PhotoMultiInput v-model="adminClaimPhotos" label="上传/拍摄领用照片" />
        </div>
        <van-button type="primary" round block class="return-btn" :loading="submitting" @click="confirmAdminClaim">
          确认领用（置为使用中）
        </van-button>
      </div>
    </van-popup>

    <!-- 发起归还（整组，至少3张照片） -->
    <van-popup v-model:show="showReturn" round position="bottom" :style="{ minHeight: '35%' }">
      <div class="return-box">
        <div class="return-title">归还 {{ deviceCount }} 台设备</div>
        <div class="return-devs">{{ devicesText(borrow) }}</div>
        <div class="return-sub">请现场拍摄设备照片（可拍合影），至少 3 张，管理员将核对后确认回库</div>
        <div class="return-photo">
          <PhotoMultiInput v-model="returnPhotos" label="拍摄归还照片" />
        </div>
        <van-button type="primary" round block class="return-btn" :loading="submitting" @click="confirmReturn">
          提交归还申请
        </van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.status-card {
  margin: 12px;
  border-radius: var(--ant-radius);
  padding: 16px;
  color: #fff;
  position: relative;
  overflow: hidden;
}
.status-card.warning { background: linear-gradient(135deg, #faad14, #ffc53d); }
.status-card.primary { background: linear-gradient(135deg, #1677ff, #4096ff); }
.status-card.danger { background: linear-gradient(135deg, #ff4d4f, #ff7875); }
.status-card.success { background: linear-gradient(135deg, #52c41a, #73d13d); }
.status-card.default { background: linear-gradient(135deg, #8c8c8c, #bfbfbf); }
.sc-row { display: flex; justify-content: space-between; align-items: baseline; }
.sc-title { font-size: 19px; font-weight: 700; }
.sc-no { font-size: 12px; opacity: 0.85; font-family: ui-monospace, Menlo, monospace; }
.sc-hint { margin-top: 6px; font-size: 13px; opacity: 0.92; }

.dev-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid #f5f5f5;
  cursor: pointer;
}
.dev-row:last-child { border-bottom: 0; }
.dev-row:active { background: #fafafa; }
.dev-thumb {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  background: #fafafa;
}
.dev-thumb.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c6ccd6;
  border: 1px dashed var(--ant-border);
  box-sizing: border-box;
}
.dev-info { flex: 1; min-width: 0; }
.dev-name { font-size: 14px; font-weight: 500; }
.dev-sub { display: flex; gap: 6px; align-items: center; margin-top: 2px; color: var(--ant-text-3); font-size: 12px; }

.empty-tip { padding: 14px 0 4px; color: var(--ant-text-3); font-size: 13px; }

.admin-acting {
  width: 100%;
  text-align: center;
  color: #faad14;
  font-size: 12px;
  margin-bottom: 8px;
}
.dialog-pad { padding: 12px 0; }
.return-box { padding: 20px 16px 24px; }
.return-title { font-size: 16px; font-weight: 700; text-align: center; }
.return-devs { margin-top: 6px; text-align: center; font-size: 12px; color: var(--ant-text-2); }
.return-sub { margin: 10px 0 12px; text-align: center; font-size: 12px; color: var(--van-danger-color); }
.return-photo { display: flex; justify-content: center; }
.return-btn { margin-top: 16px; }

@media (min-width: 768px) {
  .status-card { margin: 0 0 2px; }
}
</style>
