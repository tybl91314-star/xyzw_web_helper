<template>
  <n-modal
    :show="show"
    preset="card"
    title="分组管理"
    class="token-group-manager-modal"
    @update:show="emit('update:show', $event)"
  >
    <div class="manager-heading">
      <span class="manager-hint">选择分组后可查看和维护成员</span>
      <div class="manager-actions">
        <n-button size="small" type="primary" @click="openCreateModal">
          增加分组
        </n-button>
        <n-button
          size="small"
          :disabled="!activeGroup"
          @click="openEditModal"
        >编辑</n-button>
        <n-button
          size="small"
          type="error"
          ghost
          :disabled="!activeGroup"
          @click="deleteActiveGroup"
        >删除</n-button>
      </div>
    </div>

    <div class="group-tabs" role="tablist" aria-label="分组管理">
      <button
        v-for="tab in groupTabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="group-tab"
        :class="{ active: activeGroupId === tab.id }"
        :aria-selected="activeGroupId === tab.id"
        @click="activeGroupId = tab.id"
      >
        <span
          v-if="tab.color"
          class="group-dot"
          :style="{ backgroundColor: tab.color }"
        />
        {{ tab.name }}
        <span class="group-count">{{ tab.count }}</span>
      </button>
    </div>

    <section class="current-group-panel">
      <div class="current-group-toolbar">
        <strong>{{ activeGroup?.name || "未分组" }}</strong>
        <n-button
          v-if="activeGroup"
          size="small"
          type="info"
          @click="openAddMembersModal"
        >添加成员</n-button>
      </div>

      <n-empty
        v-if="tokensInActiveGroup.length === 0"
        :description="activeGroup ? '该分组暂无成员' : '暂无未分组账号'"
      />
      <div v-else class="member-grid">
        <div
          v-for="token in tokensInActiveGroup"
          :key="token.id"
          class="member-item"
        >
          <span>{{ token.name }}</span>
          <small v-if="token.server">{{ token.server }}</small>
          <n-button
            v-if="activeGroup"
            size="tiny"
            type="error"
            text
            @click="removeMember(token.id)"
          >移除</n-button>
        </div>
      </div>
    </section>

    <template #footer>
      <div class="modal-actions">
        <n-button @click="emit('update:show', false)">关闭</n-button>
      </div>
    </template>
  </n-modal>

  <n-modal
    v-model:show="showCreateModal"
    preset="card"
    title="增加分组"
    class="token-group-form-modal"
  >
    <group-form
      v-model:name="createForm.name"
      v-model:sort-order="createForm.sortOrder"
      v-model:color="createForm.color"
      :colors="groupColors"
      @submit="createGroup"
    />
    <template #footer>
      <div class="modal-actions">
        <n-button @click="showCreateModal = false">取消</n-button>
        <n-button type="primary" @click="createGroup">保存</n-button>
      </div>
    </template>
  </n-modal>

  <n-modal
    v-model:show="showEditModal"
    preset="card"
    title="编辑分组"
    class="token-group-form-modal"
  >
    <group-form
      v-model:name="editForm.name"
      v-model:sort-order="editForm.sortOrder"
      v-model:color="editForm.color"
      :colors="groupColors"
      @submit="saveGroup"
    />
    <template #footer>
      <div class="modal-actions">
        <n-button @click="showEditModal = false">取消</n-button>
        <n-button type="primary" @click="saveGroup">保存</n-button>
      </div>
    </template>
  </n-modal>

  <n-modal
    v-model:show="showAddMembersModal"
    preset="card"
    :title="`向“${activeGroup?.name || ''}”添加成员`"
    class="token-group-members-modal"
  >
    <n-empty
      v-if="ungroupedTokens.length === 0"
      description="暂无未分组账号"
    />
    <n-checkbox-group v-else v-model:value="selectedMemberIds">
      <div class="member-grid selectable">
        <n-checkbox
          v-for="token in ungroupedTokens"
          :key="token.id"
          :value="token.id"
        >
          <span>{{ token.name }}</span>
          <small v-if="token.server">{{ token.server }}</small>
        </n-checkbox>
      </div>
    </n-checkbox-group>
    <template #footer>
      <div class="modal-actions">
        <n-button @click="showAddMembersModal = false">取消</n-button>
        <n-button
          type="primary"
          :disabled="selectedMemberIds.length === 0"
          @click="addMembers"
        >确定添加（{{ selectedMemberIds.length }}）</n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { computed, defineComponent, h, reactive, ref, watch } from "vue";
