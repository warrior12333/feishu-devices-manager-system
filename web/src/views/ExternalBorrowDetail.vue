<script setup>
/**
 * /m/borrow/:id 外部借单详情（与企微内借单详情一致的视觉）：
 * 状态横幅 / 设备清单 / 申请信息 / 借还照片 / 时间线；借出人可整组拍照归还。
 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast, showImagePreview } from 'vant';
import { extApi } from '../ext-api';
import PhotoMultiInput from '../components/PhotoMultiInput.vue';
import { BORROW_STATUS_TEXT, BORROW_STATUS_TYPE, isOverdue, devicesText } from '../utils/status';

const route = useRoute();
const router = useRouter();

const borrow = ref(null);
const showReturn = ref(false);
const returnPhotos = ref([]);
const showClaim = ref(false);
const claimPhotos = ref([]);
const claimPending = ref(false);
const submitting = ref(false);

const deviceCount = computed(() => (borrow.value && borrow.value.devices ? borrow.value.devices.length : 0));
const deviceList = computed(() => (borrow.value && borrow.value.devices) || []);

const statusHint = computed(() => {
  if (!borrow.value) return '';
  const b = borrow.value;
  switch (b.status) {
    case 'pending':
      return '等待管理员审批';
    case 'claiming':
      return '审批已通过，请在「领用设备」中拍照确认领用';
    case 'claim_confirming':
      return '领用照片已提交，等待管理员核对确认';
    case 'approved':
      return isOverdue(b) ? '已超过应归还日期，请尽快归还' : `请于 ${b.expect_return_date} 前归还`;
    case 'rejected':
      return `驳回原因：${b.reject_reason || '未填写'}`;
    case 'returning':
      return '归还申请已提交，等待管理员核对照片确认';
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
  try {
    const data = await extApi.get(`/borrows/${route.params.id}`);
    borrow.value = data.borrow;
  } catch (e) {
    showToast(e.message);
    router.replace('/m/borrows');
  }
}

function openClaim() {
  claimPhotos.value = [];
  showClaim.value = true;
}

async function submitClaim() {
  if (claimPhotos.value.length < 3) {
    return showToast(`请至少拍摄 3 张领用照片（当前 ${claimPhotos.value.length} 张）`);
  }
  claimPending.value = true;
  try {
    const data = await extApi.post(`/borrows/${borrow.value.id}/claim`, { claim_photos: claimPhotos.value });
    borrow.value = data.borrow;
    showClaim.value = false;
    showToast({ type: 'success', message: '领用已提交，等待管理员确认' });
  } catch (e) {
    showToast(e.message);
  } finally {
    claimPending.value = false;
  }
}

async function submitReturn() {
  if (returnPhotos.value.length < 3) {
    return showToast(`请至少拍摄 3 张归还照片（当前 ${returnPhotos.value.length} 张）`);
  }
  submitting.value = true;
  try {
    const data = await extApi.post(`/borrows/${borrow.value.id}/return`, { return_photos: returnPhotos.value });
    borrow.value = data.borrow;
    showReturn.value = false;
    showToast({ type: 'success', message: '归还申请已提交' });
  } catch (e) {
    showToast(e.message);
  } finally {
    submitting.value = false;
  }
}

const showPreviewList = (list, idx) => showImagePreview({ images: list, startPosition: idx });

onMounted(load);
</script>

<template>
  <div class="page" v-if="borrow">
    <van-nav-bar title="借单详情" left-arrow @click-left="router.back()" />

    <div class="banner" :class="bannerType">
      <div class="status-text">{{ BORROW_STATUS_TEXT[borrow.status] }}</div>
      <div class="hint">{{ statusHint }}</div>
    </div>

    <!-- 设备清单 -->
    <van-cell-group inset class="cells">
      <van-cell :title="`借用设备（${deviceCount} 台）`">
        <template #label>
          <div class="dev-list">
            <div v-for="d in deviceList" :key="d.row_id" class="dev-row">
              <img v-if="d.image" :src="d.image" class="thumb" alt="" />
              <div v-else class="thumb-empty"><van-icon name="photo-o" size="22" /></div>
              <div class="dev-info">
                <div class="dev-name">{{ d.name }}</div>
                <div class="dev-sub">
                  <van-tag plain type="primary">{{ d.category }}</van-tag>
                  <span>{{ d.location || '' }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset class="cells">
      <van-cell title="借出事由" :label="borrow.reason" />
      <van-cell title="应归还日期" :value="borrow.expect_return_date">
        <template #value>
          <span :class="{ overdue: isOverdue(borrow) }">{{ borrow.expect_return_date }}</span>
        </template>
      </van-cell>
      <van-cell title="审批人" :value="borrow.approver_names_text || borrow.approver_name || '—'" />
    </van-cell-group>

    <van-cell-group inset class="cells">
      <van-cell :title="`领用照片（${(borrow.borrow_photos || []).length} 张）`">
        <template #label>
          <div class="photo-grid">
            <img
              v-for="(p, i) in borrow.borrow_photos || []"
              :key="p"
              :src="p"
              class="photo"
              alt="借出照片"
              @click="showPreviewList(borrow.borrow_photos, i)"
            />
          </div>
        </template>
      </van-cell>
      <van-cell v-if="(borrow.return_photos || []).length" :title="`归还时照片（${borrow.return_photos.length} 张）`">
        <template #label>
          <div class="photo-grid">
            <img
              v-for="(p, i) in borrow.return_photos"
              :key="p"
              :src="p"
              class="photo"
              alt="归还照片"
              @click="showPreviewList(borrow.return_photos, i)"
            />
          </div>
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset class="cells">
      <van-cell title="申请时间" :value="borrow.apply_at" />
      <van-cell v-if="borrow.approve_at" title="审批时间">
        <template #value>{{ borrow.approve_at }}{{ borrow.approved_by_name ? `（${borrow.approved_by_name}）` : '' }}</template>
      </van-cell>
      <van-cell v-if="borrow.return_apply_at" title="归还申请时间" :value="borrow.return_apply_at" />
      <van-cell v-if="borrow.finish_at" title="归还确认时间">
        <template #value>{{ borrow.finish_at }}{{ borrow.confirm_by_name ? `（${borrow.confirm_by_name}）` : '' }}</template>
      </van-cell>
    </van-cell-group>

    <!-- 底部操作 -->
    <div class="actions" v-if="borrow.status === 'claiming'">
      <van-button block round type="primary" @click="openClaim">
        领用设备（{{ deviceCount }} 台 · 拍照）
      </van-button>
    </div>
    <div class="actions" v-else-if="borrow.status === 'claim_confirming'">
      <van-button block round plain type="warning" disabled>领用照片核对中，请等待管理员确认</van-button>
    </div>
    <div class="actions" v-else-if="['approved', 'return_rejected'].includes(borrow.status)">
      <van-button block round type="primary" @click="showReturn = true">
        发起归还（{{ deviceCount }} 台设备 · 拍照）
      </van-button>
    </div>

    <!-- 领用设备弹窗（至少3张照片） -->
    <van-popup v-model:show="showClaim" round position="bottom" :style="{ minHeight: '35%' }">
      <div class="return-box">
        <div class="return-title">领用 {{ deviceCount }} 台设备</div>
        <div class="return-devs">{{ devicesText(borrow) }}</div>
        <div class="return-sub">请现场拍摄设备照片（可拍合影），至少 3 张，管理员核对后设备正式借出</div>
        <div class="return-photo">
          <PhotoMultiInput v-model="claimPhotos" endpoint="/api/external/upload" label="拍摄领用照片" />
        </div>
        <van-button type="primary" round block class="return-btn" :loading="claimPending" @click="submitClaim">
          确认领用
        </van-button>
      </div>
    </van-popup>

    <!-- 发起归还（整组，至少3张照片，醒目提示） -->
    <van-popup v-model:show="showReturn" round position="bottom" :style="{ minHeight: '35%' }">
      <div class="return-box">
        <div class="return-title">归还 {{ deviceCount }} 台设备</div>
        <div class="return-devs">{{ devicesText(borrow) }}</div>
        <div class="return-sub">请现场拍摄设备照片（可拍合影），至少 3 张，不拍够无法提交</div>
        <div class="return-photo">
          <PhotoMultiInput v-model="returnPhotos" endpoint="/api/external/upload" label="拍摄归还照片" />
        </div>
        <van-button type="primary" round block class="return-btn" :loading="submitting" @click="submitReturn">
          提交归还申请
        </van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.banner {
  padding: 22px 16px;
  color: #fff;
}
.banner.warning { background: #faad14; }
.banner.primary { background: var(--van-primary-color); }
.banner.danger { background: #ff4d4f; }
.banner.success { background: #52c41a; }
.banner.default { background: #969799; }
.status-text { font-size: 20px; font-weight: 700; }
.hint { margin-top: 6px; font-size: 13px; opacity: 0.9; }
.cells { margin-top: 12px; }
.dev-list { margin-top: 2px; }
.dev-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
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
  flex-shrink: 0;
}
.dev-info { flex: 1; min-width: 0; }
.dev-name { font-size: 14px; }
.dev-sub { display: flex; gap: 6px; align-items: center; margin-top: 2px; color: #969799; font-size: 12px; }
.photo-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.photo {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
}
.overdue { color: #ff4d4f; font-weight: 600; }
.actions {
  display: flex;
  gap: 12px;
  padding: 24px 16px;
}
.return-box { padding: 20px 16px 24px; }
.return-title { font-size: 16px; font-weight: 700; text-align: center; }
.return-devs {
  margin-top: 6px;
  text-align: center;
  font-size: 12px;
  color: #646566;
}
.return-sub {
  margin: 10px 0 12px;
  text-align: center;
  font-size: 12px;
  color: #ff4d4f;
}
.return-photo { display: flex; justify-content: center; }
.return-btn { margin-top: 16px; }
</style>
