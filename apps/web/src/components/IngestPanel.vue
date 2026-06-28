<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { IngestPhase } from '@kg/shared';
import { useCorpusStore } from '@/stores/corpus';
import { SAMPLE_PASSAGE, SAMPLE_TITLE } from '@/lib/sampleCorpus';

const corpus = useCorpusStore();
const { documents, ingesting, progress, error, lastResult, phases, activePhaseIndex } =
  storeToRefs(corpus);

const title = ref('');
const content = ref('');
const confirmingReset = ref(false);

const charCount = computed(() => content.value.length);
const canIngest = computed(() => !ingesting.value && content.value.trim().length > 0);

const PHASE_LABELS: Record<IngestPhase, string> = {
  chunking: 'Chunking',
  embedding: 'Embedding',
  extracting: 'Extracting',
  linking: 'Linking',
  persisting: 'Persisting',
};

function loadSample(): void {
  title.value = SAMPLE_TITLE;
  content.value = SAMPLE_PASSAGE;
}

async function onIngest(): Promise<void> {
  await corpus.ingest(content.value, title.value);
}

async function onReset(): Promise<void> {
  if (!confirmingReset.value) {
    confirmingReset.value = true;
    window.setTimeout(() => (confirmingReset.value = false), 3000);
    return;
  }
  confirmingReset.value = false;
  await corpus.reset();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
</script>

<template>
  <aside
    class="flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-[#232838] bg-[#0c0e16]/60 p-4"
  >
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-semibold tracking-wide text-slate-200">Corpus</h2>
      <span class="text-xs text-slate-500">{{ documents.length }} docs</span>
    </header>

    <!-- Composer -->
    <div class="flex flex-col gap-2">
      <input
        v-model="title"
        type="text"
        placeholder="Document title"
        :disabled="ingesting"
        class="w-full rounded-lg border border-[#2a3040] bg-[#11131c] px-3 py-2 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-500/70 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
      />
      <div class="relative">
        <textarea
          v-model="content"
          rows="7"
          placeholder="Paste a passage to ingest into the knowledge graph…"
          :disabled="ingesting"
          class="w-full resize-none rounded-lg border border-[#2a3040] bg-[#11131c] px-3 py-2 text-sm leading-relaxed text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-500/70 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
        />
        <span class="absolute bottom-2 right-2 text-[10px] text-slate-600">
          {{ charCount.toLocaleString() }} chars
        </span>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          :disabled="!canIngest"
          class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          @click="onIngest"
        >
          <span
            v-if="ingesting"
            class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
          {{ ingesting ? 'Ingesting…' : 'Ingest' }}
        </button>
        <button
          type="button"
          :disabled="ingesting"
          class="rounded-lg border border-[#2a3040] bg-[#161924] px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-indigo-500/60 hover:text-white disabled:opacity-40"
          @click="loadSample"
        >
          Load sample
        </button>
      </div>
    </div>

    <!-- Live progress -->
    <Transition name="fade">
      <div v-if="progress" class="rounded-xl border border-[#232838] bg-[#11131c] p-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-slate-300">{{ progress.message }}</span>
          <span class="text-[10px] text-slate-500">{{ Math.round(progress.ratio * 100) }}%</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-[#1d2233]">
          <div
            class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-300"
            :style="{ width: `${Math.round(progress.ratio * 100)}%` }"
          />
        </div>
        <ol class="mt-2.5 flex justify-between">
          <li v-for="(phase, i) in phases" :key="phase" class="flex flex-col items-center gap-1">
            <span
              class="h-2 w-2 rounded-full transition-colors"
              :class="
                i < activePhaseIndex
                  ? 'bg-cyan-400'
                  : i === activePhaseIndex
                    ? 'bg-indigo-400 ring-2 ring-indigo-400/30'
                    : 'bg-[#2a3040]'
              "
            />
            <span
              class="text-[8px] uppercase tracking-wide"
              :class="i <= activePhaseIndex ? 'text-slate-400' : 'text-slate-600'"
              >{{ PHASE_LABELS[phase] }}</span
            >
          </li>
        </ol>
      </div>
    </Transition>

    <Transition name="fade">
      <p
        v-if="lastResult"
        class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
      >
        ✓ Extracted {{ lastResult.entityCount }} entities and
        {{ lastResult.relationCount }} relations from {{ lastResult.chunkCount }} chunks.
      </p>
    </Transition>

    <Transition name="fade">
      <p
        v-if="error"
        class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
      >
        {{ error }}
      </p>
    </Transition>

    <!-- Document list -->
    <div class="flex min-h-0 flex-1 flex-col">
      <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Ingested documents
      </h3>
      <div
        v-if="documents.length === 0"
        class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[#232838] text-center text-xs text-slate-600"
      >
        No documents yet
      </div>
      <ul v-else class="flex-1 space-y-1.5 overflow-y-auto pr-1">
        <li
          v-for="doc in documents"
          :key="doc.id"
          class="rounded-lg border border-[#232838] bg-[#11131c] px-3 py-2 transition hover:border-[#2f364a]"
        >
          <p class="truncate text-sm font-medium text-slate-200" :title="doc.title">
            {{ doc.title }}
          </p>
          <p class="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
            <span>{{ doc.chunkCount }} chunks</span>
            <span>·</span>
            <span>{{ doc.source }}</span>
            <span>·</span>
            <span>{{ formatDate(doc.createdAt) }}</span>
          </p>
        </li>
      </ul>
    </div>

    <button
      type="button"
      :disabled="ingesting || documents.length === 0"
      class="rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
      :class="
        confirmingReset
          ? 'border-red-500/60 bg-red-500/15 text-red-300'
          : 'border-[#2a3040] bg-[#161924] text-slate-400 hover:border-red-500/40 hover:text-red-300'
      "
      @click="onReset"
    >
      {{ confirmingReset ? 'Click again to confirm reset' : 'Reset corpus' }}
    </button>
  </aside>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
