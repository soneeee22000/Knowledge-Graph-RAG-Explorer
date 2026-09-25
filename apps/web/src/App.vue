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
  <div class="flex min-h-screen flex-col gap-3 p-3 lg:h-screen">
    <AppHeader />

    <main
      class="flex flex-col gap-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(340px,420px)]"
    >
      <IngestPanel class="hidden lg:flex" />
      <div class="h-[55vh] lg:h-auto lg:min-h-0">
        <KnowledgeGraphCanvas />
      </div>
      <div class="lg:min-h-0">
        <ChatPanel />
      </div>
    </main>
  </div>
</template>
