import { diffArrays, diffLines, diffWordsWithSpace } from "diff";

/**
 * Block-level markdown diff for the compare views. Both sides arrive as whole
 * documents (refinement previews are always full replacements — see
 * extractPreviewFromMessages), so the diff is recomputed from scratch and must
 * yield markdown that still parses: changes are carried as <ins>/<del> tags
 * injected outside the structural syntax, and anything too entangled to tag
 * safely falls back to whole-block removed/added rows, which need no inline
 * tags at all (the row wrapper styles them).
 */

export type DiffRowKind = "same" | "added" | "removed" | "modified";

export interface DiffRow {
  kind: DiffRowKind;
  /** Markdown for the current (left) side; carries <del> when "modified". */
  left?: string;
  /** Markdown for the pending (right) side; carries <ins> when "modified". */
  right?: string;
  /** "modified" only: both sides interleaved in reading order, for unified view. */
  merged?: string;
}

const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * Split markdown into blocks on blank lines, fence-aware: a code block with
 * internal blank lines stays one block.
 */
export function segmentBlocks(md: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    if (current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
  };
  for (const line of md.split("\n")) {
    if (FENCE.test(line)) {
      current.push(line);
      inFence = !inFence;
      continue;
    }
    if (!inFence && line.trim() === "") {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

function normalizeBlock(block: string): string {
  return block.trim().replace(/\s+/g, " ");
}

/** Blocks whose syntax cannot host inline tags: code fences and tables. */
function isGuardBlock(block: string): boolean {
  const first = block.trimStart();
  return FENCE.test(block) || first.startsWith("|");
}

/**
 * Word-diffing pays off only when the blocks are actually related; below this
 * shared-character ratio a pair renders as clean removed + added blocks
 * instead of word confetti. Tuning knob — iterate against the stories.
 */
const PAIR_SIMILARITY_THRESHOLD = 0.4;

/**
 * Structural line prefix that must stay outside <ins>/<del> so the markdown
 * still parses: list markers (incl. task lists), ordered markers, heading
 * hashes, blockquote arrows.
 */
const LINE_PREFIX =
  /^\s*(?:[-*+] (?:\[[ xX]\] )?|\d+[.)] (?:\[[ xX]\] )?|#{1,6} |> )?/;

/**
 * A tag boundary that splits an emphasis or code span breaks parsing; odd
 * delimiter counts inside a wrapped segment are the cheap tell.
 */
function hasUnbalancedDelimiters(text: string): boolean {
  for (const ch of ["*", "`", "~"]) {
    let count = 0;
    for (const c of text) if (c === ch) count++;
    if (count % 2 === 1) return true;
  }
  return false;
}

interface LinePair {
  left: string;
  right: string;
  merged: string;
}

/** Word-diff one changed line pair; null means "not safely taggable". */
function diffLinePair(oldLine: string, newLine: string): LinePair | null {
  const oldPrefix = LINE_PREFIX.exec(oldLine)?.[0] ?? "";
  const newPrefix = LINE_PREFIX.exec(newLine)?.[0] ?? "";
  const changes = diffWordsWithSpace(
    oldLine.slice(oldPrefix.length),
    newLine.slice(newPrefix.length),
  );
  let left = oldPrefix;
  let right = newPrefix;
  let merged = newPrefix;
  for (const change of changes) {
    if (change.added) {
      if (hasUnbalancedDelimiters(change.value)) return null;
      right += `<ins>${change.value}</ins>`;
      merged += `<ins>${change.value}</ins>`;
    } else if (change.removed) {
      if (hasUnbalancedDelimiters(change.value)) return null;
      left += `<del>${change.value}</del>`;
      merged += `<del>${change.value}</del>`;
    } else {
      left += change.value;
      right += change.value;
      merged += change.value;
    }
  }
  return { left, right, merged };
}

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Wrap a whole line's payload, keeping the structural prefix outside. */
function wrapLine(line: string, tag: "ins" | "del"): string | null {
  const prefix = LINE_PREFIX.exec(line)?.[0] ?? "";
  const payload = line.slice(prefix.length);
  if (payload === "") return line;
  if (hasUnbalancedDelimiters(payload)) return null;
  return `${prefix}<${tag}>${payload}</${tag}>`;
}

/**
 * Diff one plausibly-related block pair into a modified row; null demotes the
 * pair to whole-block removed + added rows.
 */
function diffBlockPair(oldBlock: string, newBlock: string): DiffRow | null {
  if (isGuardBlock(oldBlock) || isGuardBlock(newBlock)) return null;

  const wordChanges = diffWordsWithSpace(oldBlock, newBlock);
  let common = 0;
  for (const c of wordChanges) {
    if (!c.added && !c.removed) common += c.value.length;
  }
  const scale = Math.max(oldBlock.length, newBlock.length);
  if (scale === 0 || common / scale < PAIR_SIMILARITY_THRESHOLD) return null;

  const left: string[] = [];
  const right: string[] = [];
  const merged: string[] = [];
  const lineChanges = diffLines(`${oldBlock}\n`, `${newBlock}\n`);
  let i = 0;
  while (i < lineChanges.length) {
    const change = lineChanges[i];
    if (!change.added && !change.removed) {
      for (const line of splitLines(change.value)) {
        left.push(line);
        right.push(line);
        merged.push(line);
      }
      i++;
      continue;
    }
    let removedLines: string[] = [];
    let addedLines: string[] = [];
    if (change.removed) {
      removedLines = splitLines(change.value);
      i++;
      if (i < lineChanges.length && lineChanges[i].added) {
        addedLines = splitLines(lineChanges[i].value);
        i++;
      }
    } else {
      addedLines = splitLines(change.value);
      i++;
    }
    const paired = Math.min(removedLines.length, addedLines.length);
    for (let k = 0; k < paired; k++) {
      const pair = diffLinePair(removedLines[k], addedLines[k]);
      if (pair === null) return null;
      left.push(pair.left);
      right.push(pair.right);
      merged.push(pair.merged);
    }
    for (const line of removedLines.slice(paired)) {
      const wrapped = wrapLine(line, "del");
      if (wrapped === null) return null;
      left.push(wrapped);
      merged.push(wrapped);
    }
    for (const line of addedLines.slice(paired)) {
      const wrapped = wrapLine(line, "ins");
      if (wrapped === null) return null;
      right.push(wrapped);
      merged.push(wrapped);
    }
  }
  return {
    kind: "modified",
    left: left.join("\n"),
    right: right.join("\n"),
    merged: merged.join("\n"),
  };
}

/** Zip a removed run against the added run that replaced it, positionally. */
function pairChanges(removed: string[], added: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const paired = Math.min(removed.length, added.length);
  for (let k = 0; k < paired; k++) {
    const row = diffBlockPair(removed[k], added[k]);
    if (row) {
      rows.push(row);
    } else {
      rows.push({ kind: "removed", left: removed[k] });
      rows.push({ kind: "added", right: added[k] });
    }
  }
  for (const block of removed.slice(paired)) {
    rows.push({ kind: "removed", left: block });
  }
  for (const block of added.slice(paired)) {
    rows.push({ kind: "added", right: block });
  }
  return rows;
}

export function diffMarkdown(currentMd: string, pendingMd: string): DiffRow[] {
  const changes = diffArrays(
    segmentBlocks(currentMd),
    segmentBlocks(pendingMd),
    {
      comparator: (a, b) => normalizeBlock(a) === normalizeBlock(b),
    },
  );
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < changes.length) {
    const change = changes[i];
    if (!change.added && !change.removed) {
      // The new side's text is authoritative for unchanged blocks — the
      // comparator tolerates whitespace drift between the two.
      for (const block of change.value) {
        rows.push({ kind: "same", left: block, right: block });
      }
      i++;
      continue;
    }
    let removed: string[] = [];
    let added: string[] = [];
    if (change.removed) {
      removed = change.value;
      i++;
      if (i < changes.length && changes[i].added) {
        added = changes[i].value;
        i++;
      }
    } else {
      added = change.value;
      i++;
      if (i < changes.length && changes[i].removed) {
        removed = changes[i].value;
        i++;
      }
    }
    rows.push(...pairChanges(removed, added));
  }
  return rows;
}
