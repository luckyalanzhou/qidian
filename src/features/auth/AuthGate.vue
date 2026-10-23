<script setup lang="ts">
import { computed } from 'vue';
import { createAuthenticationFlow, type AuthenticationFlowDependencies, type AuthenticationRecovery } from './authentication-flow';
import type { AuthConfig } from '../../api/contracts';

const props = defineProps<AuthenticationFlowDependencies>();
const flow = createAuthenticationFlow(props);
const state = flow.state;

const registering = computed(() => state.mode === 'register');
const title = computed(() => state.recovery
  ? '登录状态已失效'
  : registering.value
    ? (state.setupRequired ? '创建管理员账号' : '创建个人账号')
    : '进入你的知识库');
const intro = computed(() => state.recovery
  ? '请重新登录；当前修改保留在此页面，登录后会继续同步。'
  : registering.value
    ? (state.setupRequired ? '首次使用请设置管理员账号和密码。账号名称可以修改。' : '填写账号和密码。')
    : '使用账号和密码登录。');

function show(sessionConfig: AuthConfig | null = null, recovery: AuthenticationRecovery | null = null) {
  return flow.show(sessionConfig, recovery);
}

function showStartupError(error: unknown) {
  flow.showStartupError(error);
}

function reload() {
  globalThis.location.reload();
}

defineExpose({ show, showStartupError });
</script>

<template>
  <div v-if="state.startupError" class="auth-card">
    <h1>暂时无法连接</h1>
    <p class="auth-intro">{{ state.startupError }}</p>
    <button class="primary-btn auth-submit" type="button" @click="reload">重试</button>
  </div>

  <div v-else-if="state.visible" class="auth-card" :class="{ registering }">
    <div class="auth-brand"><div class="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-book" /></svg></div><div><strong>栖点</strong></div></div>
    <h1 id="authTitle">{{ title }}</h1>
    <p class="auth-intro">{{ intro }}</p>
    <form id="authForm" novalidate @submit.prevent="flow.submit">
      <label class="auth-label" for="authUsername">账号</label>
      <input
        id="authUsername"
        v-model="state.username"
        name="username"
        class="auth-input"
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        minlength="3"
        maxlength="32"
        required
        placeholder="输入账号"
      >
      <label class="auth-label" for="authPassword">密码</label>
      <input
        id="authPassword"
        v-model="state.password"
        class="auth-input"
        type="password"
        :autocomplete="registering ? 'new-password' : 'current-password'"
        :minlength="registering ? 8 : 1"
        maxlength="128"
        required
        :placeholder="registering ? '至少 8 个字符' : '请输入密码'"
      >
      <p id="authPasswordHint" class="auth-password-hint" :hidden="!registering">至少 8 位，大小写字母、数字、符号任选两类。</p>
      <div id="authConfirmWrap" v-if="registering">
        <label class="auth-label" for="authPasswordConfirm">再次输入密码</label>
        <input
          id="authPasswordConfirm"
          v-model="state.passwordConfirmation"
          class="auth-input"
          type="password"
          autocomplete="new-password"
          minlength="8"
          maxlength="128"
          required
          placeholder="确认密码"
        >
      </div>
      <button id="authSubmit" class="primary-btn auth-submit" type="submit" :disabled="state.loading" :aria-busy="state.loading ? 'true' : undefined">
        {{ registering ? (state.setupRequired ? '创建管理员' : '创建账号') : '登录' }}
      </button>
      <p id="authMessage" class="auth-message" :class="{ success: state.succeeded }" role="status" aria-live="polite">{{ state.message }}</p>
    </form>
    <div id="authLinks" class="auth-links" aria-label="账号操作" :hidden="Boolean(state.recovery) || (!state.registrationEnabled && !registering)">
      <button id="authRegister" class="auth-text-button" type="button" :hidden="registering || !state.registrationEnabled" @click="flow.setMode('register')">注册账号</button>
      <button id="authReturnLogin" class="auth-text-button" type="button" :hidden="!registering || state.setupRequired" @click="flow.setMode('login')">已有账号？返回登录</button>
    </div>
    <p class="auth-footnote">请妥善保存账号和密码。</p>
  </div>
</template>
