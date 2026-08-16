import type {
  NormalizedTranscript,
  TranscriptFormat,
  TranscriptTurn,
} from '@/lib/types';

// ── Transcript normalization layer (build plan §8.2) ──
// Real call transcripts arrive in wildly different shapes. This detects the
// format and converts everything into ONE canonical turn-based structure
// before it reaches n8n — so the LLM prompt and JSON schema never special-case
// file formats. This is what separates a toy demo from something that works.

const TIME_TOKEN_RX = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
// Leading timestamp (with optional brackets) + optional dash separator.
const TIME_PREFIX_RX =
  /^\s*(?:\[?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\]?)\s*(?:—|-|–|\u2192)?\s*/;
// A speaker label: token + colon (optionally followed by text).
const LABEL_RX = /^\s*([A-Za-z][A-Za-z .'\u2019&-]{1,20})\s*[：:]\s+(.*)$/;
const SRT_RANGE_RX =
  /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/;
const SRT_INDEX_RX = /^\s*\d+\s*$/;

const MIN_RATIO = 0.8; // winner must recognize ≥80% of non-empty lines

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function nonEmpty(lines: string[]): string[] {
  return lines.filter((l) => l.trim().length > 0);
}

interface DetectorResult {
  format: TranscriptFormat;
  turns: TranscriptTurn[];
  recognized: number;
}

// ── Detector: timestamped transcript ([00:01:23] Agent: text or 00:01:23 — Agent: text) ──
function detectTimestamped(nonEmptyLines: string[]): DetectorResult | null {
  let recognized = 0;
  const turns: TranscriptTurn[] = [];
  let seq = 0;

  for (const line of nonEmptyLines) {
    if (!TIME_PREFIX_RX.test(line)) continue;
    if (!TIME_TOKEN_RX.test(line)) continue;
    const m = line.match(TIME_PREFIX_RX);
    const timestamp = m?.[1] ?? undefined;
    const rest = line.replace(TIME_PREFIX_RX, '');
    // Lines whose post-timestamp remainder starts with a CSV/TSV delimiter are
    // structured exports (timestamp,speaker,text) — hand them to the CSV
    // detector instead of misreading them as timestamped dialogue.
    if (/^[,\t]/.test(rest)) continue;
    const labeled = rest.match(LABEL_RX);
    const speaker = labeled ? (labeled[1] ?? 'unknown').trim() : 'unknown';
    const text = (labeled ? (labeled[2] ?? rest) : rest).trim();
    if (text.length === 0) continue;
    recognized++;
    seq++;
    turns.push({ seq, speaker, text, ...(timestamp ? { timestamp } : {}) });
  }
  if (recognized === 0) return null;
  return { format: 'timestamped', turns, recognized };
}

// ── Detector: labeled dialogue (Customer: ... / Agent: ...) ──
function detectLabeled(nonEmptyLines: string[]): DetectorResult | null {
  let recognized = 0;
  const turns: TranscriptTurn[] = [];
  let seq = 0;
  for (const line of nonEmptyLines) {
    const m = line.match(LABEL_RX);
    if (!m) continue;
    const speaker = (m[1] ?? 'unknown').trim();
    const text = (m[2] ?? '').trim();
    if (text.length === 0) continue;
    recognized++;
    seq++;
    turns.push({ seq, speaker, text });
  }
  if (recognized === 0) return null;
  return { format: 'labeled', turns, recognized };
}

// ── Detector: CSV/TSV-in-.txt (timestamp,speaker,text) ──
// Tricky bit: the text field itself may contain the delimiter. We detect the
// true column count (from a header or the minimum field count across lines)
// and split with a LIMIT so the final (text) column absorbs internal
// delimiters instead of being mis-split into the speaker slot.
function detectCsv(nonEmptyLines: string[]): DetectorResult | null {
  const total = Math.max(1, nonEmptyLines.length);
  const tabLines = nonEmptyLines.filter((l) => l.includes('\t')).length;
  const commaLines = nonEmptyLines.filter((l) => l.includes(',')).length;
  const tabRatio = tabLines / total;
  const commaRatio = commaLines / total;
  if (tabRatio < 0.5 && commaRatio < 0.5) return null;
  const delim = tabRatio >= commaRatio ? '\t' : ',';

  // Detect a header row and the column count.
  let header: string[] | null = null;
  let startIdx = 0;
  {
    const first = nonEmptyLines[0] ?? '';
    const firstFields = first.split(delim).map((f) => f.trim().toLowerCase());
    const looksLikeHeader =
      firstFields.some((f) =>
        /timestamp|time|speaker|caller|text|utterance|message|content/i.test(f)
      ) &&
      !TIME_TOKEN_RX.test(first);
    if (looksLikeHeader) {
      header = firstFields;
      startIdx = 1;
    }
  }

  const dataLines = nonEmptyLines.slice(startIdx);
  // Column count = header length if known, else the minimum field count seen
  // (lines whose text contains delimiters split into MORE, so the floor is
  // the real column count). Guard a sane minimum of 2.
  let columns = header ? header.length : 3;
  if (!header && dataLines.length > 0) {
    columns = dataLines.reduce(
      (min, l) => Math.min(min, l.split(delim).length),
      Infinity
    );
    if (!Number.isFinite(columns)) columns = 3;
    columns = Math.max(2, Math.min(columns, 3));
  }

  // Map columns by header name, falling back to positional layout:
  //   [timestamp?, speaker, text]  (2 or 3 cols are the supported shapes)
  let timeCol = -1, speakerCol = -1, textCol = -1;
  if (header) {
    header.forEach((h, i) => {
      if (/timestamp|time/.test(h)) timeCol = i;
      else if (/speaker|caller|agent/.test(h)) speakerCol = i;
      else if (/text|utterance|message|content/.test(h)) textCol = i;
    });
  }
  // Positional fallbacks when header names didn't match.
  if (textCol < 0) textCol = columns - 1;
  if (speakerCol < 0) speakerCol = columns - 2;
  if (timeCol < 0 && columns >= 3) timeCol = 0;

  let recognized = 0;
  const turns: TranscriptTurn[] = [];
  let seq = 0;

  for (const line of dataLines) {
    if (!line.includes(delim)) continue;
    // split with a limit so the LAST column keeps internal delimiters
    const fields = line.split(delim, columns);
    if (fields.length < 2) continue;
    const get = (i: number) => (fields[i] ?? '').trim();
    const text = get(textCol);
    if (!text) continue;
    const speaker = safeSpeaker(get(speakerCol));
    const tsField = get(timeCol);
    const timestamp =
      timeCol >= 0 && tsField && TIME_TOKEN_RX.test(tsField) ? tsField : undefined;
    recognized++;
    seq++;
    turns.push({ seq, speaker, text, ...(timestamp ? { timestamp } : {}) });
  }
  if (recognized === 0) return null;
  return { format: 'csv', turns, recognized };
}

// Speaker strings that exceed the schema limit (40) are clearly not real labels
// (a parser mismatch), so treat them as 'unknown' rather than fabricate.
function safeSpeaker(raw: string): string {
  const s = raw.trim();
  if (s.length === 0 || s.length > 40) return 'unknown';
  return s;
}

// ── Detector: caption-style / SRT / VTT ──
function detectCaption(text: string, nonEmptyLines: string[]): DetectorResult | null {
  const hasRange = nonEmptyLines.some((l) => SRT_RANGE_RX.test(l));
  if (!hasRange) return null;
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((b) => b.split('\n').filter((l) => l.trim().length > 0))
    .filter((b) => b.length > 0);

  let recognized = 0;
  const turns: TranscriptTurn[] = [];
  let seq = 0;
  for (const block of blocks) {
    let idx = 0;
    // optional index line
    if (SRT_INDEX_RX.test(block[0] ?? '')) idx = 1;
    const rangeLine = block[idx] ?? '';
    const rangeMatch = rangeLine.match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/
    );
    if (!rangeMatch) continue;
    const textLines = block.slice(idx + 1);
    const joined = textLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!joined) continue;
    const labeled = joined.match(LABEL_RX);
    const speaker = labeled ? (labeled[1] ?? 'unknown').trim() : 'unknown';
    const body = labeled ? (labeled[2] ?? joined).trim() : joined;
    recognized += block.length;
    seq++;
    turns.push({ seq, speaker, text: body, timestamp: rangeMatch[1] });
  }
  if (recognized === 0) return null;
  return { format: 'caption', turns, recognized };
}

