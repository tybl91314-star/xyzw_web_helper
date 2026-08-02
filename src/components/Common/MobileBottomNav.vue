<template>
  <div class="mobile-navigation">
    <button
      v-if="showGameMenu"
      class="mobile-navigation__backdrop"
      aria-label="关闭游戏功能菜单"
      @click="showGameMenu = false"
    />

    <transition name="mobile-game-menu">
      <div
        v-if="showGameMenu"
        class="mobile-game-panel"
        aria-label="游戏功能分类"
      >
        <button
          v-for="item in gameSections"
          :key="item.section"
          type="button"
          class="mobile-game-item"
          :class="{ active: activeGameSection === item.section }"
          @click="openGameSection(item.section)"
        >
          <n-icon><component :is="item.icon" /></n-icon>
          <span>{{ item.label }}</span>
        </button>
      </div>
    </transition>

    <nav class="mobile-bottom-nav" aria-label="移动端主导航">
      <router-link to="/tokens" class="mobile-bottom-item">
        <n-icon><PersonCircle /></n-icon>
        <span>Token</span>
      </router-link>
      <router-link :to="homeTarget" class="mobile-bottom-item">
        <n-icon><Home /></n-icon>
        <span>首页</span>
      </router-link>
      <button
        type="button"
        class="mobile-bottom-item mobile-bottom-item--button"
        :class="{ active: route.path === '/admin/game-features' }"
        :aria-expanded="showGameMenu"
        @click="toggleGameMenu"
      >
        <n-icon><Cube /></n-icon>
        <span>游戏</span>
      </button>
      <button
        type="button"
        class="mobile-bottom-item mobile-bottom-item--button"
        :class="{ active: route.path === '/admin/batch-daily-tasks' }"
        @click="openProtectedRoute('/admin/batch-daily-tasks')"
      >
        <n-icon><Layers /></n-icon>
        <span>批量</span>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMessage } from "naive-ui";
import {
  Build,
  Calendar,
  Cube,
  Flash,
  Gift,
  Home,
  Layers,
  Leaf,
  People,
  PersonCircle,
  Shield,
  Trophy,
} from "@vicons/ionicons5";
import { useTokenStore } from "@/stores/tokenStore";
import { hasAvailableTokens } from "@/utils/hasAvailableTokens";

const route = useRoute();
const router = useRouter();
const message = useMessage();
const tokenStore = useTokenStore();
const showGameMenu = ref(false);

const gameSections = [
  { label: "日常", section: "daily", icon: Calendar },
  { label: "俱乐部", section: "club", icon: People },
  { label: "活动", section: "activity", icon: Gift },
  { label: "工具", section: "tools", icon: Build },
  { label: "盐场", section: "saltFieldGroup", icon: Shield },
  { label: "蟠桃园", section: "peachGroup", icon: Leaf },
  { label: "排行榜", section: "rankGroup", icon: Trophy },
  { label: "切磋", section: "fightPvp", icon: Flash },
];

const homeTarget = computed(() =>
  hasAvailableTokens(tokenStore) ? "/admin/dashboard" : "/",
);

const activeGameSection = computed(() =>
  route.path === "/admin/game-features"
    ? String(route.query.section || "daily")
    : "",
);

const ensureTokens = () => {
  if (hasAvailableTokens(tokenStore)) return true;
  message.warning("请先在 Token 页面导入游戏 Token");
  return false;
};

const toggleGameMenu = () => {
  if (!ensureTokens()) return;
  showGameMenu.value = !showGameMenu.value;
};

const openGameSection = (section) => {
  if (!ensureTokens()) return;
  showGameMenu.value = false;
  router.push({ path: "/admin/game-features", query: { section } });
};

const openProtectedRoute = (path) => {
  if (!ensureTokens()) return;
  showGameMenu.value = false;
  router.push(path);
};

watch(
  () => route.fullPath,
  () => {
    showGameMenu.value = false;
  },
);
</script>

<style scoped lang="scss">
.mobile-navigation {
  display: none;
}

@media (max-width: 768px) {
  .mobile-navigation {
    display: block;
  }

  .mobile-navigation__backdrop {
    position: fixed;
    inset: 0;
    z-index: 4990;
    width: 100%;
    border: 0;
    background: rgba(15, 23, 42, 0.28);
    backdrop-filter: blur(2px);
  }

  .mobile-bottom-nav {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 5000;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    width: 100vw;
    max-width: 100%;
    min-height: calc(62px + env(safe-area-inset-bottom));
    padding: 6px 10px max(6px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--border-light);
    background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
    box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.1);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .mobile-bottom-item {
    min-width: 0;
    min-height: 50px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 4px 2px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--text-secondary);
    text-decoration: none;
    font: inherit;
    font-size: 11px;
    line-height: 1.15;
    -webkit-tap-highlight-color: transparent;

    .n-icon {
      font-size: 23px;
    }

    &.router-link-active,
    &.active {
      background: var(--primary-color-light);
      color: var(--primary-color);
    }
  }

  .mobile-bottom-item--button,
  .mobile-game-item {
    cursor: pointer;
  }

  .mobile-game-panel {
    position: fixed;
    right: 12px;
    bottom: calc(74px + env(safe-area-inset-bottom));
    left: 12px;
    z-index: 4995;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border-light);
    border-radius: 18px;
    background: var(--bg-primary);
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
  }

  .mobile-game-item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 48px;
    padding: 10px 12px;
    border: 0;
    border-radius: 12px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font: inherit;
    text-align: left;

    .n-icon {
      flex: 0 0 auto;
      font-size: 21px;
    }

    &.active {
      background: var(--primary-color-light);
      color: var(--primary-color);
    }
  }

  .mobile-game-menu-enter-active,
  .mobile-game-menu-leave-active {
    transition: opacity 0.18s ease, transform 0.18s ease;
  }

  .mobile-game-menu-enter-from,
  .mobile-game-menu-leave-to {
    opacity: 0;
    transform: translateY(12px);
  }
}
</style>
