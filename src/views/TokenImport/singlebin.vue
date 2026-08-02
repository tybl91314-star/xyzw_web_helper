<template>
  <!-- 手动输入表单 -->
  <n-form :model="importForm" :label-placement="'top'" :size="'large'" :show-label="true">
    <n-form-item :label="'游戏角色名称'" :show-label="true">
      <n-input v-model:value="importForm.name" placeholder="例如：主号战士" clearable />
    </n-form-item>

    <n-form-item :label="'BIN文件'" :show-label="true">
      <div class="bin-picker">
        <input
          ref="fileInputRef"
          class="native-file-input"
          type="file"
          accept=".bin,.dmp"
          multiple
          @change="handleFileSelection"
        />
        <input
          ref="folderInputRef"
          class="native-file-input"
          type="file"
          accept=".bin,.dmp"
          multiple
          webkitdirectory
          directory
          @change="handleFileSelection"
        />

        <div class="picker-actions">
          <n-button
            type="primary"
            size="large"
            :loading="isReadingFiles"
            @click="fileInputRef?.click()"
          >
            选择BIN文件
          </n-button>
          <n-button
            size="large"
            :disabled="isReadingFiles"
            @click="chooseBinFolder"
          >
            选择文件夹
          </n-button>
        </div>
        <div class="picker-tip">
          可一次选择多个BIN文件；选择文件夹时会自动读取其全部子文件夹中的BIN文件。
        </div>
      </div>
    </n-form-item>
    <a-list>
      <a-list-item v-for="(role, index) in roleList" :key="index">
        <div>
          <strong>角色名称:</strong> {{ role.name || "未命名角色" }}<br />
          <strong>Token:</strong>
          <span style="word-break: break-all">{{ role.token }}</span><br />
          <strong>服务器:</strong> {{ role.server || "未指定" }}
        </div>
      </a-list-item>
    </a-list>

    <!-- 角色详情 -->
    <n-collapse>
      <n-collapse-item title="角色详情 (可选)" name="optional">
        <div class="optional-fields">
          <n-form-item label="服务器">
            <n-input v-model:value="importForm.server" placeholder="服务器名称" />
          </n-form-item>

          <n-form-item label="自定义连接地址">
            <n-input v-model:value="importForm.wsUrl" placeholder="留空使用默认连接" />
          </n-form-item>
        </div>
      </n-collapse-item>
    </n-collapse>

    <div class="form-actions">
      <n-button type="primary" size="large" block :loading="isImporting" @click="handleImport">
        <template #icon>
          <n-icon>
            <CloudUpload />
          </n-icon>
        </template>
        添加Token
      </n-button>

      <n-button v-if="tokenStore.hasTokens" size="large" block @click="cancel">
        取消
      </n-button>
    </div>
  </n-form>
</template>

<script lang="ts" setup>
import { ref, reactive } from "vue";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { useTokenStore } from "@/stores/tokenStore";
import { CloudUpload } from "@vicons/ionicons5";

import {
  NForm,
  NFormItem,
  NInput,
  NButton,
  NIcon,
  NCollapse,
  NCollapseItem,
  useMessage,
} from "naive-ui";

import PQueue from "p-queue";
import useIndexedDB from "@/hooks/useIndexedDB";
import { getTokenId, transformToken } from "@/utils/token";
import { getNearestParentFolderName } from "@/utils/tokenFolderGroup.js";

const $emit = defineEmits(["cancel", "ok"]);

const { storeArrayBuffer } = useIndexedDB();

const cancel = () => {
  roleList.value = [];
  $emit("cancel");
};

const tokenStore = useTokenStore();
const message = useMessage();
const isImporting = ref(false);
const isReadingFiles = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const folderInputRef = ref<HTMLInputElement | null>(null);
const BinFolderPicker = registerPlugin<{
  pickBinFolder: () => Promise<{
    files: Array<{ name: string; relativePath: string; data: string }>;
  }>;
}>("BinFolderPicker");
const importForm = reactive({
  name: "",
  server: "",
  wsUrl: "",
  importMethod: "",
});
const roleList = ref<
  Array<{
    id: string;
    name: string;
    token: string;
    server: string;
    wsUrl: string;
    importMethod: string;
    groupName?: string;
  }>
>([]);

const fileGroupNames = new WeakMap<File, string>();

const tQueue = new PQueue({ concurrency: 1, interval: 1000 });

const initName = (fileName: string) => {
  if (!fileName) return;
  fileName = fileName.trim();
  let binRes = fileName.match(/^bin-(.*?)服-([0-2])-([0-9]{6,12})-(.*)\.bin$/);
  console.log(binRes);
  if (binRes) {
    importForm.name = `${binRes[1]}_${binRes[2]}_${binRes[4]}`;
    return {
      server: binRes[1],
      roleIndex: binRes[2],
      roleId: binRes[3],
      roleName: binRes[4],
    };
  }
  return {
    server: "",
    roleIndex: "",
    roleId: "",
    roleName: importForm.name || "",
  };
};

