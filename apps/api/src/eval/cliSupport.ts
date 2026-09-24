import type { Summary } from './metrics.js';
import type { EvalReport, ModeSummary } from './retrievalEval.js';

const JSON_INDENT = 2;
const MRR_DISPLAY_DECIMALS = 3;

export interface CliArgs {
  /** Write the report to this path. */
  json: string | undefined;
  /** Compare a fresh report with this committed file and fail on any difference. */
  check: string | undefined;
}

/** Parse `--json <path>` and `--check <path>`; throws on anything else. */
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: undefined, check: undefined };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== '--json' && flag !== '--check') throw new Error(`Unknown argument: ${flag}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a path`);
    args[flag === '--json' ? 'json' : 'check'] = value;
  }
  return args;
}

function row(mode: string, kind: string, s: Summary): string {
  const cells = [
    mode,
    kind,
    String(s.items),
    `${s.hitAt1}/${s.items}`,
    `${s.hitAt3}/${s.items}`,
    s.mrr.toFixed(MRR_DISPLAY_DECIMALS),
    `${s.allEvidenceRetrieved}/${s.items}`,
  ];
  return `| ${cells.join(' | ')} |`;
}

function modeRows(mode: string, summary: ModeSummary): string[] {
  const kinds = Object.entries(summary.byKind).map(([kind, s]) => row(mode, kind, s));
  return [row(mode, 'all', summary.all), ...kinds];
}

/** Markdown table of every mode in the report, overall and per question kind. */
export function formatSummaryTable(report: EvalReport): string {
  return [
    '| Mode | Kind | Items | Hit@1 | Hit@3 | MRR | All evidence in top-k |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...modeRows('vector-only', report.summary.vectorOnly),
    ...modeRows('graph-expand', report.summary.graphExpand),
    ...(report.summary.graphAugmented
      ? modeRows('graph-augmented', report.summary.graphAugmented)
      : []),
  ].join('\n');
}

/** Stable JSON text for the committed results file. */
export function serializeReport(report: EvalReport): string {
  return `${JSON.stringify(report, null, JSON_INDENT)}\n`;
}

/** Compare two serialized reports, ignoring CRLF vs LF. */
export function sameReport(fresh: string, committed: string): boolean {
  const normalise = (text: string): string => text.replace(/\r\n/g, '\n');
  return normalise(fresh) === normalise(committed);
}
