/** History-Integration der Shell-Navigation (Browser-Zurück in der SPA).
 *
 * Die App ist ein Web-Component OHNE Angular-Router — Navigation lebt in
 * Signals. Diese Helfer spiegeln den Navigations-Zustand in die Query-Params
 * (dasselbe Vokabular wie die bestehenden Share-Links: `view`/`id`/`u`/
 * `event`/`topic`), damit `history.pushState`/`popstate` funktionieren.
 *
 * Embed-Sicherheit: es werden AUSSCHLIESSLICH die eigenen Keys gesetzt oder
 * entfernt — alle fremden Query-Params der Host-Seite bleiben unangetastet.
 */

export interface NavState {
  view: string;
  /** Idee (view=detail). */
  id?: string | null;
  /** Username (view=user). */
  u?: string | null;
  /** Event-Slug (view=events-Drill bzw. browser-Event-Filter). */
  event?: string | null;
  /** Topic-Id (view=topics-Drill bzw. browser-Topic-Filter). */
  topic?: string | null;
}

/** Query-Keys, die der App gehören — nur diese werden geschrieben/gelöscht. */
const OWN_KEYS = ['view', 'id', 'u', 'event', 'topic'] as const;

/** Baut aus der aktuellen Browser-URL + Zustand die neue relative URL
 *  (Pfad + Query + Hash). `view=home` schreibt keine eigenen Params —
 *  die Startansicht behält eine saubere Basis-URL. */
export function buildNavUrl(currentHref: string, state: NavState): string {
  const url = new URL(currentHref);
  for (const k of OWN_KEYS) url.searchParams.delete(k);
  if (state.view && state.view !== 'home') url.searchParams.set('view', state.view);
  if (state.id) url.searchParams.set('id', state.id);
  if (state.u) url.searchParams.set('u', state.u);
  if (state.event) url.searchParams.set('event', state.event);
  if (state.topic) url.searchParams.set('topic', state.topic);
  return url.pathname + url.search + url.hash;
}

/** Liest den Navigations-Zustand aus einem Query-String (`location.search`).
 *  Fallback für popstate-Events ohne eigenen `history.state`. */
export function readNavState(search: string): NavState {
  const p = new URLSearchParams(search);
  return {
    view: p.get('view') || 'home',
    id: p.get('id'),
    u: p.get('u'),
    event: p.get('event'),
    topic: p.get('topic'),
  };
}
