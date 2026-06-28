<script setup lang="ts">
import { onMounted } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import IngestPanel from '@/components/IngestPanel.vue';
import KnowledgeGraphCanvas from '@/components/KnowledgeGraphCanvas.vue';
import ChatPanel from '@/components/ChatPanel.vue';
import { useCorpusStore } from '@/stores/corpus';
import { useGraphStore } from '@/stores/graph';

const corpus = useCorpusStore();
const graph = useGraphStore();

onMounted(() => {
  // Best-effort warm load; failures surface in-store and the header indicator.
  void corpus.refresh();
  void graph.refresh();
});
</script>

<template>
  <div class="flex h-screen flex-col gap-3 p-3">
    <AppHeader />

    <main
      class="grid min-h-0 flex-1 gap-3"
      style="grid-template-columns: minmax(280px, 320px) minmax(0, 1fr) minmax(340px, 420px)"
    >
      <IngestPanel class="hidden md:flex" />
      <KnowledgeGraphCanvas />
      <ChatPanel class="hidden lg:flex" />
    </main>
  </div>
</template>
