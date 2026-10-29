/**
 * 飞书自建应用封装：与企微并行的另一平台入口。
 *
 *  登录（OAuth 网页授权，与企微流程同构）：
 *    1. /f → 跳 passport.feishu.cn 授权页（用户已登录飞书时通常一键确认）
 *    2. 回调 code → POST /suite/passport/oauth/token 换 user_access_token
 *    3. GET /suite/passport/oauth/userinfo → open_id / name / avatar
 *
 *  通知（应用消息卡片）：
 *    - POST /open-apis/auth/v3/tenant_access_token/internal（app_id+app_secret）
 *    - POST /open-apis/im/v1/messages?receive_id_type=open_id（msg_type=interactive）
 *
 *  权限要求：获取用户基本信息、以应用身份发消息（im:message）。
 *  未配置 FEISHU_APP_ID / FEISHU_APP_SECRET 时，登录页与通知飞书通道自动停用。
 */
const config = require('../config');
const { safeRequest } = require('../utils/http');
const crypto = require('crypto');

const PASSPORT = 'https://passport.feishu.cn';
const OPEN_API = 'https://open.feishu.cn';

const tenantTokenCache = { token: '', expireAt: 0 };
const appTokenCache = { token: '', expireAt: 0 };
const jsapiTicketCache = { ticket: '', expireAt: 0 };

/** 建飞书 OAuth 授权跳转链接（redirect_uri 须在应用「重定向地址」白名单内） */
function buildOAuthUrl(next = '/') {
  const redirect = encodeURIComponent(`${config.baseUrl}/api/feishu/callback`);
  const state = encodeURIComponent(next || '/');
  return (
    `${PASSPORT}/suite/passport/oauth/authorize?client_id=${encodeURIComponent(config.feishu.appId)}` +
    `&redirect_uri=${redirect}&response_type=code&state=${state}`
  );
}

/** OAuth code 换用户信息（open_id / name / avatar） */
async function getUserInfoByCode(code) {
  const body = await safeRequest('post', `${PASSPORT}/suite/passport/oauth/token`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.feishu.appId,
      client_secret: config.feishu.secret,
      code,
      redirect_uri: `${config.baseUrl}/api/feishu/callback`,
    }).toString(),
  });
  if (!body.access_token) {
    throw new Error(`飞书授权失败：${body.err || body.error || 'unknown'} ${body.error_description || body.em || ''}`);
  }
  const info = await safeRequest('get', `${PASSPORT}/suite/passport/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  if (!info.open_id && !info.sub) throw new Error('飞书未返回用户 open_id');
  return {
    openId: info.open_id || info.sub,
    unionId: info.union_id || '',
    name: info.name || '',
    avatar: info.avatar_url || info.picture || '',
  };
}

/** tenant_access_token（内存缓存，提前 5 分钟刷新） */
async function getTenantAccessToken(force = false) {
  if (!config.feishu.configured) throw new Error('飞书应用未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）');
  if (!force && tenantTokenCache.token && Date.now() < tenantTokenCache.expireAt) return tenantTokenCache.token;
  const body = await safeRequest('post', `${OPEN_API}/open-apis/auth/v3/tenant_access_token/internal`, {
    data: { app_id: config.feishu.appId, app_secret: config.feishu.secret },
  });
  if (body.code !== 0) throw new Error(`飞书 tenant_access_token 获取失败: ${body.code} ${body.msg}`);
  tenantTokenCache.token = body.tenant_access_token;
  tenantTokenCache.expireAt = Date.now() + (body.expire - 300) * 1000;
  return tenantTokenCache.token;
}

/** app_access_token（H5 免登 code 换 user_access_token 用，内存缓存） */
async function getAppAccessToken(force = false) {
  if (!config.feishu.configured) throw new Error('飞书应用未配置（FEISHU_APP_ID / FEISHU_APP_SECRET）');
  if (!force && appTokenCache.token && Date.now() < appTokenCache.expireAt) return appTokenCache.token;
  const body = await safeRequest('post', `${OPEN_API}/open-apis/auth/v3/app_access_token/internal`, {
    data: { app_id: config.feishu.appId, app_secret: config.feishu.secret },
  });
  if (body.code !== 0) throw new Error(`飞书 app_access_token 获取失败: ${body.code} ${body.msg}`);
  appTokenCache.token = body.app_access_token;
  appTokenCache.expireAt = Date.now() + (body.expire - 300) * 1000;
  return appTokenCache.token;
}

/** jsapi_ticket（H5 JSAPI 鉴权用，内存缓存） */
async function getJsapiTicket(force = false) {
  if (!force && jsapiTicketCache.ticket && Date.now() < jsapiTicketCache.expireAt) return jsapiTicketCache.ticket;
  const token = await getTenantAccessToken();
  const body = await safeRequest('post', `${OPEN_API}/open-apis/jssdk/ticket/get`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (body.code !== 0) throw new Error(`飞书 jsapi_ticket 获取失败: ${body.code} ${body.msg}`);
  jsapiTicketCache.ticket = body.data.ticket;
  jsapiTicketCache.expireAt = Date.now() + (body.data.expire_in - 300) * 1000;
  return jsapiTicketCache.ticket;
}

/** 生成 h5sdk.config 所需签名（verifyStr 字典序拼接后 sha1；url 不含 # 及其后部分） */
async function makeH5Signature(pageUrl) {
  const ticket = await getJsapiTicket();
  const nonceStr = crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const plain = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${pageUrl}`;
  const signature = crypto.createHash('sha1').update(plain).digest('hex');
  return { appId: config.feishu.appId, timestamp, nonceStr, signature };
}

