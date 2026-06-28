<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import type { Entity } from '@kg/shared';
import { visualFor } from '@/lib/entityVisuals';

const props = defineProps<{
  /** VueFlow passes the node's `data` object through here. */
  data: { entity: Entity; highlighted: boolean };
  selected?: boolean;
}>();

const entity = computed(() => props.data.entity);
const visual = computed(() => visualFor(entity.value.type));
const highlighted = computed(() => props.data.highlighted);

/** Font scales gently with salience so big hubs read as important. */
const labelSize = computed(() => 12 + Math.round(entity.value.salience * 4));
const saliencePct = computed(() => Math.round(entity.value.salience * 100));
</script>

<template>
  <div
    class="entity-node group relative flex h-full w-full select-none flex-col items-center justify-center rounded-full border-2 px-3 text-center backdrop-blur-sm transition-all duration-300 ease-out"
    :class="[
      highlighted ? 'is-highlighted' : '',
      selected ? 'ring-2 ring-white/70' : '',
    ]"
    :style="{
      borderColor: visual.color,
      background: visual.fill,
      boxShadow: highlighted
        ? `0 0 0 3px ${visual.color}55, 0 0 28px ${visual.color}aa`
        : '0 6px 18px rgba(0,0,0,0.45)',
    }"
  >
    <Handle
      type="target"
      :position="Position.Top"
      class="!h-2 !w-2 !border-0 !bg-transparent"
    />
    <span
      class="pointer-events-none text-base leading-none opacity-90"
      :style="{ color: visual.color }"
      aria-hidden="true"
      >{{ visual.glyph }}</span
    >
    <span
      class="pointer-events-none mt-1 line-clamp-3 font-semibold leading-tight text-slate-100"
      :style="{ fontSize: `${labelSize}px` }"
    >
      {{ entity.label }}
    </span>
    <span
      class="pointer-events-none mt-1 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide"
      :style="{ color: visual.color, background: visual.fill }"
    >
      {{ visual.label }}
    </span>
    <span
      class="pointer-events-none absolute -bottom-5 text-[9px] font-medium text-slate-500 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
    >
      salience {{ saliencePct }}%
    </span>
    <Handle
      type="source"
      :position="Position.Bottom"
      class="!h-2 !w-2 !border-0 !bg-transparent"
    />
  </div>
</template>

<style scoped>
.entity-node.is-highlighted {
  animation: pulse-glow 2.4s ease-in-out infinite;
}
</style>
