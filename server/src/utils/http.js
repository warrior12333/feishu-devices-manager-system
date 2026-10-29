/**
 * 服务端出站请求统一封装（SSRF 防护）。
 *
 * 所有服务端对外发起的 HTTP 请求必须经过这里：
 *  - 仅允许 https 协议；
 *  - host 必须在白名单内（企业微信 / 飞书开放平台 API 域名）；
 *  - 发起前做 DNS 解析，命中 localhost / 环回 / 私有 / 保留地址一律拒绝。
 */
const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');

const ALLOWED_HOSTS = new Set(['qyapi.weixin.qq.com', 'passport.feishu.cn', 'open.feishu.cn']);

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10/8
      a === 127 || // 环回
      a === 169 && b === 254 || // 链路本地
      a === 172 && b >= 16 && b <= 31 || // 172.16/12
      a === 192 && b === 168 || // 192.168/16
      (a === 100 && b >= 64 && b <= 127) || // CGNAT 保留
      a >= 224 // 组播与保留段
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || // 链路本地
    v6.startsWith('fc') || v6.startsWith('fd') || // ULA 私有
    v6.startsWith('ff') // 组播
  );
}

async function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`非法 URL: ${rawUrl}`);
  }
  if (url.protocol !== 'https:') throw new Error(`仅允许 https 请求，已拦截: ${url.protocol}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`目标 host 不在白名单: ${url.hostname}`);
  const records = await dns.lookup(url.hostname, { all: true });
  for (const { address } of records) {
    if (isBlockedIp(address)) throw new Error(`目标解析到保留/私有地址，已拦截: ${address}`);
  }
  return url;
}

async function safeRequest(method, rawUrl, { params, data, headers, timeout = 10000 } = {}) {
  await assertSafeUrl(rawUrl);
  try {
    const res = await axios.request({ method, url: rawUrl, params, data, headers, timeout });
    return res.data;
  } catch (e) {
    // 带上上游响应体（飞书/企微的业务错误码在 body 里，仅靠 HTTP 状态码无法定位）
    if (e.response) {
      const detail = typeof e.response.data === 'string' ? e.response.data.slice(0, 300) : JSON.stringify(e.response.data).slice(0, 300);
      throw new Error(`上游响应 ${e.response.status}: ${detail}`);
    }
    throw e;
  }
}

module.exports = { assertSafeUrl, safeRequest };
