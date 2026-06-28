<script setup lang="ts">
import { computed } from 'vue';
import type { ThoughtPhase, ThoughtStep } from '@kg/shared';

const props = defineProps<{
  steps: ThoughtStep[];
  /** When true, the most recent running step shows an active connector. */
  active?: boolean;
}>();

const PHASE_META: Record<ThoughtPhase, { icon: string; label: string }> = {
  plan: { icon: '◇', label: 'Plan' },
  retrieve: { icon: '⌕', label: 'Retrieve' },
  'graph-expand': { icon: '⌗', label: 'Graph expand' },
  rerank: { icon: '⇅', label: 'Rerank' },
  synthesize: { icon: '✶', label: 'Synthesize' },
};

const ordered = computed(() => props.steps);

function meta(phase: ThoughtPhase) {
  return PHASE_META[phase] ?? { icon: '•', label: phase };
}

function durationLabel(step: ThoughtStep): string {
  if (step.durationMs === undefined) return '';
  if (step.durationMs < 1000) return `${step.durationMs}ms`;
  return `${(step.durationMs / 1000).toFixed(1)}s`;
}
</script>

<template>
  <div class="agent-timeline">
    <h3
      class="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
    >
      <span
        v-if="active"
        class="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400"
      />
      Agent thought process
    </h3>

    <div
      v-if="ordered.length === 0"
      class="rounded-lg border border-dashed border-[#232838] px-3 py-6 text-center text-xs text-slate-600"
    >
      The agent's reasoning will stream here as it plans, retrieves, expands the
      graph, and synthesizes an answer.
    </div>

    <TransitionGroup
      v-else
      tag="ol"
      name="step"
      class="relative space-y-3 pl-1"
    >
      <li
        v-for="(step, i) in ordered"
        :key="step.id"
        class="relative flex gap-3"
      >
        <!-- Connector line + node -->
        <div class="relative flex flex-col items-center">
          <span
            class="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs transition-colors"
            :class="{
              'border-indigo-500/60 bg-indigo-500/15 text-indigo-300':
                step.status === 'running',
              'border-emerald-500/50 bg-emerald-500/15 text-emerald-300':
                step.status === 'done',
              'border-red-500/50 bg-red-500/15 text-red-300':
                step.status === 'error',
            }"
          >
            <span
              v-if="step.status === 'running'"
              class="h-3 w-3 animate-spin rounded-full border-2 border-indigo-400/40 border-t-indigo-300"
            />
            <span v-else-if="step.status === 'done'">✓</span>
            <span v-else-if="step.status === 'error'">!</span>
          </span>
          <span
            v-if="i < ordered.length - 1"
            class="absolute top-7 h-[calc(100%+0.75rem)] w-px bg-gradient-to-b from-[#2a3040] to-transparent"
          />
        </div>

        <!-- Content -->
        <div class="flex-1 pb-1">
          <div class="flex items-center gap-2">
            <span class="text-xs" aria-hidden="true">{{
              meta(step.phase).icon
            }}</span>
            <span class="text-sm font-medium text-slate-200">{{
              step.title
            }}</span>
            <span
              v-if="durationLabel(step)"
              class="ml-auto text-[10px] tabular-nums text-slate-600"
              >{{ durationLabel(step) }}</span
            >
          </div>
          <p
            v-if="step.detail"
            class="mt-0.5 text-xs leading-relaxed text-slate-500"
          >
            {{ step.detail }}
          </p>
          <span
            class="mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-600"
          >
            {{ meta(step.phase).label }}
          </span>
        </div>
      </li>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.step-enter-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}
.step-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.step-move {
  transition: transform 0.35s ease;
}
</style>
