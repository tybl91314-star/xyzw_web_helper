<template>
  <n-config-provider :theme="naiveTheme">
    <n-message-provider>
      <n-loading-bar-provider>
        <n-notification-provider>
          <n-dialog-provider>
            <div id="app">
              <router-view />
              <MobileBottomNav />
            </div>
          </n-dialog-provider>
        </n-notification-provider>
      </n-loading-bar-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from "vue";
import { darkTheme } from "naive-ui";
import { useTheme } from "@/composables/useTheme";
import MobileBottomNav from "@/components/Common/MobileBottomNav.vue";

const { isDark, initTheme, setupSystemThemeListener, updateReactiveState } =
  useTheme();

// Naive UI 主题
const naiveTheme = computed(() => {
  return isDark.value ? darkTheme : null;
});

// 监听主题变化事件
const handleThemeChange = () => {
  // 确保响应式状态同步
  updateReactiveState();
  // 强制重新渲染
  setTimeout(() => {
    updateReactiveState();
  }, 50);
};

onMounted(() => {
  initTheme();
  setupSystemThemeListener();

  // 监听自定义主题变化事件
  window.addEventListener("theme-change", handleThemeChange);

  // 初始化时更新状态
  updateReactiveState();
});

onUnmounted(() => {
  window.removeEventListener("theme-change", handleThemeChange);
});
</script>

<style>
/* 主题变量 */
:root {
  --app-background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --text-color: #333;
  --text-secondary: #666;
  --text-tertiary: #999;
  --bg-color: #ffffff;
  --border-color: #e0e0e0;
}

/* 深色主题变量 */
.dark {
  --app-background: linear-gradient(135deg, #2d3748 0%, #4a5568 100%);
  --text-color: #ffffff !important;
  --text-secondary: #cbd5e0 !important;
  --text-tertiary: #a0aec0 !important;
  --bg-color: #1a202c !important;
  --border-color: #4a5568 !important;
}

/* 深色主题样式优化 - 针对Naive UI组件 */
html.dark,
html[data-theme="dark"] {
  color-scheme: dark;
}

/* 全局深色主题文字颜色 */
html.dark *,
html[data-theme="dark"] * {
  color: #ffffff;
}

/* Naive UI 表单组件 */
html.dark .n-form-item-label,
html.dark .n-form-item-label__text,
html[data-theme="dark"] .n-form-item-label,
html[data-theme="dark"] .n-form-item-label__text {
  color: #ffffff !important;
}

/* Naive UI 输入组件 */
html.dark .n-input,
html.dark .n-input__input,
html.dark .n-input__textarea,
html[data-theme="dark"] .n-input,
html[data-theme="dark"] .n-input__input,
html[data-theme="dark"] .n-input__textarea {
  color: #ffffff !important;
  background-color: rgba(255, 255, 255, 0.1) !important;
}

/* Naive UI 弹框组件 */
html.dark .n-modal,
html.dark .n-drawer,
html.dark .n-popover,
html.dark .n-dropdown,
html.dark .n-tooltip,
html.dark .n-dialog,
html[data-theme="dark"] .n-modal,
html[data-theme="dark"] .n-drawer,
html[data-theme="dark"] .n-popover,
html[data-theme="dark"] .n-dropdown,
html[data-theme="dark"] .n-tooltip,
html[data-theme="dark"] .n-dialog {
  color: #ffffff !important;
}

/* Naive UI 弹框内容 */
html.dark .n-modal .n-card,
html.dark .n-drawer-content,
html.dark .n-popover-content,
html.dark .n-dropdown-option,
html.dark .n-dialog__content,
html[data-theme="dark"] .n-modal .n-card,
html[data-theme="dark"] .n-drawer-content,
html[data-theme="dark"] .n-popover-content,
html[data-theme="dark"] .n-dropdown-option,
html[data-theme="dark"] .n-dialog__content {
  color: #ffffff !important;
}

/* Naive UI 下拉选项 */
html.dark .n-dropdown-option__label,
html.dark .n-select-option,
html.dark .n-menu-item-content,
html[data-theme="dark"] .n-dropdown-option__label,
html[data-theme="dark"] .n-select-option,
html[data-theme="dark"] .n-menu-item-content {
  color: #ffffff !important;
}

/* 其他组件 */
html.dark .n-collapse-item__header,
html.dark .n-radio-button,
html.dark .n-card,
html.dark .n-card__content,
html.dark .n-button,
html.dark .n-tag,
html[data-theme="dark"] .n-collapse-item__header,
html[data-theme="dark"] .n-radio-button,
html[data-theme="dark"] .n-card,
html[data-theme="dark"] .n-card__content,
html[data-theme="dark"] .n-button,
html[data-theme="dark"] .n-tag {
  color: #ffffff !important;
}

/* 标题和文本 */
html.dark h1,
html.dark h2,
html.dark h3,
html.dark h4,
html.dark h5,
html.dark h6,
html.dark p,
html.dark span,
html.dark div,
html.dark label,
html[data-theme="dark"] h1,
html[data-theme="dark"] h2,
html[data-theme="dark"] h3,
html[data-theme="dark"] h4,
html[data-theme="dark"] h5,
html[data-theme="dark"] h6,
html[data-theme="dark"] p,
html[data-theme="dark"] span,
html[data-theme="dark"] div,
html[data-theme="dark"] label {
  color: #ffffff !important;
}

/* 占位符文本 */
html.dark .n-input__placeholder,
html.dark ::placeholder,
html[data-theme="dark"] .n-input__placeholder,
html[data-theme="dark"] ::placeholder {
  color: rgba(255, 255, 255, 0.6) !important;
}

/* 确保Portal渲染的组件也应用深色主题 */
body.dark .n-modal-container,
body.dark .n-drawer-container,
body.dark .n-popover-container,
body[data-theme="dark"] .n-modal-container,
body[data-theme="dark"] .n-drawer-container,
body[data-theme="dark"] .n-popover-container {
  color: #ffffff !important;
}

#app {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--app-background);
  color: var(--text-color);
  transition:
    background 0.3s ease,
    color 0.3s ease;
}

