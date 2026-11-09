<script setup lang="ts">
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  zhCN,
  dateZhCN,
  type GlobalThemeOverrides,
} from "naive-ui";
import AppShell from "./components/AppShell.vue";

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#456b91",
    primaryColorHover: "#567da4",
    primaryColorPressed: "#365878",
    primaryColorSuppl: "#456b91",
    borderRadius: "5px",
    bodyColor: "#f3f5f7",
    cardColor: "#ffffff",
    modalColor: "#ffffff",
    popoverColor: "#ffffff",
    tableColor: "#ffffff",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  },
  Card: { color: "#ffffff", borderColor: "#e2e6eb" },
  DataTable: {
    thColor: "#f6f7f9",
    tdColor: "#ffffff",
    tdColorHover: "#f7f9fb",
    borderColor: "#e2e6eb",
  },
};
</script>

<template>
  <n-config-provider
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    class="app-root"
  >
    <n-message-provider>
      <n-dialog-provider>
        <AppShell />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
.app-root {
  height: 100%;
}
</style>