import { NInput, NInputNumber, useDialog, useMessage } from "naive-ui";
import { useTokenStore } from "@/stores/tokenStore";

const props = defineProps({ show: Boolean });
const emit = defineEmits(["update:show"]);

const tokenStore = useTokenStore();
const message = useMessage();
const dialog = useDialog();
const UNGROUPED_ID = "__ungrouped__";
const groupColors = [
  "#1677ff",
  "#52c41a",
  "#faad14",
  "#f5222d",
  "#722ed1",
  "#13c2c2",
  "#eb2f96",
  "#fa8c16",
];

const GroupForm = defineComponent({
  name: "TokenGroupForm",
  props: {
    name: { type: String, default: "" },
    sortOrder: { type: Number, default: 1 },
    color: { type: String, default: "#1677ff" },
    colors: { type: Array, required: true },
  },
  emits: ["update:name", "update:sortOrder", "update:color", "submit"],
  setup(formProps, { emit: formEmit }) {
    return () =>
      h("div", { class: "group-form" }, [
        h("div", {
          class: "form-primary-row",
          style: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 76px",
            alignItems: "end",
            gap: "12px",
          },
        }, [
          h("label", { class: "form-field name-field" }, [
            h("span", "名称"),
            h(NInput, {
              value: formProps.name,
              maxlength: 30,
              placeholder: "输入分组名称",
              autofocus: true,
              "onUpdate:value": (value) => formEmit("update:name", value),
              onKeyup: (event) => {
                if (event.key === "Enter") formEmit("submit");
              },
            }),
          ]),
          h("label", { class: "form-field sort-field" }, [
            h("span", "排序"),
            h(NInputNumber, {
              value: formProps.sortOrder,
              min: 1,
              max: 999,
              precision: 0,
              showButton: false,
              placeholder: "1",
              style: { width: "76px" },
              "onUpdate:value": (value) => formEmit("update:sortOrder", value),
            }),
          ]),
        ]),
        h("div", { class: "form-field color-field" }, [
          h("span", "颜色"),
          h(
            "div",
            {
              class: "color-options",
              style: {
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "10px",
                minHeight: "40px",
              },
            },
            formProps.colors.map((color) =>
              h("button", {
                key: color,
                type: "button",
                class: ["color-option", { active: formProps.color === color }],
                style: {
                  display: "inline-block",
                  width: "36px",
                  height: "36px",
                  flex: "0 0 36px",
                  padding: "0",
                  background: color,
                  border:
                    formProps.color === color
                      ? "3px solid #111"
                      : "3px solid transparent",
                  borderRadius: "50%",
                  boxShadow: "0 0 0 2px #fff inset",
                },
                onClick: () => formEmit("update:color", color),
                "aria-label": `选择颜色 ${color}`,
              }),
            ),
          ),
        ]),
      ]);
  },
});

const activeGroupId = ref(UNGROUPED_ID);
const showCreateModal = ref(false);
const showEditModal = ref(false);
const showAddMembersModal = ref(false);
const selectedMemberIds = ref([]);
const createForm = reactive({ name: "", sortOrder: 1, color: groupColors[0] });
const editForm = reactive({ name: "", sortOrder: 1, color: groupColors[0] });

