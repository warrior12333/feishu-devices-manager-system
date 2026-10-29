<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { pendingApprovals } from './store';
import { useViewport } from './composables/useViewport';
import DesktopShell from './components/DesktopShell.vue';

const route = useRoute();
const { isDesktop } = useViewport();
// 桌面专属布局仅用于主应用页面；外部 /m、超管 /superadmin、登录中转页保持各自布局
const desktopApp = computed(() => isDesktop.value && !route.meta.public && !route.meta.super);
</script>

<template>
  <DesktopShell v-if="desktopApp">
    <router-view />
  </DesktopShell>

  <template v-else>
    <router-view />

    <van-tabbar v-if="route.meta.tabbar" route safe-area-inset-bottom>
      <van-tabbar-item to="/" icon="wap-nav">设备</van-tabbar-item>
      <van-tabbar-item to="/my-borrows" icon="orders-o">我的借还</van-tabbar-item>
      <van-tabbar-item to="/approvals" icon="clock-o">
        审批
        <template #icon>
          <van-badge :content="pendingApprovals" max="99" :show-zero="false">
            <van-icon name="todo-list-o" />
          </van-badge>
        </template>
      </van-tabbar-item>
    </van-tabbar>
  </template>
</template>
