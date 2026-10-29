import axios from 'axios';
import { showToast } from 'vant';

const api = axios.create({ baseURL: '/api', timeout: 20000 });

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status;
    const msg = err.response?.data?.error || '请求失败，请稍后重试';
    if (status === 401) {
      // 未登录 -> 飞书 OAuth（企业微信已移除），登录后回到当前页；
      // 浏览器打开授权页可扫码/账号登录，授权一次 7 天内免登
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/api/feishu/login?next=${next}`;
      return new Promise(() => {});
    }
    showToast(msg);
    return Promise.reject(new Error(msg));
  }
);

export default api;
