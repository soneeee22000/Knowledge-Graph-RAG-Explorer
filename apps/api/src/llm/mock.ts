import type { EntityType } from '@kg/shared';
import type {
  ExtractedEntity,
  ExtractedRelation,
  GraphExtraction,
  LlmProvider,
} from './provider.js';

/** Fixed embedding dimensionality for the mock provider. */
export const MOCK_EMBED_DIM = 256;

/** Words that look like entities but carry no meaning — never extract these. */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'if',
  'then',
  'this',
  'that',
  'these',
  'those',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'in',
  'on',
  'at',
  'to',
  'of',
  'for',
  'with',
  'as',
  'by',
  'from',
  'i',
  'we',
  'they',
  'he',
  'she',
  'you',
  'however',
  'therefore',
  'meanwhile',
  'although',
  'because',
  'while',
]);

/** Keyword hints that bias an entity's type classification. */
const TYPE_HINTS: Array<{ test: RegExp; type: EntityType }> = [
  { test: /\b(inc|corp|llc|ltd|gmbh|sa|company|labs?|ai|systems|technologies)\b/i, type: 'organization' },
  { test: /\b(university|institute|foundation|agency|council|commission)\b/i, type: 'organization' },
  { test: /\b(city|country|region|valley|river|mountain|street|state)\b/i, type: 'location' },
  { test: /\b(protocol|framework|engine|model|algorithm|platform|api|sdk|library|database)\b/i, type: 'technology' },
  { test: /\b(product|app|application|tool|device)\b/i, type: 'product' },
  { test: /\b(summit|conference|war|election|launch|release|event)\b/i, type: 'event' },
];

/**
 * Deterministic, offline LLM provider.
 *
 * - `embed`: hashes tokens into a fixed-dim bag-of-hashed-tokens vector, then
 *   L2-normalizes. Same text always yields the same vector; semantically
 *   overlapping texts share tokens and thus point in similar directions.
 * - `extractGraph`: heuristic capitalized-phrase / keyword extraction with
 *   co-occurrence relations.
 * - `answer`: extractive — stitches the most relevant context sentences.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => embedText(t));
  }

  async extractGraph(chunkText: string): Promise<GraphExtraction> {
    return extractGraph(chunkText);
  }

  async answer(question: string, context: string): Promise<string> {
    return synthesizeAnswer(question, context);
  }
}

/* ------------------------------------------------------------------ */
/* Embeddings                                                          */
/* ------------------------------------------------------------------ */

/** djb2 string hash → unsigned 32-bit int. */
function hash32(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Hash tokens into a fixed-dim vector and L2-normalize it. */
export function embedText(text: string, dim = MOCK_EMBED_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    const bucket = hash32(token) % dim;
    // Sign derived from a second hash so collisions don't always reinforce.
    const sign = (hash32('s:' + token) & 1) === 0 ? 1 : -1;
    vec[bucket] = (vec[bucket] ?? 0) + sign;
  }
  // L2 normalize.
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec; // empty text → zero vector
  return vec.map((v) => v / norm);
}

/* ------------------------------------------------------------------ */
/* Graph extraction                                                    */
/* ------------------------------------------------------------------ */

/** Split a chunk into sentences on terminal punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Find candidate entity phrases: runs of Capitalized words (optionally joined
 * by lowercase connectors like "of"/"and") that aren't sentence-initial noise.
 */
function findEntityPhrases(sentence: string): string[] {
  const phrases: string[] = [];
  // Match sequences of capitalized words, allowing short lowercase connectors.
  const re = /([A-Z][a-zA-Z0-9]+(?:\s+(?:of|and|the|für|de)\s+|\s+)?)+/g;
  const matches = sentence.match(re) ?? [];
  for (const raw of matches) {
    const phrase = raw.trim().replace(/\s+/g, ' ');
    // Drop single common words and pure stopwords.
    const words = phrase.split(' ');
    const meaningful = words.filter(
      (w) => !STOPWORDS.has(w.toLowerCase()) && /[A-Z]/.test(w[0] ?? ''),
    );
    if (meaningful.length === 0) continue;
    const cleaned = meaningful.join(' ');
    if (cleaned.length < 2) continue;
    phrases.push(cleaned);
  }
  return phrases;
}

function classify(label: string): EntityType {
  for (const hint of TYPE_HINTS) {
    if (hint.test.test(label)) return hint.type;
  }
  // Multi-word Capitalized phrases are often orgs/people; single proper nouns → concept.
  if (label.includes(' ')) return 'organization';
  return 'concept';
}

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extract a small graph from a chunk:
 * - entities: deduped capitalized phrases (typed via keyword hints),
 * - relations: co-occurrence edges between entities sharing a sentence.
 */
export function extractGraph(chunkText: string): GraphExtraction {
  const sentences = splitSentences(chunkText);
  const entityByNorm = new Map<string, ExtractedEntity>();
  const relationKeys = new Set<string>();
  const relations: ExtractedRelation[] = [];

  for (const sentence of sentences) {
    const phrases = findEntityPhrases(sentence);
    const uniqueInSentence: string[] = [];
    for (const phrase of phrases) {
      const norm = normalizeLabel(phrase);
      if (!entityByNorm.has(norm)) {
        entityByNorm.set(norm, { label: phrase, type: classify(phrase) });
      }
      if (!uniqueInSentence.includes(norm)) uniqueInSentence.push(norm);
    }

    // Co-occurrence: connect each pair of distinct entities in this sentence.
    for (let i = 0; i < uniqueInSentence.length; i++) {
      for (let j = i + 1; j < uniqueInSentence.length; j++) {
        const a = uniqueInSentence[i]!;
        const b = uniqueInSentence[j]!;
        const key = `${a}::${b}`;
        if (relationKeys.has(key)) continue;
        relationKeys.add(key);
        const sourceLabel = entityByNorm.get(a)!.label;
        const targetLabel = entityByNorm.get(b)!.label;
        relations.push({
          sourceLabel,
          targetLabel,
          type: 'RELATED_TO',
          label: 'related to',
          weight: 0.5,
        });
      }
    }
  }

  return { entities: [...entityByNorm.values()], relations };
}

/* ------------------------------------------------------------------ */
/* Answer synthesis                                                    */
/* ------------------------------------------------------------------ */

/** Score a sentence by lexical overlap with the question tokens. */
function overlapScore(sentenceTokens: Set<string>, questionTokens: Set<string>): number {
  let hits = 0;
  for (const q of questionTokens) if (sentenceTokens.has(q)) hits++;
  return hits;
}

/**
 * Extractive answer: pick the context sentences most lexically relevant to the
 * question and stitch them into a short, readable paragraph. Deterministic.
 */
export function synthesizeAnswer(question: string, context: string): string {
  const questionTokens = new Set(tokenize(question).filter((t) => !STOPWORDS.has(t)));
  const sentences = splitSentences(context);
  if (sentences.length === 0) {
    return "I couldn't find relevant information in the corpus to answer that.";
  }

  const ranked = sentences
    .map((sentence, index) => {
      const tokens = new Set(tokenize(sentence));
      return { sentence, index, score: overlapScore(tokens, questionTokens) };
    })
    // Stable sort: by score desc, then original order to stay deterministic.
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const top = ranked.filter((r) => r.score > 0).slice(0, 3);
  const chosen = (top.length > 0 ? top : ranked.slice(0, 2))
    // Restore reading order for a coherent paragraph.
    .sort((a, b) => a.index - b.index)
    .map((r) => r.sentence.replace(/\s+/g, ' ').trim());

  return `Based on the retrieved context: ${chosen.join(' ')}`;
}
