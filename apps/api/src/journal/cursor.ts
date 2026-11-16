/**
 * Timeline cursor (ADR-016): entries sort by `entryDate` desc, then `_id`
 * desc, so the position after an item is that pair. Encoded base64url so
 * it stays opaque to clients; a malformed cursor decodes to null (→ 400).
 */
export interface TimelinePosition {
  entryDate: string;
  id: string;
}

export function encodeCursor(position: TimelinePosition): string {
  return Buffer.from(`${position.entryDate}|${position.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): TimelinePosition | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = /^(\d{4}-\d{2}-\d{2})\|([0-9a-f]{24})$/.exec(decoded);
  return match?.[1] && match[2] ? { entryDate: match[1], id: match[2] } : null;
}
