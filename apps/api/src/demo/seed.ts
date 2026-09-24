import sampleCorpus from '../../eval/corpus.json' with { type: 'json' };
import { CorpusSchema } from '../eval/dataset.js';
import type { AppStores } from '../services/stores.js';

/** The committed sample the read-only demo serves: the fictional rail corpus used by the eval. */
export const DEMO_SAMPLE = CorpusSchema.parse(sampleCorpus);

export const DEMO_SAMPLE_DOCUMENT_COUNT = DEMO_SAMPLE.documents.length;

/**
 * Replace whatever the stores hold with the committed sample, so every
 * read-only instance serves the same corpus, cold start or not.
 */
export async function seedDemoCorpus(stores: AppStores): Promise<void> {
  await stores.clearAll();
  for (const document of DEMO_SAMPLE.documents) {
    await stores.corpus.ingest(
      { title: document.title, source: 'sample', content: document.content },
      () => undefined,
    );
  }
}