/* 全局样式重置 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  min-width: 320px;
  overflow-x: hidden;
  overscroll-behavior-x: none;
  font-family:
    "SF Pro Display",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "PingFang SC",
    "Hiragino Sans GB",
    "Microsoft YaHei",
    "Helvetica Neue",
    Helvetica,
    Arial,
    sans-serif;
  color: var(--text-color);
  transition: color 0.3s ease;
}

@media (max-width: 768px) {
  :root {
    --mobile-status-bar-gap: max(
      36px,
      calc(env(safe-area-inset-top) + 10px)
    );
    --mobile-bottom-nav-gap: calc(74px + env(safe-area-inset-bottom));
  }

  #app {
    padding-bottom: 0;
  }

  /*
   * 底部导航是 fixed，只有不经过 DefaultLayout 的直属页面需要自行预留高度。
   * 占位放进页面本身，避免 #app 的紫色背景在页面末尾额外露出一截。
   */
  #app > :not(.mobile-navigation):not(.default-layout) {
    padding-bottom: var(--mobile-bottom-nav-gap) !important;
  }

  /*
   * Naive UI 的弹窗会 Teleport 到 body，必须在全局统一限制。
   * 顶部避开 Android 状态栏，底部给固定导航留出空间，长内容只在弹窗内部滚动。
   */
  .n-modal-body-wrapper {
    top: var(--mobile-status-bar-gap) !important;
    bottom: var(--mobile-bottom-nav-gap) !important;
    overflow: hidden !important;
  }

  .n-modal-body-wrapper > .n-scrollbar,
  .n-modal-body-wrapper > .n-scrollbar > .n-scrollbar-container {
    height: 100% !important;
    max-height: 100% !important;
  }

  .n-modal-scroll-content {
    min-height: 100% !important;
    padding: 8px 10px !important;
  }

  .n-modal {
    width: auto;
    max-width: calc(100vw - 20px) !important;
    max-height: calc(
      100dvh - var(--mobile-status-bar-gap) -
        var(--mobile-bottom-nav-gap) - 16px
    ) !important;
    margin: auto !important;
  }

  .n-modal.n-card,
  .n-modal.n-dialog {
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
  }

  .n-modal.n-card > .n-card-header,
  .n-modal.n-card > .n-card__footer,
  .n-modal.n-dialog > .n-dialog__title,
  .n-modal.n-dialog > .n-dialog__action {
    flex: 0 0 auto;
  }

  .n-modal.n-card > .n-card-header {
    padding: 14px 16px 10px !important;
  }

  .n-modal.n-card > .n-card__content,
  .n-modal.n-dialog > .n-dialog__content {
    min-height: 0 !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .n-modal.n-card > .n-card__content {
    padding: 12px 16px 16px !important;
  }

  .n-drawer-container .n-drawer {
    top: var(--mobile-status-bar-gap) !important;
    bottom: var(--mobile-bottom-nav-gap) !important;
    height: auto !important;
    max-height: calc(
      100dvh - var(--mobile-status-bar-gap) - var(--mobile-bottom-nav-gap)
    ) !important;
  }

  .n-drawer-content .n-drawer-body-content-wrapper {
    overflow-y: auto !important;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
}

button,
a,
input,
select,
textarea {
  touch-action: manipulation;
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}
</style>
