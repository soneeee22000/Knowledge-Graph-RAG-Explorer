<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useChatStore } from '@/stores/chat';
import AgentThoughtTimeline from '@/components/AgentThoughtTimeline.vue';
import AnswerCard from '@/components/AnswerCard.vue';

const chat = useChatStore();
const { messages, topK, useGraphExpansion, running, isEmpty } = storeToRefs(chat);

const question = ref('');
const scrollRegion = ref<HTMLElement | null>(null);

const canAsk = computed(() => !running.value && question.value.trim().length > 0);

const suggestions = [
  'What is Mistral AI and who founded it?',
  'How does the EU AI Act classify risk?',
  'How do knowledge graphs improve RAG?',
];

async function submit(): Promise<void> {
  if (!canAsk.value) return;
  const q = question.value;
  question.value = '';
  await chat.ask(q);
}

function onKeydown(e: KeyboardEvent): void {
  // Enter submits; Shift+Enter inserts a newline.
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void submit();
  }
}

function useSuggestion(text: string): void {
  question.value = text;
  void submit();
}

// Keep the transcript pinned to the latest content while streaming.
watch(
  () => messages.value.map((m) => m.text.length + m.thoughts.length).join(','),
  async () => {
    await nextTick();
    const el = scrollRegion.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <aside
    class="flex h-full flex-col overflow-hidden rounded-2xl border border-[#232838] bg-[#0c0e16]/60"
  >
    <header class="flex items-center justify-between border-b border-[#232838] px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold tracking-wide text-slate-200">Ask the graph</h2>
        <p class="text-xs text-slate-500">Agentic graph-RAG over your corpus</p>
      </div>
      <span v-if="running" class="flex items-center gap-1.5 text-[11px] text-indigo-300">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
        thinking
      </span>
    </header>

    <!-- Transcript -->
    <div ref="scrollRegion" class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      <div
        v-if="isEmpty"
        class="flex h-full flex-col items-center justify-center gap-4 text-center"
      >
        <div
          class="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2a3040] bg-[#11131c] text-xl text-cyan-400"
        >
          ✶
        </div>
        <div>
          <p class="text-sm font-medium text-slate-300">Ask a question to begin</p>
          <p class="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
            The agent will plan, retrieve grounded chunks, expand along graph relations, and
            synthesize a cited answer — live.
          </p>
        </div>
        <div class="flex flex-col gap-1.5">
          <button
            v-for="s in suggestions"
            :key="s"
            type="button"
            class="rounded-lg border border-[#232838] bg-[#11131c] px-3 py-1.5 text-xs text-slate-400 transition hover:border-indigo-500/50 hover:text-slate-200"
            @click="useSuggestion(s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <template v-else>
        <div v-for="msg in messages" :key="msg.id">
          <!-- User turn -->
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <p
              class="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600/90 px-3.5 py-2 text-sm text-white shadow-lg shadow-indigo-900/30"
            >
              {{ msg.text }}
            </p>
          </div>

          <!-- Assistant turn -->
          <div v-else class="space-y-3">
            <AgentThoughtTimeline :steps="msg.thoughts" :active="msg.streaming" />
            <AnswerCard
              :text="msg.text"
              :citations="msg.citations"
              :used-entity-ids="msg.usedEntityIds"
              :streaming="msg.streaming"
              :error="msg.error"
            />
          </div>
        </div>
      </template>
    </div>

    <!-- Composer -->
    <div class="border-t border-[#232838] p-3">
      <!-- Knobs -->
      <div class="mb-2 flex items-center gap-4 px-1">
        <label class="flex items-center gap-2 text-[11px] text-slate-500">
          <span>top-K</span>
          <input
            v-model.number="topK"
            type="range"
            min="1"
            max="20"
            step="1"
            class="accent-indigo-500"
          />
          <span class="w-5 tabular-nums text-slate-400">{{ topK }}</span>
        </label>
        <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500">
          <input v-model="useGraphExpansion" type="checkbox" class="accent-indigo-500" />
          graph expansion
        </label>
      </div>

      <div class="relative">
        <textarea
          v-model="question"
          rows="2"
          placeholder="Ask anything about your corpus…  (Enter to send)"
          :disabled="running"
          class="w-full resize-none rounded-xl border border-[#2a3040] bg-[#11131c] py-2.5 pl-3.5 pr-12 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-500/70 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
          @keydown="onKeydown"
        />
        <button
          type="button"
          :disabled="!canAsk"
          class="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Send question"
          @click="submit"
        >
          <span
            v-if="running"
            class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
          <span v-else>↑</span>
        </button>
      </div>
    </div>
  </aside>
</template>
