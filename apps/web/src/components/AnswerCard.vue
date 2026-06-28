<script setup lang="ts">
import { computed } from 'vue';
import type { Citation } from '@kg/shared';
import { useGraphStore } from '@/stores/graph';

const props = defineProps<{
  text: string;
  citations: Citation[];
  usedEntityIds: string[];
  streaming: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: 'highlight-entity', id: string): void;
}>();

const graphStore = useGraphStore();

const hasContent = computed(() => props.text.length > 0 || props.citations.length > 0);

/** Resolve an entity id to a human label if it's present in the graph. */
function entityLabel(id: string): string {
  return graphStore.graph.entities.find((e) => e.id === id)?.label ?? id;
}

function onEntityChip(id: string): void {
  graphStore.highlightOne(id);
  emit('highlight-entity', id);
}

function onCitation(citation: Citation): void {
  // Highlight any graph entities sourced from the same chunk.
  const ids = graphStore.graph.entities
    .filter((e) => e.sourceChunkIds.includes(citation.chunkId))
    .map((e) => e.id);
  if (ids.length > 0) graphStore.highlight(ids);
}
</script>

<template>
  <div
    v-if="hasContent || streaming || error"
    class="rounded-xl border border-[#232838] bg-[#11131c]/80 p-4"
  >
    <div
      class="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
    >
      <span class="text-cyan-400">✶</span> Answer
    </div>

    <p
      v-if="error"
      class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      {{ error }}
    </p>

    <p
      v-else
      class="whitespace-pre-wrap text-sm leading-relaxed text-slate-200"
      :class="{ 'typewriter-caret': streaming }"
    >
      {{ text }}
    </p>

    <!-- Used entities -->
    <div v-if="usedEntityIds.length > 0" class="mt-3">
      <p class="mb-1.5 text-[10px] uppercase tracking-wide text-slate-600">Entities traversed</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="id in usedEntityIds"
          :key="id"
          type="button"
          class="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] text-indigo-200 transition hover:border-indigo-400 hover:bg-indigo-500/20"
          @click="onEntityChip(id)"
        >
          {{ entityLabel(id) }}
        </button>
      </div>
    </div>

    <!-- Citations -->
    <div v-if="citations.length > 0" class="mt-3 border-t border-[#232838] pt-3">
      <p class="mb-1.5 text-[10px] uppercase tracking-wide text-slate-600">
        {{ citations.length }} source{{ citations.length === 1 ? '' : 's' }}
      </p>
      <ul class="space-y-1.5">
        <li
          v-for="(citation, i) in citations"
          :key="citation.chunkId + i"
          class="group cursor-pointer rounded-lg border border-[#232838] bg-[#0c0e16] px-3 py-2 transition hover:border-indigo-500/40"
          @click="onCitation(citation)"
        >
          <div class="flex items-center justify-between gap-2">
            <span
              class="truncate text-xs font-medium text-slate-300"
              :title="citation.documentTitle"
            >
              <span class="text-indigo-400">[{{ i + 1 }}]</span>
              {{ citation.documentTitle }}
            </span>
            <span class="shrink-0 text-[10px] tabular-nums text-slate-600">
              {{ Math.round(citation.score * 100) }}%
            </span>
          </div>
          <p
            v-if="citation.snippet"
            class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500"
          >
            {{ citation.snippet }}
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>
