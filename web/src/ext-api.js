/**
 * /m 外部借用页专用请求封装：fetch + 同源 cookie，
 * 统一 JSON 解析与错误消息抛出（页面直接 showToast(err.message)）。
 */
async function request(method, path, body) {
  const res = await fetch(`/api/external${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || '请求失败，请稍后重试');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const extApi = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
};

/** 图片上传，返回 /uploads/... 站内路径 */
export async function extUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/external/upload', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '上传失败');
  return data.url;
}
