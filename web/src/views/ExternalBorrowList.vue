<script setup>
/** /m/borrows 外部借用·我的借还（与企微我的借还一致的卡片）；未登记回首页 */
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import {
  BORROW_STATUS_TEXT,
  BORROW_STATUS_TYPE,
  isOverdue,
  devicesText,
} from '../utils/status';
import { extApi } from '../ext-api';

const router = useRouter();
const loading = ref(true);
const borrows = ref([]);

onMounted(async () => {
  try {
    const me = await extApi.get('/me');
    if (!me.user) {
      showToast('请先填写借出人信息');
      return router.replace('/m');
    }
    const data = await extApi.get('/borrows?pageSize=100');
    borrows.value = data.items;
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page with-tabbar">
    <van-loading v-if="loading" class="center-tip" vertical>加载中...</van-loading>

    <template v-else>
      <div
        v-for="b in borrows"
        :key="b.id"
        class="row-item"
        @click="router.push(`/m/borrow/${b.id}`)"
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
      <van-empty v-if="!borrows.length" description="还没有借还记录，去「申请设备借出」吧" />
    </template>

    <!-- 底部标签栏：路由驱动（与企微端同款实现） -->
    <van-tabbar route safe-area-inset-bottom>
      <van-tabbar-item to="/m" icon="wap-nav">借用设备</van-tabbar-item>
      <van-tabbar-item to="/m/borrows" icon="orders-o">我的借还</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.center-tip {
  margin-top: 40px;
}
.reject {
  color: #ff4d4f;
}
.overdue {
  color: #ff4d4f;
  font-weight: 600;
}
</style>
