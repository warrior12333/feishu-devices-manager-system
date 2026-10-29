<script setup>
/**
 * /f 飞书端入口（与企微 /api/auth/login 同构的简单模式）：
 *  已有会话 → 直达首页；无会话 → 跳飞书 OAuth 授权页确认一次（之后 cookie 保持 7 天）。
 *  通知卡片「查看详情」打开的页面若会话过期，会经 feishu_login 标记自动回到这里。
 */
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { fetchMe, user } from '../store';

const router = useRouter();

function oauthLogin() {
  const next = encodeURIComponent('/');
  location.href = `/api/feishu/login?next=${next}`;
}

onMounted(async () => {
  try {
    await fetchMe(true);
    showToast(`欢迎，${user.value?.name || ''}`);
    router.replace('/');
  } catch {
    oauthLogin();
  }
});
</script>

<template>
  <div class="page center-tip"><van-loading vertical>正在进入设备管理…</van-loading></div>
</template>

<style scoped>
.center-tip {
  padding: 120px 0;
  text-align: center;
}
</style>
