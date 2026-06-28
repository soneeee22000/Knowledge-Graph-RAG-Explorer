<script setup lang="ts">
import { markRaw, nextTick, watch } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import type { NodeTypesObject } from '@vue-flow/core';
import { Background, BackgroundVariant } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { storeToRefs } from 'pinia';
import { useGraphStore } from '@/stores/graph';
import { visualFor } from '@/lib/entityVisuals';
import EntityNode from '@/components/EntityNode.vue';
import type { GraphNode } from '@/stores/graph';
import type { EntityType } from '@kg/shared';

const graphStore = useGraphStore();
const { nodes, edges, isEmpty, entityCount, relationCount, revision } =
  storeToRefs(graphStore);

const { fitView, onNodeClick, onPaneClick } = useVueFlow();

// Register the custom node type. markRaw avoids needless reactivity overhead.
// VueFlow's NodeTypesObject expects components shaped as NodeComponent; a custom
// SFC with its own props doesn't structurally match, so we assert the contract.
const nodeTypes = {
  entity: markRaw(EntityNode),
} as unknown as NodeTypesObject;

onNodeClick(({ node }) => {
  graphStore.highlightOne(node.id);
});

onPaneClick(() => {
  graphStore.clearHighlight();
  graphStore.select(null);
});

/** Re-fit the viewport whenever the dataset materially changes. */
watch(revision, async () => {
  await nextTick();
  // Small delay lets newly-measured nodes settle before fitting.
  window.setTimeout(() => {
    fitView({ padding: 0.25, duration: 600 });
  }, 60);
});

function minimapColor(node: GraphNode): string {
  const type = node.data?.entity.type as EntityType | undefined;
  return type ? visualFor(type).color : '#64748b';
}

const legend = (
  [
    'organization',
    'person',
    'concept',
    'technology',
    'product',
    'location',
    'event',
    'other',
  ] as EntityType[]
).map((t) => ({ type: t, ...visualFor(t) }));
</script>

<template>
  <section
    class="relative h-full w-full overflow-hidden rounded-2xl border border-[#232838] bg-[#0c0e16]/60"
  >
    <!-- Canvas header -->
    <header
      class="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-5 py-4"
    >
      <div class="pointer-events-auto">
        <h2 class="text-sm font-semibold tracking-wide text-slate-200">
          Knowledge Graph
        </h2>
        <p class="text-xs text-slate-500">
          {{ entityCount }} entities · {{ relationCount }} relations
        </p>
      </div>
      <button
        class="pointer-events-auto rounded-lg border border-[#2a3040] bg-[#161924]/80 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-indigo-500/60 hover:text-white"
        type="button"
        @click="fitView({ padding: 0.25, duration: 600 })"
      >
        Fit view
      </button>
    </header>

    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :min-zoom="0.15"
      :max-zoom="2.5"
      :default-edge-options="{ type: 'default' }"
      :nodes-draggable="true"
      :elevate-edges-on-select="true"
      fit-view-on-init
      class="h-full w-full"
    >
      <Background
        :variant="BackgroundVariant.Dots"
        :gap="26"
        :size="1"
        pattern-color="#1d2436"
      />
      <Controls position="bottom-right" :show-interactive="false" />
      <MiniMap
        :node-color="minimapColor"
        :node-stroke-width="3"
        :mask-color="'rgba(10,11,17,0.7)'"
        pannable
        zoomable
      />
    </VueFlow>

    <!-- Type legend -->
    <div
      class="pointer-events-none absolute bottom-4 left-4 z-10 flex max-w-[60%] flex-wrap gap-x-3 gap-y-1.5 rounded-xl border border-[#232838] bg-[#0c0e16]/80 px-3 py-2 text-[10px] text-slate-400 backdrop-blur"
    >
      <span
        v-for="item in legend"
        :key="item.type"
        class="flex items-center gap-1.5"
      >
        <span
          class="inline-block h-2.5 w-2.5 rounded-full"
          :style="{ backgroundColor: item.color }"
        />
        {{ item.label }}
      </span>
    </div>

    <!-- Empty state -->
    <div
      v-if="isEmpty"
      class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-center"
    >
      <div
        class="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#2a3040] bg-[#11131c] text-2xl text-indigo-400"
      >
        ◍
      </div>
      <p class="text-sm font-medium text-slate-300">No graph yet</p>
      <p class="max-w-xs text-xs leading-relaxed text-slate-500">
        Ingest a document on the left — extracted entities and their relations
        will materialize here as an interactive knowledge graph.
      </p>
    </div>
  </section>
</template>
