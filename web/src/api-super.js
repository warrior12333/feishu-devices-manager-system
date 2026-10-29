/**
 * /superadmin 专用请求实例：独立于主 api.js，
 * 401 时不触发企微登录跳转，而是带上 unauthorized 标记由页面切换到登录视图。
 */
import axios from 'axios';

const apiSuper = axios.create({ baseURL: '/api/superadmin', timeout: 20000 });

apiSuper.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status;
    const msg = err.response?.data?.error || '请求失败，请稍后重试';
    if (status === 401) err.unauthorized = true;
    return Promise.reject(err);
  }
);

export default apiSuper;