const validTokenIds = computed(() => new Set(tokenStore.gameTokens.map((token) => token.id)));
const groupedTokenIds = computed(() => {
  const ids = new Set();
  tokenStore.tokenGroups.forEach((group) => {
    group.tokenIds.forEach((id) => {
      if (validTokenIds.value.has(id)) ids.add(id);
    });
  });
  return ids;
});
const ungroupedTokens = computed(() =>
  tokenStore.gameTokens.filter((token) => !groupedTokenIds.value.has(token.id)),
);
const sortedGroups = computed(() =>
  tokenStore.tokenGroups
    .map((group, index) => ({
      group,
      index,
      sortOrder:
        Number.isInteger(group.sortOrder) && group.sortOrder >= 1
          ? group.sortOrder
          : index + 1,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
    .map((item) => item.group),
);
const groupTabs = computed(() => [
  { id: UNGROUPED_ID, name: "未分组", color: "", count: ungroupedTokens.value.length },
  ...sortedGroups.value.map((group) => ({
    id: group.id,
    name: group.name,
    color: group.color,
    count: group.tokenIds.filter((id) => validTokenIds.value.has(id)).length,
  })),
]);
const activeGroup = computed(() =>
  tokenStore.tokenGroups.find((group) => group.id === activeGroupId.value),
);
const tokensInActiveGroup = computed(() => {
  if (!activeGroup.value) return ungroupedTokens.value;
  const ids = new Set(activeGroup.value.tokenIds);
  return tokenStore.gameTokens.filter((token) => ids.has(token.id));
});

watch(
  () => tokenStore.tokenGroups.map((group) => group.id),
  (ids) => {
    if (activeGroupId.value !== UNGROUPED_ID && !ids.includes(activeGroupId.value)) {
      activeGroupId.value = UNGROUPED_ID;
    }
  },
);
watch(
  () => props.show,
  (isOpen) => {
    if (!isOpen) {
      showCreateModal.value = false;
      showEditModal.value = false;
      showAddMembersModal.value = false;
    }
  },
);

const normalizeSortOrder = (value) => Math.max(1, Math.trunc(Number(value) || 1));
const hasDuplicateName = (name, excludedId = "") =>
  tokenStore.tokenGroups.some(
    (group) =>
      group.id !== excludedId &&
      group.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

const openCreateModal = () => {
  createForm.name = "";
  createForm.sortOrder = tokenStore.tokenGroups.length + 1;
  createForm.color = groupColors[tokenStore.tokenGroups.length % groupColors.length];
  showCreateModal.value = true;
};
const createGroup = () => {
  const name = createForm.name.trim();
  if (!name) return message.warning("请输入分组名称");
  if (hasDuplicateName(name)) return message.warning("已存在同名分组");
  const group = tokenStore.createTokenGroup(
    name,
    createForm.color,
    normalizeSortOrder(createForm.sortOrder),
  );
  activeGroupId.value = group.id;
  showCreateModal.value = false;
  message.success("分组已创建");
};
const openEditModal = () => {
  if (!activeGroup.value) return;
  const index = tokenStore.tokenGroups.findIndex((group) => group.id === activeGroup.value.id);
  editForm.name = activeGroup.value.name;
  editForm.color = activeGroup.value.color || groupColors[0];
  editForm.sortOrder =
    Number.isInteger(activeGroup.value.sortOrder) && activeGroup.value.sortOrder >= 1
      ? activeGroup.value.sortOrder
      : index + 1;
  showEditModal.value = true;
};
const saveGroup = () => {
  if (!activeGroup.value) return;
  const name = editForm.name.trim();
  if (!name) return message.warning("请输入分组名称");
  if (hasDuplicateName(name, activeGroup.value.id)) return message.warning("已存在同名分组");
  tokenStore.updateTokenGroup(activeGroup.value.id, {
    name,
    color: editForm.color,
    sortOrder: normalizeSortOrder(editForm.sortOrder),
  });
  showEditModal.value = false;
  message.success("分组已更新");
};
const openAddMembersModal = () => {
  selectedMemberIds.value = [];
  showAddMembersModal.value = true;
};
const addMembers = () => {
  if (!activeGroup.value || selectedMemberIds.value.length === 0) return;
  selectedMemberIds.value.forEach((id) => tokenStore.addTokenToGroup(activeGroup.value.id, id));
  const count = selectedMemberIds.value.length;
  selectedMemberIds.value = [];
  showAddMembersModal.value = false;
  message.success(`已添加${count}个成员`);
};
const removeMember = (tokenId) => {
  if (!activeGroup.value) return;
  tokenStore.removeTokenFromGroup(activeGroup.value.id, tokenId);
  message.success("成员已移除");
};
const deleteActiveGroup = () => {
  if (!activeGroup.value) return;
  const group = activeGroup.value;
  dialog.warning({
    title: "删除分组",
    content: `确定删除“${group.name}”吗？分组中的 Token 不会被删除。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: () => {
      tokenStore.deleteTokenGroup(group.id);
      activeGroupId.value = UNGROUPED_ID;
      message.success("分组已删除");
    },
  });
};
</script>

<style scoped>
:global(.token-group-manager-modal.n-card) {
  width: min(760px, calc(100vw - 24px));
  max-height: calc(100dvh - var(--safe-area-top, 0px) - var(--mobile-bottom-nav-height, 0px) - 32px);
}
:global(.token-group-manager-modal .n-card__content) { overflow-y: auto; }
:global(.token-group-form-modal.n-card),
:global(.token-group-members-modal.n-card) {
  width: min(560px, calc(100vw - 24px));
  max-height: calc(100dvh - var(--safe-area-top, 0px) - var(--mobile-bottom-nav-height, 0px) - 32px);
}
:global(.token-group-members-modal .n-card__content) { overflow-y: auto; }
:global(.token-group-form-modal .n-card__content) { overflow-y: auto; }
.manager-heading,
.manager-actions,
.current-group-toolbar,
.modal-actions,
.color-options { display: flex; align-items: center; gap: 8px; }
.manager-heading { justify-content: space-between; margin-bottom: 12px; }
.manager-hint { color: var(--text-color-3); font-size: 13px; }
.group-tabs { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 0; border-block: 1px solid var(--border-color); }
.group-tab { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 6px 12px; color: var(--text-color-2); background: var(--card-color); border: 1px solid var(--border-color); border-radius: 12px; }
.group-tab.active { color: #18a058; border-color: #18a058; background: rgba(24, 160, 88, 0.08); }
.group-dot { width: 10px; height: 10px; border-radius: 50%; }
.group-count { min-width: 22px; padding: 1px 6px; color: var(--text-color-3); background: var(--action-color); border-radius: 999px; text-align: center; }
.current-group-panel { margin-top: 14px; }
.current-group-toolbar { justify-content: space-between; margin-bottom: 14px; }
.member-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.member-item { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 10px; border: 1px solid var(--border-color); border-radius: 10px; }
.member-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-item small { color: var(--text-color-3); white-space: nowrap; }
.member-item :deep(.n-button) { margin-left: auto; }
.selectable :deep(.n-checkbox) { min-width: 0; padding: 10px; border: 1px solid var(--border-color); border-radius: 10px; }
.selectable :deep(.n-checkbox__label) { display: flex; gap: 6px; min-width: 0; }
.selectable small { color: var(--text-color-3); }
.modal-actions { justify-content: flex-end; }
.group-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
.form-primary-row { display: grid; grid-template-columns: minmax(0, 1fr) 76px; align-items: end; gap: 12px; }
.form-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.form-field > span { color: var(--text-color-2); font-size: 13px; }
.sort-field :deep(.n-input-number) { width: 76px; max-width: 100%; }
.color-options { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-height: 40px; }
.color-option { width: 34px; height: 34px; border: 3px solid transparent; border-radius: 50%; }
.color-option.active { border-color: var(--text-color-1); box-shadow: 0 0 0 2px var(--card-color) inset; }
@media (max-width: 600px) {
  .manager-hint { display: none; }
  .manager-heading { justify-content: flex-end; }
  .manager-actions { width: 100%; }
  .manager-actions :deep(.n-button) { flex: 1; }
  .current-group-toolbar { align-items: center; }
  .member-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