// ── Fallback A: unlabeled alternating turns (short lines, no labels) ──
function buildUnlabeledTurns(nonEmptyLines: string[]): DetectorResult {
  const turns: TranscriptTurn[] = nonEmptyLines.map((line, i) => ({
    seq: i + 1,
    speaker: i % 2 === 0 ? 'unknown_1' : 'unknown_2',
    text: line.trim(),
  }));
  return { format: 'unlabeled_turns', turns, recognized: nonEmptyLines.length };
}

// ── Fallback B: single unbroken paragraph → sentence split ──
function sentenceSplit(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  // Split after sentence terminators followed by whitespace + capital/quote.
  const parts = cleaned.split(/(?<=[.!?])\s+(?=["'(A-Z])/);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function buildUnlabeledProse(text: string, nonEmptyLines: string[]): DetectorResult {
  // If the text is mostly one long blob, sentence-split it; otherwise treat
  // each non-empty line as its own utterance (still speaker 'unknown').
  const avgLen =
    nonEmptyLines.reduce((a, l) => a + l.length, 0) /
    Math.max(1, nonEmptyLines.length);
  if (avgLen >= 160 || nonEmptyLines.length <= 2) {
    const sentences = sentenceSplit(text);
    const turns: TranscriptTurn[] = sentences.map((s, i) => ({
      seq: i + 1,
      speaker: 'unknown',
      text: s,
    }));
    return {
      format: 'unlabeled_prose',
      turns,
      recognized: nonEmptyLines.length || sentences.length,
    };
  }
  const turns: TranscriptTurn[] = nonEmptyLines.map((line, i) => ({
    seq: i + 1,
    speaker: 'unknown',
    text: line.trim(),
  }));
  return {
    format: 'unlabeled_prose',
    turns,
    recognized: nonEmptyLines.length,
  };
}

// ── Orchestrator ──
export function normalizeTranscript(rawText: string): NormalizedTranscript {
  const lines = splitLines(rawText);
  const nonEmptyLines = nonEmpty(lines);
  const total = nonEmptyLines.length;

  if (total === 0) {
    return { format: 'unlabeled_prose', turns: [], formatConfidence: 0 };
  }

  const candidates: Array<() => DetectorResult | null> = [
    () => detectTimestamped(nonEmptyLines),
    () => detectLabeled(nonEmptyLines),
    () => detectCsv(nonEmptyLines),
    () => detectCaption(rawText, nonEmptyLines),
  ];

  for (const detect of candidates) {
    const r = detect();
    if (r && r.turns.length > 0 && r.recognized / total >= MIN_RATIO) {
      return {
        format: r.format,
        turns: r.turns,
        formatConfidence: r.recognized / total,
      };
    }
  }

  // Fallbacks — never invent speaker identity (assignment "don't fabricate").
  const avgLen =
    nonEmptyLines.reduce((a, l) => a + l.length, 0) / total;
  const looksLikeDialogue =
    nonEmptyLines.length >= 2 && avgLen < 160 && !looksLikeProse(rawText);

  if (looksLikeDialogue) {
    const r = buildUnlabeledTurns(nonEmptyLines);
    return {
      format: r.format,
      turns: r.turns,
      formatConfidence: 1,
    };
  }
  const r = buildUnlabeledProse(rawText, nonEmptyLines);
  return {
    format: r.format,
    turns: r.turns,
    formatConfidence: 1,
  };
}

function looksLikeProse(text: string): boolean {
  const lines = splitLines(text);
  const nonEmptyLines = nonEmpty(lines);
  if (nonEmptyLines.length <= 1) return true;
  // Prose: very few line breaks relative to total length.
  const chars = text.trim().length;
  const breaks = nonEmptyLines.length;
  return chars / breaks > 200;
}