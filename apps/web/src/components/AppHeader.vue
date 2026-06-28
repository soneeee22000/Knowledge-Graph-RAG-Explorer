<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { HealthResponse } from '@kg/shared';
import { getHealth } from '@/lib/apiClient';

type HealthState = 'checking' | 'online' | 'offline';

const state = ref<HealthState>('checking');
const health = ref<HealthResponse | null>(null);

async function check(): Promise<void> {
  state.value = 'checking';
  try {
    health.value = await getHealth();
    state.value = 'online';
  } catch {
    health.value = null;
    state.value = 'offline';
  }
}

onMounted(check);
</script>

<template>
  <header
    class="flex items-center justify-between rounded-2xl border border-[#232838] bg-[#0c0e16]/70 px-5 py-3 backdrop-blur"
  >
    <div class="flex items-center gap-3">
      <div
        class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-lg font-bold text-white shadow-lg shadow-indigo-900/40"
      >
        ◍
      </div>
      <div>
        <h1 class="text-sm font-semibold tracking-tight text-slate-100">
          Knowledge-Graph RAG Explorer
        </h1>
        <p class="text-[11px] text-slate-500">
          Agentic retrieval over an interactive knowledge graph
        </p>
      </div>
    </div>

    <button
      type="button"
      class="group flex items-center gap-3 rounded-xl border border-[#232838] bg-[#11131c] px-3.5 py-2 transition hover:border-[#2f364a]"
      title="Click to re-check backend health"
      @click="check"
    >
      <span class="relative flex h-2.5 w-2.5">
        <span
          v-if="state === 'online'"
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"
        />
        <span
          class="relative inline-flex h-2.5 w-2.5 rounded-full"
          :class="{
            'bg-emerald-400': state === 'online',
            'bg-amber-400': state === 'checking',
            'bg-red-500': state === 'offline',
          }"
        />
      </span>

      <div class="text-left leading-tight">
        <p
          class="text-xs font-medium"
          :class="{
            'text-emerald-300': state === 'online',
            'text-amber-300': state === 'checking',
            'text-red-300': state === 'offline',
          }"
        >
          <template v-if="state === 'online'">Online</template>
          <template v-else-if="state === 'checking'">Checking…</template>
          <template v-else>Backend offline</template>
        </p>
        <p v-if="health" class="text-[10px] text-slate-500">
          {{ health.llmProvider }} · {{ health.documentCount }} docs ·
          {{ health.entityCount }} entities
        </p>
        <p v-else-if="state === 'offline'" class="text-[10px] text-slate-600">retry</p>
      </div>
    </button>
  </header>
</template>
