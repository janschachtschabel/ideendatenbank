import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Idea, IdeaList, InboxItem, SortBy, TaxonomyEntry, Topic } from './models';

/**
 * Default API base. Relative so the web component works out-of-the-box when
 * the bundle is served same-origin from FastAPI. For dev (ng serve on 4201
 * + uvicorn on 8000) set `api-base="http://127.0.0.1:8000/api/v1"` on the
 * host tag, or configure a proxy.
 */
export const API_BASE_DEFAULT = '/api/v1';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  base = API_BASE_DEFAULT;

  setBase(url: string) {
    this.base = url.replace(/\/+$/, '');
  }

  /** HTTP Basic-Auth header. Persisted per browser tab in sessionStorage. */
  private static STORAGE_KEY = 'ideendb.auth';
  private authHeader: string | null = this.loadStoredAuth();

  private loadStoredAuth(): string | null {
    try { return sessionStorage.getItem(ApiService.STORAGE_KEY); }
    catch { return null; }
  }

  private _user: string | null = this.loadStoredUser();
  private loadStoredUser(): string | null {
    try { return sessionStorage.getItem(ApiService.STORAGE_KEY + '.user'); }
    catch { return null; }
  }

  setCredentials(user: string, pass: string) {
    this.authHeader = 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
    this._user = user;
    try {
      sessionStorage.setItem(ApiService.STORAGE_KEY, this.authHeader);
      sessionStorage.setItem(ApiService.STORAGE_KEY + '.user', user);
    } catch { /* quota */ }
  }
  clearCredentials() {
    this.authHeader = null;
    this._user = null;
    this._isModerator = false;
    try {
      sessionStorage.removeItem(ApiService.STORAGE_KEY);
      sessionStorage.removeItem(ApiService.STORAGE_KEY + '.user');
    } catch { /* */ }
  }
  hasCredentials() { return this.authHeader !== null; }
  currentUser(): string | null { return this._user; }

  /** Cache für /me-Response, geladen nach Login. */
  private _isModerator = false;
  isModerator(): boolean { return this._isModerator; }

  refreshMe(): Observable<{ authenticated: boolean; username?: string; is_moderator?: boolean }> {
    return new Observable((sub) => {
      this.http.get<any>(`${this.base}/me`, { headers: this.authHeaders() }).subscribe({
        next: (r) => {
          this._isModerator = !!r.is_moderator;
          sub.next(r);
          sub.complete();
        },
        error: (e) => {
          this._isModerator = false;
          sub.error(e);
        },
      });
    });
  }

  private authHeaders(): Record<string, string> {
    return this.authHeader ? { Authorization: this.authHeader } : {};
  }

  topics(): Observable<Topic[]> {
    return this.http.get<Topic[]>(`${this.base}/topics`);
  }

  topicDetail(id: string): Observable<{ topic: Topic; parent: Topic | null; children: Topic[] }> {
    return this.http.get<{ topic: Topic; parent: Topic | null; children: Topic[] }>(
      `${this.base}/topics/${id}`,
    );
  }

  meta(topicId?: string | null): Observable<{
    phases: { value: string; count: number }[];
    events: { value: string; count: number }[];
    categories: { value: string; count: number }[];
  }> {
    let params = new HttpParams();
    if (topicId) params = params.set('topic_id', topicId);
    return this.http.get<any>(`${this.base}/meta`, { params });
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
  }): Observable<{ ok: boolean; moderation: string; node_id: string; message: string }> {
    return this.http.post<any>(`${this.base}/ideas`, payload, {
      headers: this.authHeaders(),
    });
  }

  getInteractions(ideaId: string): Observable<{
    interest: { count: number; users: { name: string; user_key: string }[]; mine: boolean };
    follow: { count: number; mine: boolean };
  }> {
    return this.http.get<any>(`${this.base}/ideas/${ideaId}/interactions`, {
      headers: this.authHeaders(),
    });
  }

  toggleInterest(ideaId: string): Observable<{ state: 'added' | 'removed' }> {
    return this.http.post<any>(`${this.base}/ideas/${ideaId}/interest`, null, {
      headers: this.authHeaders(),
    });
  }

  toggleFollow(ideaId: string): Observable<{ state: 'added' | 'removed' }> {
    return this.http.post<any>(`${this.base}/ideas/${ideaId}/follow`, null, {
      headers: this.authHeaders(),
    });
  }

  inbox(): Observable<{ count: number; items: InboxItem[] }> {
    // Auth-Header ist Pflicht — _require_moderator gated den Endpoint.
    return this.http.get<any>(`${this.base}/inbox`, {
      headers: this.authHeaders(),
    });
  }

  deleteInboxItem(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/inbox/${id}`, { headers: this.authHeaders() });
  }

  triggerSync(): Observable<unknown> {
    return this.http.post(`${this.base}/admin/sync`, null, {
      headers: this.authHeaders(),
    });
  }

  // ---- Moderatoren-Anzeige (read-only; verwaltet wird in edu-sharing) ----
  listModerators(): Observable<{
    groups: string[];
    group_status: { group: string; ok: boolean; error?: string | null; count: number }[];
    count: number;
    managed_externally: boolean;
    members: { username: string; first_name?: string; last_name?: string;
               email?: string; source: string }[];
  }> {
    return this.http.get<any>(`${this.base}/admin/moderators`, {
      headers: this.authHeaders(),
    });
  }

  // ---- Taxonomie: Events + Phasen ----
  listPhases(includeInactive = false): Observable<TaxonomyEntry[]> {
    return this.http.get<TaxonomyEntry[]>(`${this.base}/phases`, {
      params: { only_active: includeInactive ? 'false' : 'true' },
    });
  }
  listEvents(includeInactive = false): Observable<TaxonomyEntry[]> {
    return this.http.get<TaxonomyEntry[]>(`${this.base}/events`, {
      params: { only_active: includeInactive ? 'false' : 'true' },
    });
  }

  upsertEvent(entry: TaxonomyEntry): Observable<unknown> {
    return this.http.put(`${this.base}/admin/events/${entry.slug}`, entry, {
      headers: this.authHeaders(),
    });
  }
  deleteEvent(slug: string): Observable<unknown> {
    return this.http.delete(`${this.base}/admin/events/${slug}`, {
      headers: this.authHeaders(),
    });
  }

  upsertPhase(entry: TaxonomyEntry): Observable<unknown> {
    return this.http.put(`${this.base}/admin/phases/${entry.slug}`, entry, {
      headers: this.authHeaders(),
    });
  }
  deletePhase(slug: string): Observable<unknown> {
    return this.http.delete(`${this.base}/admin/phases/${slug}`, {
      headers: this.authHeaders(),
    });
  }

  // ---- "Mein Bereich" ----
  myIdeas(): Observable<{ count: number; items: Idea[] }> {
    return this.http.get<any>(`${this.base}/me/ideas`, { headers: this.authHeaders() });
  }
  myFollows(): Observable<{ count: number; items: Idea[] }> {
    return this.http.get<any>(`${this.base}/me/follows`, { headers: this.authHeaders() });
  }
  myInterest(): Observable<{ count: number; items: Idea[] }> {
    return this.http.get<any>(`${this.base}/me/interest`, { headers: this.authHeaders() });
  }
  // ---- Backup / Restore ----
  listBackups(): Observable<{
    backups: {
      filename: string; size: number; created_at: string;
      metadata: any;
    }[];
    keep: number; interval_hours: number; enabled: boolean;
  }> {
    return this.http.get<any>(`${this.base}/admin/backups`, {
      headers: this.authHeaders(),
    });
  }
  createBackup(): Observable<{ ok: boolean; filename: string; size: number }> {
    return this.http.post<any>(`${this.base}/admin/backup`, null, {
      headers: this.authHeaders(),
    });
  }
  deleteBackup(filename: string): Observable<{ ok: boolean }> {
    return this.http.delete<any>(`${this.base}/admin/backups/${encodeURIComponent(filename)}`, {
      headers: this.authHeaders(),
    });
  }
  /** Backup-Download-URL — direkt im Browser via <a href> öffnen, mit Auth-Header.
   *  Hinweis: weil Auth-Header bei direkten <a>-Klicks nicht funktioniert, holen
   *  wir die Datei via blob, erzeugen eine Object-URL und triggern download. */
  downloadBackup(filename: string): Observable<Blob> {
    return this.http.get(`${this.base}/admin/backups/${encodeURIComponent(filename)}`, {
      headers: this.authHeaders(),
      responseType: 'blob',
    });
  }
  restoreBackup(file: File): Observable<{
    ok: boolean; restored_metadata: any; size: number;
  }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.base}/admin/backups/restore`, fd, {
      headers: this.authHeaders(),
    });
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
    return this.http.get<any>(`${this.base}/admin/stats`, {
      headers: this.authHeaders(),
    });
  }

  myActivity(): Observable<{
    count: number;
    items: { id: number; ts: string; actor: string | null; is_mod: number;
             action: string; target_type: string | null; target_id: string | null;
             target_label: string | null; detail: any }[];
  }> {
    return this.http.get<any>(`${this.base}/me/activity`, { headers: this.authHeaders() });
  }

  uploadIdeaContent(ideaId: string, file: File): Observable<{ ok: boolean; size: number; name: string }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.base}/ideas/${ideaId}/content`, fd, {
      headers: this.authHeaders(),
    });
  }

  uploadIdeaPreview(ideaId: string, image: File): Observable<{ ok: boolean }> {
    const fd = new FormData();
    fd.append('file', image, image.name);
    return this.http.post<any>(`${this.base}/ideas/${ideaId}/preview`, fd, {
      headers: this.authHeaders(),
    });
  }

  /**
   * Lädt einen Anhang direkt als Child-IO (Serienobjekt-Pattern) unter die
   * Idee. Vorher gab es einen separaten "Anhänge-Sammlung anlegen"-Schritt
   * — dieser entfällt mit `ccm:childio`/`ccm:io_childobject`.
   */
  uploadAttachment(ideaId: string, file: File): Observable<{
    ok: boolean; node_id: string; name: string; size: number;
  }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.base}/ideas/${ideaId}/attachments/upload`, fd, {
      headers: this.authHeaders(),
    });
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
    return this.http.patch<any>(`${this.base}/ideas/${id}`, patch, {
      headers: this.authHeaders(),
    });
  }

  moveInboxItem(nodeId: string, targetTopicId: string): Observable<{ ok: boolean; moved_to: string }> {
    return this.http.post<any>(
      `${this.base}/moderation/move`,
      { node_id: nodeId, target_topic_id: targetTopicId },
      { headers: this.authHeaders() },
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
    return this.http.get<Idea>(`${this.base}/ideas/${id}`, {
      headers: this.authHeaders(),
    });
  }

  deleteIdea(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<any>(`${this.base}/ideas/${id}`, {
      headers: this.authHeaders(),
    });
  }

  duplicateIdea(id: string): Observable<{ ok: boolean; node_id: string }> {
    return this.http.post<any>(`${this.base}/ideas/${id}/duplicate`, null, {
      headers: this.authHeaders(),
    });
  }

  deleteAttachment(ideaId: string, attachmentId: string): Observable<{ ok: boolean }> {
    return this.http.delete<any>(
      `${this.base}/ideas/${ideaId}/attachments/${attachmentId}`,
      { headers: this.authHeaders() },
    );
  }

  reportIdea(id: string, reason: string): Observable<{ ok: boolean }> {
    return this.http.post<any>(
      `${this.base}/ideas/${id}/report`,
      { reason },
      { headers: this.authHeaders() },
    );
  }

  listReports(): Observable<{
    count: number;
    items: { id: number; idea_id: string; reason: string;
             reporter: string | null; created_at: string; title: string | null }[];
  }> {
    return this.http.get<any>(`${this.base}/admin/reports`, {
      headers: this.authHeaders(),
    });
  }
  resolveReport(id: number): Observable<{ ok: boolean }> {
    return this.http.post<any>(`${this.base}/admin/reports/${id}/resolve`, null, {
      headers: this.authHeaders(),
    });
  }

  // ---- Topic-CRUD (Mod-only) ----
  createTopic(payload: { parent_id?: string | null; title: string;
                          description?: string | null; color?: string | null }):
      Observable<{ ok: boolean; id: string }> {
    return this.http.post<any>(`${this.base}/admin/topics`, payload, {
      headers: this.authHeaders(),
    });
  }
  editTopic(id: string, patch: { title?: string; description?: string;
                                  color?: string }): Observable<{ ok: boolean }> {
    return this.http.patch<any>(`${this.base}/admin/topics/${id}`, patch, {
      headers: this.authHeaders(),
    });
  }
  deleteTopic(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<any>(`${this.base}/admin/topics/${id}`, {
      headers: this.authHeaders(),
    });
  }
  sortTopics(items: { id: string; sort_order: number }[]):
      Observable<{ ok: boolean; updated: number }> {
    return this.http.put<any>(`${this.base}/admin/topics/sort`, items, {
      headers: this.authHeaders(),
    });
  }
  uploadTopicPreview(id: string, image: File): Observable<{ ok: boolean }> {
    const fd = new FormData();
    fd.append('file', image, image.name);
    return this.http.post<any>(`${this.base}/admin/topics/${id}/preview`, fd, {
      headers: this.authHeaders(),
    });
  }

  bulkMove(nodeIds: string[], targetTopicId: string): Observable<{
    ok: boolean; moved_to: string;
    succeeded: string[]; failed: { id: string; status: number; detail: string }[];
    succeeded_count: number; failed_count: number;
  }> {
    return this.http.post<any>(`${this.base}/moderation/bulk_move`,
      { node_ids: nodeIds, target_topic_id: targetTopicId },
      { headers: this.authHeaders() },
    );
  }

  renameAttachment(ideaId: string, attachmentId: string, name: string):
      Observable<{ ok: boolean; name: string }> {
    return this.http.patch<any>(
      `${this.base}/ideas/${ideaId}/attachments/${attachmentId}`,
      { name },
      { headers: this.authHeaders() },
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
    return this.http.get<any>(`${this.base}/admin/activity`, {
      headers: this.authHeaders(),
      params,
    });
  }

  ranking(opts: { sort?: 'rating' | 'comments' | 'interest';
                  event?: string | null; limit?: number } = {}):
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
          idea: Idea | null;
          history: { at: string; score: number; rank: number }[];
        }[];
      }> {
    let params = new HttpParams();
    if (opts.sort)  params = params.set('sort', opts.sort);
    if (opts.event) params = params.set('event', opts.event);
    if (opts.limit) params = params.set('limit', String(opts.limit));
    return this.http.get<any>(`${this.base}/ranking`, { params });
  }

  rateIdea(id: string, rating: number, text = ''): Observable<unknown> {
    const params = new HttpParams().set('rating', rating).set('text', text);
    return this.http.post(`${this.base}/ideas/${id}/rating`, null, {
      params,
      headers: this.authHeaders(),
    });
  }

  commentIdea(id: string, comment: string, replyTo?: string): Observable<unknown> {
    let params = new HttpParams().set('comment', comment);
    if (replyTo) params = params.set('reply_to', replyTo);
    return this.http.post(`${this.base}/ideas/${id}/comments`, null, {
      params,
      headers: this.authHeaders(),
    });
  }

  refreshIdea(ideaId: string): Observable<{ ok: boolean }> {
    return this.http.post<any>(`${this.base}/ideas/${ideaId}/refresh`, null, {
      headers: this.authHeaders(),
    });
  }

  /** Pflicht-Metadaten (Lizenz/Sprache/...) für die WLO-Freischaltung
   *  bei bestehenden Ideen nachpflegen. Single oder Bulk. Mod-only. */
  backfillPublicationMeta(ideaId: string): Observable<{ ok: boolean; changed: boolean; fields: string[] }> {
    return this.http.post<any>(
      `${this.base}/admin/ideas/${ideaId}/backfill-publication-meta`,
      {}, { headers: this.authHeaders() });
  }
  backfillPublicationMetaBulk(limit = 200): Observable<{
    ok: boolean; processed: number; updated: number; errors: any[];
  }> {
    return this.http.post<any>(
      `${this.base}/admin/ideas/backfill-publication-meta?limit=${limit}`,
      {}, { headers: this.authHeaders() });
  }

  deleteComment(commentId: string, ideaId?: string): Observable<unknown> {
    let params = new HttpParams();
    if (ideaId) params = params.set('idea_id', ideaId);
    return this.http.delete(`${this.base}/comments/${commentId}`, {
      params,
      headers: this.authHeaders(),
    });
  }

  phaseHistory(ideaId: string): Observable<{ count: number;
    items: { ts: string; actor?: string | null; from?: string | null; to?: string | null }[] }> {
    return this.http.get<any>(`${this.base}/ideas/${ideaId}/phase-history`);
  }

  myReports(): Observable<{ count: number; items: {
    id: number; idea_id: string; idea_title?: string; reason: string;
    created_at: string; resolved_at?: string | null;
  }[] }> {
    return this.http.get<any>(`${this.base}/me/reports`, { headers: this.authHeaders() });
  }

  ideaReportStatus(ideaId: string): Observable<{
    reported: boolean; created_at?: string; resolved_at?: string | null;
    status?: 'open' | 'resolved';
  }> {
    return this.http.get<any>(`${this.base}/ideas/${ideaId}/report-status`, {
      headers: this.authHeaders(),
    });
  }

  bulkResolveReports(ids: number[]): Observable<{ ok: boolean; count: number }> {
    return this.http.post<any>(`${this.base}/admin/reports/bulk-resolve`, { ids }, {
      headers: this.authHeaders(),
    });
  }

  rankingRisers(opts: { sort?: 'rating' | 'comments' | 'interest';
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
    return this.http.get<any>(`${this.base}/admin/hidden-ideas`, {
      headers: this.authHeaders(),
    });
  }

  hideIdea(ideaId: string, reason?: string): Observable<{ ok: boolean }> {
    return this.http.post<any>(
      `${this.base}/admin/ideas/${ideaId}/hide`,
      reason ? { reason } : {},
      { headers: this.authHeaders() },
    );
  }

  unhideIdea(ideaId: string): Observable<{ ok: boolean }> {
    return this.http.post<any>(
      `${this.base}/admin/ideas/${ideaId}/unhide`,
      {},
      { headers: this.authHeaders() },
    );
  }

  // ---- Notifications ----
  unseenNotifications(): Observable<{ count: number; last_seen?: string }> {
    return this.http.get<any>(`${this.base}/me/notifications/unseen`, {
      headers: this.authHeaders(),
    });
  }

  markNotificationsSeen(): Observable<{ ok: boolean; last_seen: string }> {
    return this.http.post<any>(`${this.base}/me/notifications/seen`, null, {
      headers: this.authHeaders(),
    });
  }
}
