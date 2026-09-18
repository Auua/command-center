/**
 * Progress writes are text edits of a note's YAML block only (ADR-040): the
 * three known keys are rewritten in place, a missing key is appended after
 * `status`, and the body comes back byte-identical, so an Obsidian-side diff
 * shows one to three changed lines. No YAML library: the vault's own scripts
 * parse front-matter with the same line-based rules (`check_vault.py`).
 */

export interface ProgressPatch {
  status?: string;
  /** Written as-is; the caller applies the max(2, current) rule. */
  confidence?: number;
  /** ISO calendar date (home timezone) or null to leave untouched. */
  reviewed?: string;
}

export interface FrontMatterProgress {
  status: string | null;
  confidence: number | null;
  reviewed: string | null;
}

const KEY_RE = /^([A-Za-z_][\w]*)\s*:\s*(.*)$/;
const PATCH_ORDER: (keyof ProgressPatch)[] = ['status', 'confidence', 'reviewed'];

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if (
    trimmed.length >= 2 &&
    first !== undefined &&
    first === trimmed[trimmed.length - 1] &&
    (first === '"' || first === "'")
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Locate the front-matter block: returns [firstKeyLine, closingFenceLine] or null. */
function locateBlock(lines: string[]): [number, number] | null {
  if (lines[0]?.trim() !== '---') return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') return [1, index];
  }
  return null;
}

/** Read the three progress keys; null when the block or a key is absent. */
export function readProgress(text: string): FrontMatterProgress {
  const lines = text.split('\n');
  const block = locateBlock(lines);
  const out: FrontMatterProgress = { status: null, confidence: null, reviewed: null };
  if (!block) return out;
  for (let index = block[0]; index < block[1]; index += 1) {
    const match = KEY_RE.exec(lines[index] ?? '');
    if (!match) continue;
    const value = unquote(match[2] ?? '');
    if (match[1] === 'status') out.status = value === '' ? null : value;
    else if (match[1] === 'reviewed') out.reviewed = value === '' ? null : value;
    else if (match[1] === 'confidence') {
      const parsed = Number.parseInt(value, 10);
      out.confidence = Number.isNaN(parsed) ? null : parsed;
    }
  }
  return out;
}

/**
 * Apply the patch to the YAML block, leaving every other byte untouched.
 * Throws when the note has no front-matter (the caller reports and skips).
 */
export function applyProgress(text: string, patch: ProgressPatch): string {
  const lines = text.split('\n');
  const block = locateBlock(lines);
  if (!block) throw new Error('note has no front-matter block');
  const [start, end] = block;

  const pending = new Map<string, string>();
  for (const key of PATCH_ORDER) {
    const value = patch[key];
    if (value !== undefined) pending.set(key, String(value));
  }
  if (pending.size === 0) return text;

  let statusLine = -1;
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? '';
    const match = KEY_RE.exec(line);
    if (!match) continue;
    const key = match[1] ?? '';
    if (key === 'status') statusLine = index;
    const value = pending.get(key);
    if (value === undefined) continue;
    // Preserve the key's own spelling and spacing; only the value changes.
    const head = line.slice(0, line.indexOf(':') + 1);
    lines[index] = `${head} ${value}`;
    pending.delete(key);
  }

  // Missing keys go right after `status` (or at the end of the block), in
  // the canonical status → confidence → reviewed order.
  const insertAt = statusLine >= 0 ? statusLine + 1 : end;
  const additions = PATCH_ORDER.filter((key) => pending.has(key)).map(
    (key) => `${key}: ${pending.get(key)}`,
  );
  lines.splice(insertAt, 0, ...additions);
  return lines.join('\n');
}
