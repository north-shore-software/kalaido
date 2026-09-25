const FENCE = /^\s{0,3}(```|~~~)/;

/** One block of a document with its exact character span in the source. */
export interface BlockRange {
  text: string;
  /** Offset of the block's first character in the source. */
  start: number;
  /** Offset just past the block's last character (`source.slice(start, end) === text`). */
  end: number;
}

/**
 * Split markdown into blocks on blank lines, fence-aware: a code block with
 * internal blank lines stays one block. Each block carries its span so a
 * caller can slice the *exact* source text of a block run — the blank lines
 * between blocks are dropped here, so re-joining blocks would not reproduce
 * the source.
 */
export function segmentBlockRanges(md: string): BlockRange[] {
  const blocks: BlockRange[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let inFence = false;
  let offset = 0;
  const flush = (end: number) => {
    if (current.length > 0) {
      blocks.push({ text: current.join("\n"), start: currentStart, end });
      current = [];
    }
  };
  for (const line of md.split("\n")) {
    const lineEnd = offset + line.length;
    if (FENCE.test(line)) {
      if (current.length === 0) currentStart = offset;
      current.push(line);
      inFence = !inFence;
    } else if (!inFence && line.trim() === "") {
      flush(offset - 1);
    } else {
      if (current.length === 0) currentStart = offset;
      current.push(line);
    }
    offset = lineEnd + 1;
  }
  // The last block ends at the last line's end, not after a "\n" that may
  // not exist.
  if (current.length > 0) {
    flush(currentStart + current.join("\n").length);
  }
  return blocks;
}

/** The blocks of `segmentBlockRanges`, text only. */
export function segmentBlocks(md: string): string[] {
  return segmentBlockRanges(md).map((b) => b.text);
}

export const EDIT_MARKER_REGEX = /^<<<edit:([a-zA-Z0-9_-]+)>>>$/;

export function parseEditMarker(text: string): string | null {
  const match = EDIT_MARKER_REGEX.exec(text.trim());
  return match ? match[1] : null;
}

export function formatEditMarker(editId: string): string {
  return `<<<edit:${editId}>>>`;
}

export function isEditMarker(text: string): boolean {
  return parseEditMarker(text) !== null;
}

export function stripEditMarkers(text: string): string {
  return text.replace(/<<<edit:[a-zA-Z0-9_-]+>>>\n?/g, "");
}
