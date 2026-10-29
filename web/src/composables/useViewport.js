/** 视口响应：isDesktop 断点（≥768px 视为桌面布局） */
import { ref } from 'vue';

const mql = window.matchMedia('(min-width: 768px)');
const isDesktop = ref(mql.matches);
if (mql.addEventListener) {
  mql.addEventListener('change', (e) => {
    isDesktop.value = e.matches;
  });
} else if (mql.addListener) {
  mql.addListener((e) => {
    isDesktop.value = e.matches;
  });
}

export function useViewport() {
  return { isDesktop };
}
