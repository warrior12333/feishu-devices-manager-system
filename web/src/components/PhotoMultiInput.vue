<script setup>
/**
 * 多图上传组件：微信九宫格风格，modelValue 为照片路径数组。
 * endpoint 留空走主 api 实例（企微会话），传 '/api/external/upload' 则走外部会话。
 */
import { ref, watch } from 'vue';
import { showToast, showImagePreview } from 'vant';
import api from '../api';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  label: { type: String, default: '拍照' },
  camera: { type: Boolean, default: true },
  endpoint: { type: String, default: '' },
  max: { type: Number, default: 9 },
  min: { type: Number, default: 3 },
});
const emit = defineEmits(['update:modelValue']);
const uploading = ref(false);

watch(
  () => props.modelValue,
  (v) => emit('update:modelValue', Array.isArray(v) ? v : [])
);

function remove(idx) {
  const list = [...props.modelValue];
  list.splice(idx, 1);
  emit('update:modelValue', list);
}

function preview(idx) {
  showImagePreview({ images: props.modelValue, startPosition: idx });
}

async function onChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (props.modelValue.length >= props.max) return showToast(`最多 ${props.max} 张`);
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
    emit('update:modelValue', [...props.modelValue, url]);
  } catch (err) {
    showToast(err.message || '照片上传失败，请重试');
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="pmi">
    <div class="grid">
      <div v-for="(p, i) in modelValue" :key="p" class="cell">
        <img :src="p" alt="" @click="preview(i)" />
        <van-icon name="clear" class="del" @click.stop="remove(i)" />
      </div>
      <label v-if="modelValue.length < max" class="cell trigger">
        <van-loading v-if="uploading" size="24" />
        <template v-else>
          <van-icon name="photograph" size="26" color="#c8c9cc" />
          <span>{{ modelValue.length }}/{{ max }}</span>
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
    <div class="pmi-hint">
      已传 {{ modelValue.length }} 张，至少需 {{ min }} 张<template v-if="label"> · {{ label }}</template>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cell {
  position: relative;
  width: 88px;
  height: 88px;
}
.cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
}
.trigger {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: #f7f8fa;
  border-radius: 8px;
  color: #969799;
  font-size: 12px;
  cursor: pointer;
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
.pmi-hint {
  margin-top: 8px;
  font-size: 11px;
  color: #969799;
}
</style>
