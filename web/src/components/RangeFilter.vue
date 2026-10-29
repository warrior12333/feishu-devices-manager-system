<script setup>
/** 时间范围筛选(下拉选择):默认最近30天;value=0 表示全部记录 */
const props = defineProps({ modelValue: { type: Number, default: 30 } });
const emit = defineEmits(['update:modelValue', 'change']);

const options = [
  { text: '最近7天', value: 7 },
  { text: '最近30天', value: 30 },
  { text: '最近90天', value: 90 },
  { text: '最近一年', value: 365 },
  { text: '全部记录', value: 0 },
];

function onChange(e) {
  const v = Number(e.target.value);
  emit('update:modelValue', v);
  emit('change', v);
}
</script>

<template>
  <select class="range-select" :value="modelValue" @change="onChange">
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.text }}</option>
  </select>
</template>

<style scoped>
.range-select {
  display: block;
  height: 38px;
  width: calc(100% - 24px);
  margin: 8px 12px 0;
  padding: 0 34px 0 12px;
  border: 1px solid var(--ant-border, #f0f0f0);
  border-radius: 8px;
  background: var(--ant-card, #fff) url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23999'/%3E%3C/svg%3E") no-repeat right 12px center;
  appearance: none;
  -webkit-appearance: none;
  color: var(--ant-text, rgba(0, 0, 0, 0.88));
  font-size: 13px;
  cursor: pointer;
  outline: none;
}
.range-select:focus {
  border-color: var(--ant-primary, #1677ff);
}

/* 桌面端:固定宽度、右对齐(AntD 工具栏筛选器惯例) */
@media (min-width: 768px) {
  .range-select {
    width: 200px;
    margin: 10px 0 0 auto;
  }
}
</style>
