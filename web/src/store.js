import { ref } from 'vue';
import api from './api';

export const user = ref(null);
export const pendingApprovals = ref(0);

let fetched = false;

export async function fetchMe(force = false) {
  if (fetched && !force) return user.value;
  const data = await api.get('/auth/me');
  user.value = data.user;
  pendingApprovals.value = data.pendingApprovals || 0;
  fetched = true;
  return user.value;
}

export function refreshMe() {
  return fetchMe(true);
}
