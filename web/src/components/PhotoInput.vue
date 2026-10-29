<script setup>
/**
 * 拍照上传组件：camera=true 时强制调起相机（借出/归还拍照要求现场拍摄），
 * camera=false 允许从相册选择（设备图片等）。
 */
import { ref } from 'vue';
import { showToast, showImagePreview } from 'vant';
import api from '../api';

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, default: '拍照' },
  camera: { type: Boolean, default: true },
  // 自定义上传端点（如 /api/external/upload，走原生 fetch 带同源 cookie）；
  // 留空则走主 api 实例（企微会话）
  endpoint: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);
const uploading = ref(false);

async function onChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  uploading.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    let url;
    if (props.endpoint) {
      const r = await fetch(props.endpoint, { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || '上传失败');
      url = data.url;
    } else {
      const res = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      url = res.url;
    }
    emit('update:modelValue', url);
  } catch {
    showToast('照片上传失败，请重试');
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="photo-input">
    <div v-if="modelValue" class="preview">
      <img :src="modelValue" alt="照片" @click="showImagePreview([modelValue])" />
      <van-icon name="clear" class="del" @click.stop="emit('update:modelValue', '')" />
    </div>
    <label v-else class="trigger">
      <van-loading v-if="uploading" size="24" />
      <template v-else>
        <van-icon name="photograph" size="26" color="#c8c9cc" />
        <span>{{ label }}</span>
      </template>
      <input
        type="file"
        accept="image/*"
        :capture="camera ? 'camera' : undefined"
        hidden
        @change="onChange"
      />
    </label>
  </div>
</template>

<style scoped>
.photo-input {
  display: inline-block;
}
.trigger {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 88px;
  height: 88px;
  background: #f7f8fa;
  border-radius: 8px;
  color: #969799;
  font-size: 12px;
  cursor: pointer;
}
.preview {
  position: relative;
  width: 88px;
  height: 88px;
}
.preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
}
.del {
  position: absolute;
  top: -8px;
  right: -8px;
  font-size: 20px;
  color: #969799;
  background: #fff;
  border-radius: 50%;
}
</style>
