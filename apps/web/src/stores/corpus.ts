import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Document, IngestPhase } from '@kg/shared';
import {
  getDocuments,
  resetCorpus as apiResetCorpus,
  streamIngest,
} from '@/lib/apiClient';
import { useGraphStore } from '@/stores/graph';

export interface IngestProgress {
  phase: IngestPhase;
  message: string;
  ratio: number;
}

const PHASE_ORDER: IngestPhase[] = [
  'chunking',
  'embedding',
  'extracting',
  'linking',
  'persisting',
];

export const useCorpusStore = defineStore('corpus', () => {
  const documents = ref<Document[]>([]);
  const loading = ref(false);
  const ingesting = ref(false);
  const progress = ref<IngestProgress | null>(null);
  const error = ref<string | null>(null);
  const lastResult = ref<{
    documentId: string;
    chunkCount: number;
    entityCount: number;
    relationCount: number;
  } | null>(null);

  const phases = computed(() => PHASE_ORDER);
  const documentCount = computed(() => documents.value.length);

  /** Index of the active phase in the canonical pipeline order (for steppers). */
  const activePhaseIndex = computed(() =>
    progress.value ? PHASE_ORDER.indexOf(progress.value.phase) : -1,
  );

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await getDocuments();
      documents.value = res.documents;
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Failed to load documents';
    } finally {
      loading.value = false;
    }
  }

  async function ingest(content: string, title: string): Promise<void> {
    if (ingesting.value) return;
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      error.value = 'Nothing to ingest — paste some text first.';
      return;
    }

    ingesting.value = true;
    error.value = null;
    lastResult.value = null;
    progress.value = {
      phase: 'chunking',
      message: 'Starting ingestion…',
      ratio: 0,
    };

    const graphStore = useGraphStore();

    try {
      for await (const event of streamIngest({
        title: title.trim() || 'Untitled document',
        source: 'pasted',
        content: trimmed,
      })) {
        switch (event.type) {
          case 'progress':
            progress.value = {
              phase: event.phase,
              message: event.message,
              ratio: event.ratio,
            };
            break;
          case 'complete':
            lastResult.value = {
              documentId: event.documentId,
              chunkCount: event.chunkCount,
              entityCount: event.entityCount,
              relationCount: event.relationCount,
            };
            progress.value = {
              phase: 'persisting',
              message: 'Ingestion complete.',
              ratio: 1,
            };
            break;
          case 'error':
            error.value = event.message;
            break;
        }
      }

      // Pull fresh documents + the rebuilt graph after a successful ingest.
      await Promise.all([refresh(), graphStore.refresh()]);
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Ingestion stream failed';
    } finally {
      ingesting.value = false;
    }
  }

  async function reset(): Promise<void> {
    error.value = null;
    try {
      await apiResetCorpus();
      documents.value = [];
      progress.value = null;
      lastResult.value = null;
      useGraphStore().clear();
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Failed to reset corpus';
    }
  }

  return {
    documents,
    loading,
    ingesting,
    progress,
    error,
    lastResult,
    phases,
    documentCount,
    activePhaseIndex,
    refresh,
    ingest,
    reset,
  };
});
