import { config } from '../config.js';
import { BamlLlmProvider } from './baml.js';
import { MockLlmProvider } from './mock.js';
import type { LlmProvider } from './provider.js';

export type {
  LlmProvider,
  ExtractedEntity,
  ExtractedRelation,
  GraphExtraction,
} from './provider.js';
export { MockLlmProvider } from './mock.js';
export { BamlLlmProvider } from './baml.js';

/**
 * Factory selecting the provider from `LLM_PROVIDER`.
 * Defaults to the deterministic offline mock so the app always boots.
 */
export function createLlmProvider(provider: string = config.LLM_PROVIDER): LlmProvider {
  switch (provider) {
    case 'baml':
      return new BamlLlmProvider();
    case 'mock':
    default:
      return new MockLlmProvider();
  }
}
