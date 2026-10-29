<script setup>
/**
 * 桌面端专属布局（≥768px 且为主应用页面时启用）：
 * 左侧深色导航（设备库/我的借还/审批 + 待办角标 + 用户区）
 * + 右侧宽幅内容区（页面内容通过插槽渲染，移动端 UI 元素由全局 CSS 隐藏）。
 */
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { user, pendingApprovals, refreshMe } from '../store';

const route = useRoute();

const navs = computed(() => {
  const base = [
    { to: '/', label: '设备库', icon: '▦' },
    { to: '/my-borrows', label: '我的借还', icon: '⇄' },
    { to: '/approvals', label: '审批', icon: '☑' },
  ];
  if (user.value?.role === 'admin') base.push({ to: '/records', label: '借还记录', icon: '☰' });
  return base;
});

function isActive(to) {
  if (to === '/') return route.path === '/';
  return route.path.startsWith(to);
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/api/feishu/login?next=%2F';
}

onMounted(() => {
  refreshMe().catch(() => {});
});
</script>

<template>
  <div class="app-desktop dt-shell">
    <aside class="dt-side">
      <div class="dt-brand">
        <img class="dt-logo" src="/logo.png?v=20260918" alt="融媒体设备管理" />
      </div>
      <nav class="dt-navs">
        <div
          v-for="n in navs"
          :key="n.to"
          class="dt-nav"
          :class="{ on: isActive(n.to) }"
          @click="$router.push(n.to)"
        >
          <span class="dt-ico">{{ n.icon }}</span>
          <span class="dt-label">{{ n.label }}</span>
          <span v-if="n.to === '/approvals' && pendingApprovals" class="dt-badge">
            {{ pendingApprovals > 99 ? '99+' : pendingApprovals }}
          </span>
        </div>
      </nav>
      <div class="dt-user" v-if="user">
        <div class="dt-avatar">{{ (user.name || '?')[0] }}</div>
        <div class="dt-uinfo">
          <b>{{ user.name }}</b>
          <span>{{ user.role === 'admin' ? '管理员' : '成员' }}</span>
        </div>
        <button class="dt-out" title="退出登录" @click="logout">退出</button>
      </div>
    </aside>
    <main class="dt-main">
      <div class="dt-title" v-if="route.meta.title">{{ route.meta.title }}</div>
      <slot />
    </main>
  </div>
</template>

<style scoped>
.dt-shell {
  display: flex;
  min-height: 100vh;
}
.dt-side {
  width: 216px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  background: #001529;
  color: rgba(255, 255, 255, 0.65);
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
  box-sizing: border-box;
}
.dt-brand {
  display: flex;
  align-items: center;
  padding: 6px 8px 18px;
}
.dt-logo {
  height: 30px;
  width: auto;
  display: block;
}
.dt-navs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.dt-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s ease, color 0.15s ease;
}
.dt-nav:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.dt-nav.on {
  background: #1677ff;
  color: #fff;
  font-weight: 600;
}
.dt-ico {
  font-size: 15px;
  width: 18px;
  text-align: center;
}
.dt-label {
  flex: 1;
}
.dt-badge {
  background: #ff4d4f;
  color: #fff;
  border-radius: 10px;
  font-size: 11px;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  padding: 0 5px;
  box-sizing: border-box;
}
.dt-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 8px 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.dt-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #2a3345;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.dt-uinfo {
  flex: 1;
  min-width: 0;
  line-height: 1.3;
}
.dt-uinfo b {
  display: block;
  color: #fff;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dt-uinfo span {
  font-size: 11px;
  color: #8b93a5;
}
.dt-out {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: transparent;
  color: #c7cdd9;
  border-radius: 8px;
  font-size: 11px;
  padding: 5px 8px;
  cursor: pointer;
  flex-shrink: 0;
}
.dt-out:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.dt-main {
  flex: 1;
  min-width: 0;
  max-width: 1120px;
  margin: 0 auto;
  padding: 22px 36px 56px;
  box-sizing: border-box;
}
.dt-title {
  font-size: 20px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.88);
  padding-bottom: 14px;
  margin-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}
</style>
