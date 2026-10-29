<script setup>
/** /m 登记表单（班级 / 姓名 / 学号 / 手机号），提交后即可借用 */
import { reactive, computed, watch } from 'vue';

const props = defineProps({
  binding: Boolean,
  /** 预填已有登记信息（老用户补填手机号时回显班级/姓名/学号） */
  initial: { type: Object, default: null },
});
const emit = defineEmits(['submit']);
const headText = computed(() =>
  props.initial?.studentNo ? '请补填手机号后继续借用（原有信息已回显）' : '填写借出人信息后即可申请借用设备'
);
const form = reactive({
  className: props.initial?.className || '',
  studentName: props.initial?.studentName || '',
  studentNo: props.initial?.studentNo || '',
  phone: props.initial?.phone || '',
});

watch(
  () => props.initial,
  (v) => {
    if (!v) return;
    form.className = v.className || '';
    form.studentName = v.studentName || '';
    form.studentNo = v.studentNo || '';
    form.phone = v.phone || '';
  }
);

function submit() {
  emit('submit', { ...form });
}
</script>

<template>
  <div class="bind-box">
    <div class="bind-head">
      <van-icon name="contact" size="40" color="#1989fa" />
      <p>{{ headText }}</p>
    </div>
    <van-cell-group inset>
      <van-field v-model="form.className" label="班级" maxlength="64" placeholder="如：计算机2401班" />
      <van-field v-model="form.studentName" label="姓名" maxlength="64" placeholder="真实姓名" />
      <van-field v-model="form.studentNo" label="学号" maxlength="15" placeholder="例：24137020806" type="digit" />
      <van-field v-model="form.phone" label="手机号" maxlength="11" placeholder="11位手机号" type="tel" required />
    </van-cell-group>
    <div class="bind-pad">
      <van-button type="primary" round block :loading="props.binding" @click="submit">保存并开始借用</van-button>
    </div>
  </div>
</template>

<style scoped>
.bind-box {
  padding: 60px 24px 24px;
  text-align: center;
}
.bind-head {
  margin-bottom: 16px;
  color: #646566;
  font-size: 13px;
}
.bind-pad {
  padding: 20px 16px;
}
</style>
