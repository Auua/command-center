/**
 * Where the editor's "← Journal" goes back to: the timeline as it was left
 * — search and filters included (`/journal?q=…`) — rather than the bare
 * timeline. The timeline records its address whenever it shows; the editor
 * reads it. sessionStorage, guarded: without it, back is plain `/journal`.
 */
const KEY = 'cc:journal-list';
const LIST_HREF = /^\/journal(\?[^#]*)?$/;

export function rememberJournalList(href: string): void {
  try {
    sessionStorage.setItem(KEY, href);
  } catch {
    // Storage unavailable: back goes to the plain timeline.
  }
}

export function journalListHref(): string {
  try {
    const href = sessionStorage.getItem(KEY);
    return href && LIST_HREF.test(href) ? href : '/journal';
  } catch {
    return '/journal';
  }
}