/**
 * H5 免登（飞书客户端内 tt.requestAccess / requestAuthCode 的 code）换用户信息。
 * 走 authen v1：code -> user_access_token + open_id -> 用户资料。
 */
async function getUserInfoByH5Code(code) {
  const appToken = await getAppAccessToken();
  const tokenBody = await safeRequest('post', `${OPEN_API}/open-apis/authen/v1/access_token`, {
    headers: { Authorization: `Bearer ${appToken}`, 'Content-Type': 'application/json; charset=utf-8' },
    data: { grant_type: 'authorization_code', code },
  });
  if (tokenBody.code !== 0 || !tokenBody.data || !tokenBody.data.access_token) {
    throw new Error(`飞书免登失败: ${tokenBody.code} ${tokenBody.msg}`);
  }
  const { open_id: openId, union_id: unionId, access_token: userToken } = tokenBody.data;
  let name = '';
  let avatar = '';
  try {
    const info = await safeRequest('get', `${OPEN_API}/open-apis/authen/v1/user_info`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (info.code === 0 && info.data) {
      name = info.data.name || '';
      avatar = info.data.avatar_url || '';
    }
  } catch {
    // 资料拉取失败不阻塞登录，open_id 已可确定身份
  }
  return { openId, unionId: unionId || '', name, avatar };
}

/** 企微 textcard 的 HTML 描述转纯文本行（用于卡片正文） */
function htmlToLines(html) {
  return String(html || '')
    .replace(/<div[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 发送消息卡片。返回 { mock, sent } 与企微 sendTextCard 对齐。
 */
async function sendCard({ openId, title, html, url, template = 'orange' }) {
  if (!config.feishu.configured) return { mock: true };
  const lines = htmlToLines(html);
  const token = await getTenantAccessToken();
  const card = {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '查看详情' },
            type: 'primary',
            url,
          },
        ],
      },
    ],
  };
  const body = await safeRequest('post', `${OPEN_API}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    data: { receive_id: openId, msg_type: 'interactive', content: JSON.stringify(card) },
  });
  if (body.code !== 0) throw new Error(`飞书消息发送失败: ${body.code} ${body.msg}`);
  return { mock: false, sent: true };
}

/**
 * 拉取飞书通讯录成员（根部门递归），用于成员同步。
 * 返回 [{ openId, name }]；需要通讯录读取权限（应用可见范围内）。
 */
async function listDirectoryUsers() {
  const token = await getTenantAccessToken();
  const items = [];
  let pageToken = '';
  do {
    // page_size 上限 50,分页拉全量
    const params = { department_id: '0', user_id_type: 'open_id', page_size: 50 };
    if (pageToken) params.page_token = pageToken;
    const body = await safeRequest('get', `${OPEN_API}/open-apis/contact/v3/users/find_by_department`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    });
    if (body.code !== 0) throw new Error(`飞书通讯录拉取失败: ${body.code} ${body.msg}`);
    items.push(...(body.data.items || []).map((u) => ({ openId: u.open_id, name: u.name || '' })));
    pageToken = body.data.page_token || '';
    if (!body.data.has_more) break;
  } while (pageToken);
  return items;
}

module.exports = {
  configured: () => config.feishu.configured,
  buildOAuthUrl,
  getUserInfoByCode,
  getUserInfoByH5Code,
  makeH5Signature,
  sendCard,
  listDirectoryUsers,
};
