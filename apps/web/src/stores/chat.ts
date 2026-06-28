import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Answer, Citation, ThoughtStep } from '@kg/shared';
import { streamQuery } from '@/lib/apiClient';
import { useGraphStore } from '@/stores/graph';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Live thought timeline (assistant turns only). */
  thoughts: ThoughtStep[];
  citations: Citation[];
  usedEntityIds: string[];
  usedRelationIds: string[];
  streaming: boolean;
  error: string | null;
}

let messageSeq = 0;
function nextId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${messageSeq}-${Date.now().toString(36)}`;
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([]);
  const topK = ref(6);
  const useGraphExpansion = ref(true);
  const running = ref(false);

  const lastAssistant = computed(() =>
    [...messages.value].reverse().find((m) => m.role === 'assistant'),
  );
  const isEmpty = computed(() => messages.value.length === 0);

  function upsertThought(msg: ChatMessage, step: ThoughtStep): void {
    const idx = msg.thoughts.findIndex((t) => t.id === step.id);
    if (idx === -1) {
      msg.thoughts.push(step);
    } else {
      msg.thoughts[idx] = step;
    }
  }

  async function ask(question: string): Promise<void> {
    const q = question.trim();
    if (q.length === 0 || running.value) return;

    const graphStore = useGraphStore();
    graphStore.clearHighlight();

    messages.value.push({
      id: nextId('user'),
      role: 'user',
      text: q,
      thoughts: [],
      citations: [],
      usedEntityIds: [],
      usedRelationIds: [],
      streaming: false,
      error: null,
    });

    const assistant: ChatMessage = {
      id: nextId('assistant'),
      role: 'assistant',
      text: '',
      thoughts: [],
      citations: [],
      usedEntityIds: [],
      usedRelationIds: [],
      streaming: true,
      error: null,
    };
    messages.value.push(assistant);

    running.value = true;
    try {
      for await (const event of streamQuery({
        question: q,
        topK: topK.value,
        useGraphExpansion: useGraphExpansion.value,
      })) {
        switch (event.type) {
          case 'thought':
            upsertThought(assistant, event.step);
            break;
          case 'retrieved':
            assistant.citations = event.citations;
            break;
          case 'graph': {
            graphStore.mergeGraph(event.entities, event.relations);
            const ids = event.entities.map((e) => e.id);
            assistant.usedEntityIds = [...new Set([...assistant.usedEntityIds, ...ids])];
            assistant.usedRelationIds = [
              ...new Set([...assistant.usedRelationIds, ...event.relations.map((r) => r.id)]),
            ];
            graphStore.highlight(assistant.usedEntityIds);
            break;
          }
          case 'token':
            assistant.text += event.value;
            break;
          case 'answer':
            applyAnswer(assistant, event.answer);
            graphStore.highlight(assistant.usedEntityIds);
            break;
          case 'error':
            assistant.error = event.message;
            break;
          case 'done':
            break;
        }
      }
    } catch (err) {
      assistant.error = err instanceof Error ? err.message : 'Query stream failed';
    } finally {
      assistant.streaming = false;
      running.value = false;
    }
  }

  function applyAnswer(msg: ChatMessage, answer: Answer): void {
    // Prefer the authoritative final text; keep streamed text if final is empty.
    if (answer.text.length > 0) msg.text = answer.text;
    if (answer.citations.length > 0) msg.citations = answer.citations;
    msg.usedEntityIds = [...new Set([...msg.usedEntityIds, ...answer.usedEntityIds])];
    msg.usedRelationIds = [...new Set([...msg.usedRelationIds, ...answer.usedRelationIds])];
  }

  function clear(): void {
    messages.value = [];
  }

  return {
    messages,
    topK,
    useGraphExpansion,
    running,
    lastAssistant,
    isEmpty,
    ask,
    clear,
  };
});