const processBinFile = async (binFile: File) => {
    console.log("上传文件数据:", binFile);
    const roleMeta = initName(binFile.name) as any;
    const userToken = await binFile.arrayBuffer();
      // console.log('转换Token:', userToken);
      const tokenId = getTokenId(userToken);
      const roleToken = await transformToken(userToken);
      const roleName = roleMeta.roleName || binFile.name.split(".")?.[0] || "";
      // 刷新indexDB数据库token数据
      const saved = await storeArrayBuffer(tokenId, userToken);
      if (!saved) {
        throw new Error("保存BIN数据到IndexedDB失败");
      }
      
      // 上传列表中发现已存在的重复名称，提示消息
      if (roleList.value.some((role) => role.id === tokenId)) {
        return false;
      }
      // 检查待上传的角色是否已在tokenStore中存在
      const existingToken = tokenStore.gameTokens.find(
        (t) => t.id === tokenId,
      );
      if (existingToken) {
        message.warning(`角色"${roleName}"已存在，将更新该角色的Token`);
      }
      roleList.value.push({
        id: tokenId,
        token: roleToken,
        name: roleName,
        server: roleMeta.server + "" + roleMeta.roleIndex || "",
        wsUrl: importForm.wsUrl || "",
        importMethod: "bin",
        groupName: fileGroupNames.get(binFile) || "",
      });
      return true;
};

const processSelectedFiles = async (selectedFiles: File[]) => {
  const binFiles = selectedFiles.filter((file) =>
    /\.(bin|dmp)$/i.test(file.name),
  );
  if (binFiles.length === 0) {
    message.warning("没有找到BIN文件");
    return;
  }

  isReadingFiles.value = true;
  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  try {
    for (const file of binFiles) {
      try {
        const imported = await tQueue.add(() => processBinFile(file));
        imported ? importedCount++ : skippedCount++;
      } catch (error) {
        failedCount++;
        console.error(`读取BIN文件失败: ${file.name}`, error);
      }
    }

    if (importedCount > 0) {
      message.success(`成功读取 ${importedCount} 个BIN文件，请确认后添加Token`);
    }
    if (skippedCount > 0) {
      message.warning(`已跳过 ${skippedCount} 个重复角色`);
    }
    if (failedCount > 0) {
      message.error(`${failedCount} 个BIN文件读取失败`);
    }
  } finally {
    isReadingFiles.value = false;
  }
};

const handleFileSelection = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const selectedFiles = Array.from(input.files || []);
  input.value = "";
  selectedFiles.forEach((file) => {
    const groupName = getNearestParentFolderName(file.webkitRelativePath || "");
    if (groupName) fileGroupNames.set(file, groupName);
  });
  await processSelectedFiles(selectedFiles);
};

const decodeBase64File = (name: string, base64Data: string) => {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type: "application/octet-stream" });
};

const chooseBinFolder = async () => {
  if (Capacitor.getPlatform() !== "android") {
    folderInputRef.value?.click();
    return;
  }

  isReadingFiles.value = true;
  try {
    const result = await BinFolderPicker.pickBinFolder();
    const files = (result.files || []).map((entry) => {
      const file = decodeBase64File(entry.name, entry.data);
      const groupName = getNearestParentFolderName(entry.relativePath || "");
      if (groupName) fileGroupNames.set(file, groupName);
      return file;
    });
    if (files.length === 0) {
      message.warning("所选文件夹及其子文件夹中没有BIN文件");
      return;
    }
    await processSelectedFiles(files);
  } catch (error: any) {
    console.error("选择BIN文件夹失败", error);
    message.error(error?.message || "选择文件夹失败");
  } finally {
    isReadingFiles.value = false;
  }
};

const handleImport = async () => {
  if (roleList.value.length === 0) {
    message.error("请先上传bin文件！");
    return;
  }
  roleList.value.forEach((role) => {
    // tokenStore.gameTokens中发现已存在的重复名称，则移出token后重新添加
    const gameToken = tokenStore.gameTokens.find((t) => t.id === role.id);
    if (gameToken) {
      console.log("移除同名token:", gameToken);
      // tokenStore.removeToken(gameToken.id);
      tokenStore.updateToken(gameToken.id, {
        ...role,
      });
    } else {
      tokenStore.addToken({
        ...role,
      });
    }

    if (role.groupName) {
      const normalizedName = role.groupName.trim();
      let group = tokenStore.tokenGroups.find(
        (item) => item.name.trim().toLowerCase() === normalizedName.toLowerCase(),
      );
      if (!group) {
        const colors = ["#1677ff", "#52c41a", "#faad14", "#722ed1", "#13c2c2"];
        group = tokenStore.createTokenGroup(
          normalizedName,
          colors[tokenStore.tokenGroups.length % colors.length],
        );
      }
      tokenStore.addTokenToGroup(group.id, role.id);
    }
  });
  console.log("当前Token列表:", tokenStore.gameTokens);
  message.success("Token添加成功");
  roleList.value = [];
  $emit("ok");
};
</script>

<style scoped lang="scss">
.optional-fields {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;

  n-form-item {
    flex: 1;
    min-width: 200px;
  }
}

.form-actions {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bin-picker {
  width: 100%;
  padding: 16px;
  border: 1px dashed var(--border-color, #d9d9d9);
  border-radius: 8px;
  background: var(--bg-tertiary, #fafafa);
}

.native-file-input {
  display: none;
}

.picker-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.picker-tip {
  margin-top: 10px;
  color: var(--text-secondary, #666);
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 480px) {
  .picker-actions {
    grid-template-columns: 1fr;
  }
}

.dropzone-content {
  width: 100%;
  border: 1px dashed #fcc;
  border-radius: 8px;
  text-align: center;
  color: #888;
  padding: 40px 20px;
  font-size: 12px;
}
</style>
