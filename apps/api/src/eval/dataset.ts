import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Directory holding the committed corpus, question set and results. */
export const EVAL_DIR = fileURLToPath(new URL('../../eval/', import.meta.url));

export const CORPUS_FILE = 'corpus.json';
export const QUESTIONS_FILE = 'questions.json';
export const RESULTS_FILE = 'results.json';

/** A labelled piece of supporting text: a phrase that must appear in a chunk of one document. */
export const EvidenceSchema = z.object({
  document: z.string().min(1),
  contains: z.string().min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ItemKindSchema = z.enum(['single-hop', 'multi-hop']);
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const EvalItemSchema = z.object({
  id: z.string().min(1),
  kind: ItemKindSchema,
  question: z.string().min(1),
  evidence: z.array(EvidenceSchema).min(1),
});
export type EvalItem = z.infer<typeof EvalItemSchema>;

export const EvalSetSchema = z.object({
  name: z.string().min(1),
  author: z.string().min(1),
  note: z.string().min(1),
  topK: z.number().int().min(1).max(20),
  items: z.array(EvalItemSchema).min(1),
});
export type EvalSet = z.infer<typeof EvalSetSchema>;

export const CorpusSchema = z.object({
  name: z.string().min(1),
  note: z.string().min(1),
  documents: z.array(z.object({ title: z.string().min(1), content: z.string().min(1) })).min(1),
});
export type Corpus = z.infer<typeof CorpusSchema>;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

/** Load and validate the evaluation corpus. */
export async function loadCorpus(dir: string = EVAL_DIR): Promise<Corpus> {
  return CorpusSchema.parse(await readJson(join(dir, CORPUS_FILE)));
}

/** Load and validate the authored question set. */
export async function loadEvalSet(dir: string = EVAL_DIR): Promise<EvalSet> {
  return EvalSetSchema.parse(await readJson(join(dir, QUESTIONS_FILE)));
}
