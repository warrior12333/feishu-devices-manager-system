<script setup>
/** 设备新增 / 编辑（管理员）；编辑页兼有删除入口。
 * 负责人（借还审批人）不再手动选择，由后端自动取 .env 配置的管理员。 */
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast, showConfirmDialog } from 'vant';
import api from '../api';
import PhotoMultiInput from '../components/PhotoMultiInput.vue';

const route = useRoute();
const router = useRouter();
const isEdit = computed(() => Boolean(route.params.id));

const form = reactive({
  name: '',
  category: '',
  model: '',
  serial_no: '',
  location: '',
  remark: '',
  images: [],
});

const categories = ref([]);
const saving = ref(false);

async function load() {
  const catsRes = await api.get('/devices/categories');
  categories.value = catsRes.items;
  if (isEdit.value) {
    const res = await api.get(`/devices/${route.params.id}`);
    Object.assign(form, {
      name: res.device.name,
      category: res.device.category,
      model: res.device.model,
      serial_no: res.device.serial_no,
      location: res.device.location,
      remark: res.device.remark,
      images: res.device.images && res.device.images.length ? res.device.images : res.device.image ? [res.device.image] : [],
    });
  }
}

async function save() {
  if (!form.name.trim()) return showToast('请填写设备名称');
  saving.value = true;
  try {
    const payload = { ...form, name: form.name.trim(), category: form.category.trim() || '未分类', images: form.images };
    if (isEdit.value) {
      await api.put(`/devices/${route.params.id}`, payload);
      showToast('已保存');
      router.back();
    } else {
      await api.post('/devices', payload);
      showToast('设备已添加');
      router.back();
    }
  } finally {
    saving.value = false;
  }
}

async function remove() {
  try {
    await showConfirmDialog({ title: '删除设备', message: '确定删除该设备吗？删除后不可恢复。' });
  } catch {
    return;
  }
  try {
    await api.delete(`/devices/${route.params.id}`);
    showToast('已删除');
    router.replace('/');
  } catch {
    /* 错误已由拦截器提示（如存在未完成借还） */
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <van-nav-bar
      :title="isEdit ? '编辑设备' : '新增设备'"
      left-arrow
      @click-left="router.back()"
    />

    <van-cell-group inset class="form">
      <van-field v-model="form.name" label="设备名称" required maxlength="128" placeholder="如：Sony A7M4 相机" />
      <van-field v-model="form.category" label="分类" maxlength="64" placeholder="如：相机 / 镜头 / 无人机" />
      <div class="quick-cats" v-if="categories.length">
        <van-tag
          v-for="c in categories"
          :key="c.name"
          plain
          size="large"
          class="qcat"
          @click="form.category = c.name"
        >
          {{ c.name }}
        </van-tag>
      </div>
      <van-field v-model="form.model" label="型号规格" maxlength="128" placeholder="选填" />
      <van-field v-model="form.serial_no" label="序列号" maxlength="128" placeholder="选填" />
      <van-field v-model="form.location" label="存放位置" maxlength="128" placeholder="如：器材室A柜" />
      <van-field
        v-model="form.remark"
        label="备注"
        type="textarea"
        rows="1"
        autosize
        maxlength="1000"
        placeholder="选填"
      />
      <van-cell title="设备图片">
        <template #label>
          <PhotoMultiInput v-model="form.images" :camera="false" :min="1" :max="9" label="首张将作为封面展示在列表" />
        </template>
      </van-cell>
    </van-cell-group>

    <div class="submit">
      <van-button type="primary" round block :loading="saving" @click="save">
        {{ isEdit ? '保存' : '添加设备' }}
      </van-button>
      <van-button v-if="isEdit" round block plain type="danger" class="del-btn" @click="remove">
        删除设备
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.form {
  margin-top: 12px;
}
.quick-cats {
  padding: 0 32px 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.qcat {
  cursor: pointer;
  padding: 3px 8px;
}
.submit {
  padding: 20px 16px;
}
.del-btn {
  margin-top: 12px;
}
</style>
