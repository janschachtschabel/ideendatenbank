import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, finalize, shareReplay } from 'rxjs';
import { FeaturedEvent, Idea, IdeaList, InboxItem, SortBy, TaxonomyEntry, Topic, UserProfileMeta } from './models';
import { AuthService } from './auth.service';

// Re-export, damit bestehende `import { API_BASE_DEFAULT } from './api.service'`
// weiter funktionieren — die Konstante lebt jetzt in auth.service.ts.
export { API_BASE_DEFAULT } from './auth.service';

/** Antwort beim Löschen einer Phase/Veranstaltung: wie viele Ideen-Tags
 *  entfernt wurden (removed), wie viele Knoten dabei scheiterten (failed). */
export interface TaxDeleteResult {
  ok: boolean;
  removed: number;
  failed: number;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  // In-Flight-Dedup für idempotente GETs: feuern beim Seitenaufbau mehrere
  // Komponenten GLEICHZEITIG denselben Request (settings/events/meta/phases/
  // featured/topics), teilen sie sich EINEN HTTP-Call statt N. Nach Abschluss
  // wird der Eintrag verworfen → kein Caching, keine Staleness; nur der
  // Lade-Schwall (der die ~6 Browser-Verbindungen verstopft) verschwindet.
  private _inflight = new Map<string, Observable<unknown>>();
  private coalesced<T>(key: string, factory: () => Observable<T>): Observable<T> {
    const existing = this._inflight.get(key);
    if (existing) return existing as Observable<T>;
    const shared = factory().pipe(
      finalize(() => this._inflight.delete(key)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this._inflight.set(key, shared);
    return shared;
  }

  // ---- Auth-Facade ---------------------------------------------------------
  // Credential-/Identitätslogik lebt jetzt in AuthService (eine Quelle der
  // Wahrheit + Naht für OAuth). ApiService reicht die von Komponenten genutzten
  // Methoden durch, damit deren Call-Sites unverändert bleiben. Der Auth-Header
  // wird zentral vom authInterceptor angehängt (auth.interceptor.ts) — NICHT
  // mehr pro Call. So kann er strukturell nie an eine Fremd-Origin gelangen.
  authTick = this.auth.authTick;
  get base(): string {
    return this.auth.apiBase;
  }
  setBase(url: string) {
    this.auth.setBase(url);
  }
  setCredentials(user: string, pass: string) {
    this.auth.setCredentials(user, pass);
  }
  clearCredentials() {
    this.auth.clearCredentials();
  }
  hasCredentials() {
    return this.auth.hasCredentials();
  }
  currentUser(): string | null {
    return this.auth.currentUser();
  }
  currentDisplayName(): string | null {
    return this.auth.currentDisplayName();
  }
  currentInitials(): string {
    return this.auth.currentInitials();
  }
  isModerator(): boolean {
    return this.auth.isModerator();
  }
  refreshMe() {
    return this.auth.refreshMe();
  }

  topics(): Observable<Topic[]> {
    return this.coalesced('topics', () => this.http.get<Topic[]>(`${this.base}/topics`));
  }

  topicDetail(id: string): Observable<{ topic: Topic; parent: Topic | null; children: Topic[] }> {
    return this.http.get<{ topic: Topic; parent: Topic | null; children: Topic[] }>(
      `${this.base}/topics/${encodeURIComponent(id)}`,
    );
  }

  meta(
    opts: {
      topicId?: string | null;
      phase?: string | null;
      event?: string | null;
      q?: string | null;
    } = {},
  ): Observable<{
    phases: { value: string; count: number }[];
    events: { value: string; count: number }[];
    categories: { value: string; count: number }[];
    topics: Record<string, number>;
  }> {
    let params = new HttpParams();
    if (opts.topicId) params = params.set('topic_id', opts.topicId);
    if (opts.phase) params = params.set('phase', opts.phase);
    if (opts.event) params = params.set('event', opts.event);
    if (opts.q && opts.q.trim()) params = params.set('q', opts.q.trim());
    return this.coalesced(`meta?${params.toString()}`, () =>
      this.http.get<any>(`${this.base}/meta`, { params }),
    );
  }

  submitIdea(payload: {
    title: string;
    description?: string | null;
    author?: string | null;
    project_url?: string | null;
    keywords?: string[];
    topic_id?: string | null;
    phase?: string | null;
    event?: string | null;
    events?: string[];
    captcha_token?: string | null;
    captcha_answer?: string | null;
    contact?: string | null;
    contact_consent?: boolean;
  }): Observable<{ ok: boolean; moderation: string; node_id: string; upload_token?: string | null; message: string }> {
    return this.http.post<any>(`${this.base}/ideas`, payload);
  }

  /** Holt eine frische Mathe-Captcha-Aufgabe für anonyme Submits.
   * Token + erwartete Antwort liegen serverseitig; das Frontend gibt
   * nur `question` (Klartext) aus und sendet `token + answer` zurück. */
  getCaptcha(): Observable<{ token: string; question: string; ttl_seconds: number }> {
    return this.http.get<any>(`${this.base}/captcha`);
  }

  getInteractions(ideaId: string): Observable<{
    interest: {
      count: number;
      users: { name: string; user_key: string; status: string; approved: boolean; can_edit: boolean }[];
      mine: boolean;
      mine_status: string | null;
      can_manage: boolean;
    };
    follow: { count: number; mine: boolean };
  }> {
    return this.http.get<any>(`${this.base}/ideas/${encodeURIComponent(ideaId)}/interactions`);
  }

  /** Owner/Mod: Mithackende:n annehmen (status) und/oder Bearbeitungsrecht
   *  erteilen (can_edit). */
  setTeamMember(ideaId: string, userKey: string,
                patch: { status?: 'pending' | 'approved'; can_edit?: boolean }):
      Observable<{ ok: boolean }> {
    return this.http.put<any>(
      `${this.base}/ideas/${encodeURIComponent(ideaId)}/team/${encodeURIComponent(userKey)}`,
      patch,
    );
  }

  /** Owner/Mod: Mithackende:n ganz aus dem Team entfernen. */
  removeTeamMember(ideaId: string, userKey: string): Observable<{ ok: boolean }> {
    return this.http.delete<any>(
      `${this.base}/ideas/${encodeURIComponent(ideaId)}/team/${encodeURIComponent(userKey)}`,
    );
  }

  toggleInterest(ideaId: string): Observable<{ state: 'added' | 'removed' }> {
    return this.http.post<any>(`${this.base}/ideas/${encodeURIComponent(ideaId)}/interest`, null);
  }

  toggleFollow(ideaId: string): Observable<{ state: 'added' | 'removed' }> {
    return this.http.post<any>(`${this.base}/ideas/${encodeURIComponent(ideaId)}/follow`, null);
  }

  inbox(filter: 'uncategorized' | 'all' | 'categorized' = 'uncategorized'):
    Observable<{ count: number; items: InboxItem[]; filter: string }> {
    // Mod-only: der authInterceptor hängt den Auth-Header an, _require_moderator gated.
    return this.http.get<any>(`${this.base}/inbox`, { params: { filter } });
  }

  /** Vollständige Review-Vorschau einer Inbox-Einreichung (Mod). Liest direkt
   *  aus edu-sharing und funktioniert daher auch für noch nicht einsortierte
   *  Knoten, die `getIdea` mangels Cache-Eintrag mit 404 quittiert. */
  inboxItemPreview(nodeId: string): Observable<any> {
    return this.http.get<any>(`${this.base}/inbox/${encodeURIComponent(nodeId)}/preview`);
  }

  /** Macht das Original einer Idee öffentlich lesbar — repariert die anonyme
   *  Vorschau/Render nach dem Einsortieren (Mod). */
  publishIdea(ideaId: string): Observable<{ ok: boolean; original_id: string; was_public: boolean }> {
    return this.http.post<any>(
      `${this.base}/moderation/ideas/${encodeURIComponent(ideaId)}/publish`,
      null,
    );
  }

  /** Sync-Differenz App-Cache ↔ edu-sharing (Mod-Diagnose). */
  syncDiff(): Observable<{
    missing: { id: string; title: string; challenge: string }[];
    stale: { id: string; title: string; hidden?: boolean; node_status?: string; source_id?: string }[];
    hidden_stale_count?: number;
    live_count: number; cache_count: number; in_sync: boolean;
  }> {
    return this.http.get<any>(`${this.base}/moderation/sync-diff`);
  }

  /** Karteileichen (verwaiste Cache-Ideen) aus dem App-Cache entfernen (Mod).
   *  `ids` optional → nur diese entfernen; ohne → alle echten Karteileichen. */
  cleanupSyncDiff(ids?: string[]): Observable<{ removed: number; items: { id: string; title: string }[] }> {
    return this.http.post<any>(
      `${this.base}/moderation/sync-diff/cleanup`,
      ids?.length ? { ids } : null,
    );
  }

  deleteInboxItem(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/inbox/${encodeURIComponent(id)}`);
  }

  triggerSync(): Observable<unknown> {
    return this.http.post(`${this.base}/admin/sync`, null);
  }

  // ---- Moderatoren-Anzeige (read-only; verwaltet wird in edu-sharing) ----
  listModerators(): Observable<{
    groups: string[];
    group_status: { group: string; display_name?: string | null; ok: boolean; error?: string | null; count: number }[];
    count: number;
    managed_externally: boolean;
    members: { username: string; first_name?: string; last_name?: string;
               email?: string; source: string }[];
  }> {
    return this.http.get<any>(`${this.base}/admin/moderators`);
  }

  // ---- Taxonomie: Events + Phasen ----
  listPhases(includeInactive = false): Observable<TaxonomyEntry[]> {
    const only = includeInactive ? 'false' : 'true';
    return this.coalesced(`phases?${only}`, () =>
      this.http.get<TaxonomyEntry[]>(`${this.base}/phases`, { params: { only_active: only } }),
    );
  }
  /** Endnutzer-Sicht: live + archived. Mod kann via includeDrafts=true
   * auch Entwürfe sehen. */
  listEvents(opts: { includeInactive?: boolean; includeDrafts?: boolean; includeArchived?: boolean } = {}): Observable<TaxonomyEntry[]> {
    const params: Record<string, string> = {
      only_active: opts.includeInactive ? 'false' : 'true',
      include_archived: opts.includeArchived === false ? 'false' : 'true',
    };
    if (opts.includeDrafts) params['include_drafts'] = 'true';
    // Login optional; nur für include_drafts nötig (Header via authInterceptor).
    return this.coalesced(`events?${JSON.stringify(params)}`, () =>
      this.http.get<TaxonomyEntry[]>(`${this.base}/events`, { params }),
    );
  }

  /** Alle aktuell auf der Startseite hervorgehobenen Events (Liste). */
  featuredEvents(): Observable<FeaturedEvent[]> {
    return this.coalesced('events/featured', () =>
      this.http.get<FeaturedEvent[]>(`${this.base}/events/featured`),
    );
  }

  upsertEvent(entry: TaxonomyEntry): Observable<unknown> {
    return this.http.put(`${this.base}/admin/events/${encodeURIComponent(entry.slug)}`, entry);
  }
  deleteEvent(slug: string): Observable<TaxDeleteResult> {
    return this.http.delete<TaxDeleteResult>(`${this.base}/admin/events/${encodeURIComponent(slug)}`);
  }

  /** Nutzungszahlen je Phase/Veranstaltung (für Lösch-Warnung + Anzeige). */
  taxonomyUsage(): Observable<{ phases: Record<string, number>; events: Record<string, number> }> {
    return this.http.get<any>(`${this.base}/admin/taxonomy-usage`);
  }

  // ---- Profil-Meta (App-seitige Felder pro User) ----
  getMyProfileMeta(): Observable<UserProfileMeta> {
    return this.http.get<UserProfileMeta>(`${this.base}/me/profile-meta`);
  }
  updateMyProfileMeta(body: Partial<UserProfileMeta>): Observable<unknown> {
    return this.http.put(`${this.base}/me/profile-meta`, body);
  }

  upsertPhase(entry: TaxonomyEntry): Observable<unknown> {
    return this.http.put(`${this.base}/admin/phases/${encodeURIComponent(entry.slug)}`, entry);
  }
  deletePhase(slug: string): Observable<TaxDeleteResult> {
    return this.http.delete<TaxDeleteResult>(`${this.base}/admin/phases/${encodeURIComponent(slug)}`);
  }

  // ---- "Mein Bereich" ----
  myIdeas(): Observable<{ count: number; items: Idea[] }> {
    return this.http.get<any>(`${this.base}/me/ideas`);
  }
  myFollows(): Observable<{ count: number; items: Idea[] }> {
    return this.http.get<any>(`${this.base}/me/follows`);
  }
  myInterest(): Observable<{ count: number; items: Idea[] }> {
    return this.http.get<any>(`${this.base}/me/interest`);
  }
  /** Mithack-Anfragen + Team auf den eigenen Ideen (für „Mein Bereich"). */
  myTeamRequests(): Observable<{
    count: number; pending: number;
    items: { idea_id: string; idea_title: string; user_key: string; name: string;
             status: string; approved: boolean; can_edit: boolean; created_at: string }[];
  }> {
    return this.http.get<any>(`${this.base}/me/team-requests`);
  }
  // ---- Backup / Restore ----
  listBackups(): Observable<{
    backups: {
      filename: string; size: number; created_at: string;
      metadata: any;
    }[];
    keep: number; interval_hours: number; enabled: boolean;
  }> {
    return this.http.get<any>(`${this.base}/admin/backups`);
  }
  createBackup(): Observable<{ ok: boolean; filename: string; size: number }> {
    return this.http.post<any>(`${this.base}/admin/backup`, null);
  }
  deleteBackup(filename: string): Observable<{ ok: boolean }> {
    return this.http.delete<any>(`${this.base}/admin/backups/${encodeURIComponent(filename)}`);
  }
  /** Backup-Download-URL — direkt im Browser via <a href> öffnen, mit Auth-Header.
   *  Hinweis: weil Auth-Header bei direkten <a>-Klicks nicht funktioniert, holen
   *  wir die Datei via blob, erzeugen eine Object-URL und triggern download. */
  downloadBackup(filename: string): Observable<Blob> {
    return this.http.get(`${this.base}/admin/backups/${encodeURIComponent(filename)}`, {
      responseType: 'blob',
    });
  }
  restoreBackup(file: File): Observable<{
    ok: boolean; restored_metadata: any; size: number;
  }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.base}/admin/backups/restore`, fd);
  }

  adminStats(): Observable<{
    totals: {
      ideas: number; themes: number; challenges: number;
      comments: number; ratings: number;
      interest: number; follow: number; avg_rating: number;
    };
    phases: { phase: string; count: number }[];
    events: { event: string; count: number }[];
    weekly: { week: string; count: number }[];
    top_actors: { actor: string; count: number }[];
    top_ideas: { id: string; title: string; rating_avg: number;
                 rating_count: number; comment_count: number;
                 interest_count: number }[];
    reports: { open: number; resolved: number };
    actions_30d: { action: string; count: number }[];
  }> {
    return this.http.get<any>(`${this.base}/admin/stats`);
  }

  myActivity(): Observable<{
    count: number;
    items: { id: number; ts: string; actor: string | null; is_mod: number;
             action: string; target_type: string | null; target_id: string | null;
             target_label: string | null; detail: any }[];
  }> {
    return this.http.get<any>(`${this.base}/me/activity`);
  }

  uploadIdeaContent(ideaId: string, file: File): Observable<{ ok: boolean; size: number; name: string }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.base}/ideas/${encodeURIComponent(ideaId)}/content`, fd);
  }

  uploadIdeaPreview(ideaId: string, image: File, uploadToken?: string | null): Observable<{ ok: boolean }> {
    const fd = new FormData();
    fd.append('file', image, image.name);
    // Anonyme Einreicher weisen sich über das beim Submit erhaltene Token aus.
    if (uploadToken) fd.append('upload_token', uploadToken);
    return this.http.post<any>(`${this.base}/ideas/${encodeURIComponent(ideaId)}/preview`, fd);
  }

  /**
   * Lädt einen Anhang direkt als Child-IO (Serienobjekt-Pattern) unter die
   * Idee. Vorher gab es einen separaten "Anhänge-Sammlung anlegen"-Schritt
   * — dieser entfällt mit `ccm:childio`/`ccm:io_childobject`.
   */
  uploadAttachment(ideaId: string, file: File, uploadToken?: string | null): Observable<{
    ok: boolean; node_id: string; name: string; size: number;
  }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    // Anonyme Einreicher weisen sich über das beim Submit erhaltene Token aus.
    if (uploadToken) fd.append('upload_token', uploadToken);
    return this.http.post<any>(`${this.base}/ideas/${encodeURIComponent(ideaId)}/attachments/upload`, fd);
  }

  // ---- Idee bearbeiten ----
  editIdea(id: string, patch: {
    title?: string;
    description?: string;
    author?: string;
    project_url?: string;
    keywords?: string[];
    phase?: string;
    event?: string;
    events?: string[];
  }): Observable<{ ok: boolean; node_id: string }> {
    return this.http.patch<any>(`${this.base}/ideas/${encodeURIComponent(id)}`, patch);
  }

  moveInboxItem(nodeId: string, targetTopicId: string): Observable<{ ok: boolean; moved_to: string }> {
    return this.http.post<any>(
      `${this.base}/moderation/move`,
      { node_id: nodeId, target_topic_id: targetTopicId },
    );
  }

  // Self-registration läuft aktuell extern über
  // https://wirlernenonline.de/register/ — siehe LoginDialog. Der edu-sharing
  // /register/v1/register-Endpoint auf Prod läuft deterministisch in einen
  // 50s-Server-Disconnect (Mail-Hook hängt), deshalb kein direkter Proxy hier.

  listIdeas(opts: {
    topic_id?: string;
    phase?: string;
    event?: string;
    category?: string;
    q?: string;
    ids?: string;
    sort?: SortBy;
    order?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  } = {}): Observable<IdeaList> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    }
    return this.http.get<IdeaList>(`${this.base}/ideas`, { params });
  }

  getIdea(id: string): Observable<Idea> {
    return this.http.get<Idea>(`${this.base}/ideas/${encodeURIComponent(id)}`);
  }

  deleteIdea(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<any>(`${this.base}/ideas/${encodeURIComponent(id)}`);
  }

  deleteAttachment(ideaId: string, attachmentId: string): Observable<{ ok: boolean }> {
    return this.http.delete<any>(
      `${this.base}/ideas/${encodeURIComponent(ideaId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }

  reportIdea(id: string, reason: string): Observable<{ ok: boolean }> {
    return this.http.post<any>(`${this.base}/ideas/${encodeURIComponent(id)}/report`, { reason });
  }

  listReports(): Observable<{
    count: number;
    items: { id: number; idea_id: string; reason: string;
             reporter: string | null; created_at: string; title: string | null }[];
  }> {
    return this.http.get<any>(`${this.base}/admin/reports`);
  }
  resolveReport(id: number): Observable<{ ok: boolean }> {
    return this.http.post<any>(`${this.base}/admin/reports/${id}/resolve`, null);
  }

  // ---- Topic-CRUD (Mod-only) ----
  createTopic(payload: { parent_id?: string | null; title: string;
                          description?: string | null; color?: string | null }):
      Observable<{ ok: boolean; id: string }> {
    return this.http.post<any>(`${this.base}/admin/topics`, payload);
  }
  editTopic(id: string, patch: { title?: string; description?: string;
                                  color?: string }): Observable<{ ok: boolean }> {
    return this.http.patch<any>(`${this.base}/admin/topics/${encodeURIComponent(id)}`, patch);
  }
  deleteTopic(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<any>(`${this.base}/admin/topics/${encodeURIComponent(id)}`);
  }
  sortTopics(items: { id: string; sort_order: number }[]):
      Observable<{ ok: boolean; updated: number }> {
    return this.http.put<any>(`${this.base}/admin/topics/sort`, items);
  }
  uploadTopicPreview(id: string, image: File): Observable<{ ok: boolean }> {
    const fd = new FormData();
    fd.append('file', image, image.name);
    return this.http.post<any>(`${this.base}/admin/topics/${encodeURIComponent(id)}/preview`, fd);
  }

  bulkMove(nodeIds: string[], targetTopicId: string): Observable<{
    ok: boolean; moved_to: string;
    succeeded: string[]; failed: { id: string; status: number; detail: string }[];
    succeeded_count: number; failed_count: number;
  }> {
    return this.http.post<any>(`${this.base}/moderation/bulk_move`,
      { node_ids: nodeIds, target_topic_id: targetTopicId },
    );
  }

  renameAttachment(ideaId: string, attachmentId: string, name: string):
      Observable<{ ok: boolean; name: string }> {
    return this.http.patch<any>(
      `${this.base}/ideas/${encodeURIComponent(ideaId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { name },
    );
  }

  /** Tauscht die Datei eines bestehenden Anhangs aus (neue Version). */
  replaceAttachment(ideaId: string, attachmentId: string, file: File):
      Observable<{ ok: boolean; name: string; size: number }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.put<any>(
      `${this.base}/ideas/${encodeURIComponent(ideaId)}/attachments/${encodeURIComponent(attachmentId)}/content`,
      fd,
    );
  }

  listActivity(opts: {
    action?: string; actor?: string; target_id?: string;
    since?: string; limit?: number; offset?: number;
  } = {}): Observable<{
    total: number; limit: number; offset: number;
    actions: string[];
    items: {
      id: number; ts: string; actor: string | null; is_mod: number;
      action: string; target_type: string | null; target_id: string | null;
      target_label: string | null; detail: any;
    }[];
  }> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    }
    return this.http.get<any>(`${this.base}/admin/activity`, { params });
  }

  ranking(opts: { sort?: 'rating' | 'comments' | 'interest' | 'likes';
                  event?: string | null; limit?: number;
                  basis?: 'decay' | 'absolute' } = {}):
      Observable<{
        sort: string;
        event: string | null;
        snapshot_at?: string;
        previous_snapshot_at?: string;
        snapshots: string[];
        items: {
          rank: number;
          prev_rank: number | null;
          delta: number | null;
          score: number;
          score_decay?: number;
          score_absolute?: number;
          idea: Idea | null;
          history: { at: string; score: number; rank: number }[];
        }[];
      }> {
    let params = new HttpParams();
    if (opts.sort)  params = params.set('sort', opts.sort);
    if (opts.event) params = params.set('event', opts.event);
    if (opts.limit) params = params.set('limit', String(opts.limit));
    if (opts.basis) params = params.set('basis', opts.basis);
    return this.http.get<any>(`${this.base}/ranking`, { params });
  }

  rateIdea(id: string, rating: number, text = ''): Observable<unknown> {
    const params = new HttpParams().set('rating', rating).set('text', text);
    return this.http.post(`${this.base}/ideas/${encodeURIComponent(id)}/rating`, null, { params });
  }

  /** Eigene Bewertung/Like zurücknehmen (Daumen-Modus). Backend toleriert
   * den edu-sharing-500-Bug und liefert trotzdem 200. */
  unrateIdea(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/ideas/${encodeURIComponent(id)}/rating`);
  }

  /** Kontakt einer Idee setzen/ändern (leer = löschen). Nur Owner/Mod. */
  setIdeaContact(id: string, contact: string | null): Observable<{ ok: boolean; contact: string | null }> {
    return this.http.put<any>(`${this.base}/ideas/${encodeURIComponent(id)}/contact`, { contact });
  }

  // ---- App-Settings (Voting-Modus) ----
  getSettings(): Observable<import('./models').AppSettings> {
    return this.coalesced('settings', () =>
      this.http.get<import('./models').AppSettings>(`${this.base}/settings`),
    );
  }
  updateSettings(body: Partial<import('./models').AppSettings>): Observable<unknown> {
    return this.http.put(`${this.base}/admin/settings`, body);
  }

  commentIdea(id: string, comment: string, replyTo?: string): Observable<unknown> {
    let params = new HttpParams().set('comment', comment);
    if (replyTo) params = params.set('reply_to', replyTo);
    return this.http.post(`${this.base}/ideas/${encodeURIComponent(id)}/comments`, null, { params });
  }

  refreshIdea(ideaId: string): Observable<{ ok: boolean }> {
    return this.http.post<any>(`${this.base}/ideas/${encodeURIComponent(ideaId)}/refresh`, null);
  }

  /** Wechselt die Herausforderung einer Idee (Reference umhängen).
   *  Nur für Mods. Idempotent bei gleichbleibendem Topic. */
  changeIdeaTopic(ideaId: string, newTopicId: string): Observable<{
    ok: boolean; moved_to?: string; result_id?: string; old_ref_deleted?: boolean;
    no_op?: boolean; message?: string;
  }> {
    return this.http.post<any>(
      `${this.base}/moderation/ideas/${encodeURIComponent(ideaId)}/change-topic`,
      { new_topic_id: newTopicId },
    );
  }

  /** Pflicht-Metadaten (Lizenz/Sprache/...) für die WLO-Freischaltung
   *  bei bestehenden Ideen (Bulk) nachpflegen. Mod-only. */
  backfillPublicationMetaBulk(limit = 200): Observable<{
    ok: boolean; processed: number; updated: number; errors: any[];
  }> {
    return this.http.post<any>(
      `${this.base}/admin/ideas/backfill-publication-meta?limit=${limit}`,
      {},
    );
  }

  deleteComment(commentId: string, ideaId?: string): Observable<unknown> {
    let params = new HttpParams();
    if (ideaId) params = params.set('idea_id', ideaId);
    return this.http.delete(`${this.base}/comments/${encodeURIComponent(commentId)}`, { params });
  }

  ideaReportStatus(ideaId: string): Observable<{
    reported: boolean; created_at?: string; resolved_at?: string | null;
    status?: 'open' | 'resolved';
  }> {
    return this.http.get<any>(`${this.base}/ideas/${encodeURIComponent(ideaId)}/report-status`);
  }

  rankingRisers(opts: { sort?: 'rating' | 'comments' | 'interest' | 'likes';
                         event?: string | null; days?: number; limit?: number; }): Observable<{
    count: number; items: any[]; latest?: string; previous?: string | null;
  }> {
    let params = new HttpParams();
    if (opts.sort) params = params.set('sort', opts.sort);
    if (opts.event) params = params.set('event', opts.event);
    if (opts.days) params = params.set('days', String(opts.days));
    if (opts.limit) params = params.set('limit', String(opts.limit));
    return this.http.get<any>(`${this.base}/ranking/risers`, { params });
  }

  publicUserProfile(username: string): Observable<{
    username: string;
    stats: { ideas: number; comments: number; ratings: number; avg_rating: number };
    last_activity?: string;
    ideas: Idea[];
  }> {
    return this.http.get<any>(`${this.base}/users/${encodeURIComponent(username)}`);
  }

  // ---- Hidden-Verwaltung (Mod) ----
  listHiddenIdeas(): Observable<{ count: number; items: {
    id: string; title: string; owner_username?: string;
    hidden_reason?: string; modified_at?: string;
  }[] }> {
    return this.http.get<any>(`${this.base}/admin/hidden-ideas`);
  }

  hideIdea(ideaId: string, reason?: string): Observable<{ ok: boolean }> {
    return this.http.post<any>(
      `${this.base}/admin/ideas/${encodeURIComponent(ideaId)}/hide`,
      reason ? { reason } : {},
    );
  }

  unhideIdea(ideaId: string): Observable<{ ok: boolean }> {
    return this.http.post<any>(`${this.base}/admin/ideas/${encodeURIComponent(ideaId)}/unhide`, {});
  }

  /** Alle Ideen inkl. versteckte (Mod) — für die Sichtbarkeits-Verwaltung. */
  allIdeasAdmin(q?: string): Observable<{ count: number; items: {
    id: string; title: string; owner_username?: string;
    hidden: number; hidden_reason?: string; modified_at?: string;
  }[] }> {
    const params = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    return this.http.get<any>(`${this.base}/admin/all-ideas${params}`);
  }

  // ---- Notifications ----
  unseenNotifications(): Observable<{ count: number; last_seen?: string }> {
    return this.http.get<any>(`${this.base}/me/notifications/unseen`);
  }

  markNotificationsSeen(): Observable<{ ok: boolean; last_seen: string }> {
    return this.http.post<any>(`${this.base}/me/notifications/seen`, null);
  }
}
