import { readFile, writeFile } from 'node:fs/promises';
import { formatSummaryTable, parseCliArgs, sameReport, serializeReport } from './cliSupport.js';
import { loadCorpus, loadEvalSet } from './dataset.js';
import { runRetrievalEval, type EvalReport } from './retrievalEval.js';

function printReport(report: EvalReport): void {
  const { corpus, config, comparison } = report;
  console.log(
    `Retrieval eval: ${report.evalSet.items} questions over ${corpus.documents} documents ` +
      `(${corpus.chunks} chunks, ${corpus.entities} entities, ${corpus.relations} relations), ` +
      `provider=${config.provider}, topK=${config.topK}\n`,
  );
  console.log(formatSummaryTable(report));
  console.log(
    `\nGraph rerank vs vector order: first-relevant rank improved on ${comparison.improved}, ` +
      `worsened on ${comparison.worsened}, unchanged on ${comparison.unchanged}; ` +
      `top-k order changed on ${comparison.orderChanged}.`,
  );
}

async function checkAgainst(path: string, text: string): Promise<boolean> {
  const committed = await readFile(path, 'utf8');
  if (sameReport(text, committed)) {
    console.log(`\nCheck passed: output matches ${path}.`);
    return true;
  }
  console.error(`\nCheck failed: output differs from ${path}. Run "npm run eval" and commit.`);
  return false;
}

/** Run the evaluation, print it, and optionally write or check results.json. */
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const report = await runRetrievalEval(await loadCorpus(), await loadEvalSet());
  const text = serializeReport(report);
  printReport(report);
  if (args.json) await writeFile(args.json, text, 'utf8');
  if (args.check && !(await checkAgainst(args.check, text))) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
