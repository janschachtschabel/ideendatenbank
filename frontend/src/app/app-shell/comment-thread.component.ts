import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { Comment } from '../models';
import { initialsOf } from '../format-utils';

/**
 * Kommentar-Thread der Idee-Detailseite — aus idea-detail.component.ts
 * herausgelöst (verhaltensgleich). Flacher 1-Level-Thread (Antworten
 * hängen am Thread-Root), Löschen für Verfasser:in + Moderation.
 * Die Kommentare kommen als Input von der Detail-Ladung; nach jeder
 * Mutation feuert (changed) und der Parent lädt die Idee neu — die
 * frische Liste fließt dann über den Input zurück.
 */
@Component({
  selector: 'ideendb-comment-thread',
  standalone: true,
  imports: [FormsModule],
  styles: [`
    :host { display: block; }
    .card { background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px;
            padding: 28px; }
    .card h2 { margin: 0 0 16px; font-size: 1.2rem; color: var(--wlo-text); }
    .error {
      margin-top: 8px;
      color: #b00020; font-size: .85rem;
      background: #fff0f0; border: 1px solid #e1a5ac;
      padding: 6px 10px; border-radius: 6px;
    }
    .comments-card { margin-top: 24px; }
    .comments-card h2 { display: flex; align-items: baseline; gap: 10px; }
    .comments-card h2 small { color: var(--wlo-muted); font-weight: 400; font-size: .85rem; }
    .comment-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    textarea { width: 100%; border: 1px solid var(--wlo-border); border-radius: 8px; padding: 12px;
               resize: vertical; min-height: 80px; box-sizing: border-box; font: inherit; }
    textarea:focus { outline: none; border-color: var(--wlo-primary); }
    .comment-form .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .submit-btn { background: var(--wlo-primary); color: #fff; border: none;
                  padding: 10px 22px; border-radius: 8px; font-weight: 600; cursor: pointer;
                  &:hover:not(:disabled) { background: var(--wlo-primary-600); }
                  &:disabled { opacity: .5; cursor: not-allowed; } }
    .comment { padding: 14px 0; border-top: 1px solid var(--wlo-border); display: flex; gap: 12px; }
    .comment.reply { margin-left: 48px; border-top: none; border-left: 2px solid var(--wlo-border);
                     padding-left: 12px; background: var(--wlo-bg); border-radius: 6px; margin-top: 4px; }
    .reply-hint { background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary); padding: 1px 8px; border-radius: 999px;
                  font-size: .72rem; font-weight: 600; margin-left: 8px; }
    .reply-btn { background: none; border: none; color: var(--wlo-primary); cursor: pointer;
                 font-weight: 600; font-size: .82rem; padding: 4px 0; margin-top: 6px;
                 &:hover { text-decoration: underline; }
                 &.danger { color: var(--wlo-danger, #c5221f); margin-left: 12px; }
                 &:disabled { opacity: .5; cursor: progress; } }
    .reply-form { margin-top: 10px; display: flex; flex-direction: column; gap: 8px;
                  align-items: flex-end; }
    .reply-form textarea { min-height: 60px; }
    .reply-form .submit-btn { background: var(--wlo-primary); color: #fff; border: none;
                              padding: 8px 16px; border-radius: 6px; font-weight: 600;
                              cursor: pointer; font-size: .88rem;
                              &:hover:not(:disabled) { background: var(--wlo-primary-600); }
                              &:disabled { opacity: .5; cursor: not-allowed; } }
    .comment .avatar {
      flex: 0 0 36px; height: 36px; width: 36px; border-radius: 50%;
      background: var(--wlo-primary); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: .85rem;
    }
    .comment .body { flex: 1; min-width: 0; }
    .comment .who { font-weight: 600; color: var(--wlo-primary); font-size: .9rem; }
    .comment .when { color: var(--wlo-muted); font-size: .78rem; margin-left: 8px; }
    .comment .text { margin-top: 4px; color: var(--wlo-text); white-space: pre-wrap; word-wrap: break-word; }

    .notice { background: var(--wlo-accent-soft, #fff8db); border: 1px solid #f5b600; border-radius: 8px;
              padding: 10px 14px; font-size: .88rem; color: #5c4a00; }
    .error { color: #b00020; font-size: .88rem; margin-top: 6px; }
  `],
  template: `
          <section class="card comments-card">
            <h2>Kommentare <small>({{ comments === undefined ? '…' : comments.length }})</small></h2>

            @if (!mainContentId) {
              <div class="notice">
                Diese Idee ist noch eine leere Sammlung ohne Haupt-Inhalt. Kommentare und
                Bewertungen gehen technisch nur an einem Inhalts-Node (<code>ccm:io</code>).
                Die Moderation kann einen anlegen, dann werden die Funktionen hier aktiv.
              </div>
            } @else if (!api.hasCredentials()) {
              <div class="notice">
                Zum Kommentieren bitte oben rechts anmelden. Lesen geht auch ohne Konto.
              </div>
            } @else {
              <div class="comment-form">
                <textarea [(ngModel)]="newComment"
                          placeholder="Schreib einen Kommentar, eine Rückfrage oder bekunde dein Interesse mitzumachen …"></textarea>
                <div class="row">
                  @if (commentError) {
                    <span class="error">{{ commentError }}</span>
                  } @else { <span></span> }
                  <button class="submit-btn" (click)="submitComment(ideaId)"
                          [disabled]="!newComment.trim() || commentBusy">
                    {{ commentBusy ? 'Sendet…' : 'Kommentar abschicken' }}
                  </button>
                </div>
              </div>
            }

            @for (c of threadedComments(comments || []); track c.ref.id) {
              <div class="comment" [class.reply]="isReply(c)">
                <div class="avatar">{{ initials(c) }}</div>
                <div class="body">
                  <span class="who">{{ formatUser(c) }}</span>
                  <span class="when">{{ formatTs(c.created) }}</span>
                  @if (isReply(c)) { <span class="reply-hint">↩ Antwort</span> }
                  <div class="text">{{ c.comment || '(leer)' }}</div>
                  @if (api.hasCredentials()) {
                    <button class="reply-btn" (click)="startReply(c.ref.id)">
                      {{ replyingTo === c.ref.id ? 'Abbrechen' : '↩ Antworten' }}
                    </button>
                    @if (canDeleteComment(c)) {
                      <button class="reply-btn danger" (click)="deleteComment(c, ideaId)"
                              [disabled]="deletingCommentId === c.ref.id">
                        {{ deletingCommentId === c.ref.id ? 'Lösche…' : '🗑 Löschen' }}
                      </button>
                    }
                  }
                  @if (replyingTo === c.ref.id) {
                    <div class="reply-form">
                      <textarea [(ngModel)]="replyText"
                                placeholder="Antwort an {{ formatUser(c) }} schreiben…"></textarea>
                      @if (commentError) {
                        <span class="error">{{ commentError }}</span>
                      }
                      <button class="submit-btn" (click)="submitReply(ideaId, replyTargetId(c))"
                              [disabled]="!replyText.trim() || commentBusy">
                        {{ commentBusy ? 'Sendet…' : 'Antwort senden' }}
                      </button>
                    </div>
                  }
                </div>
              </div>
            } @empty {
              @if (comments === undefined) {
                <p style="color: var(--wlo-muted); font-style: italic; margin: 10px 0 0;">
                  Lädt Kommentare …
                </p>
              } @else if (api.hasCredentials()) {
                <p style="color: var(--wlo-muted); font-style: italic; margin: 10px 0 0;">
                  Sei der/die Erste, die einen Kommentar hinterlässt.
                </p>
              }
            }
          </section>
  `,
})
export class CommentThreadComponent {
  api = inject(ApiService);

  /** Node-ID der Idee (Sammlung) — Ziel der Kommentar-API-Calls. */
  @Input() ideaId = '';
  /** Kommentarliste aus der Detail-Ladung; undefined = lädt noch. */
  @Input() comments: Comment[] | undefined;
  /** Haupt-Inhalts-Node — ohne ihn sind Kommentare technisch unmöglich. */
  @Input() mainContentId: string | null | undefined;
  /** Nach jeder Mutation: Parent lädt die Idee (inkl. Kommentare) neu. */
  @Output() changed = new EventEmitter<void>();

  newComment = '';
  commentBusy = false;
  commentError = '';
  replyingTo: string | null = null;
  replyText = '';
  deletingCommentId: string | null = null;

  submitComment(id: string) {
    this.commentBusy = true;
    this.commentError = '';
    this.api.commentIdea(id, this.newComment.trim()).subscribe({
      next: () => {
        this.newComment = '';
        this.commentBusy = false;
        this.changed.emit();
      },
      error: (e) => {
        this.commentError = e?.error?.detail || `Fehler beim Senden (HTTP ${e?.status})`;
        this.commentBusy = false;
      },
    });
  }

  startReply(parentId: string) {
    this.replyingTo = this.replyingTo === parentId ? null : parentId;
    this.replyText = '';
  }

  submitReply(ideaId: string, parentId: string) {
    this.commentBusy = true;
    this.commentError = '';
    this.api.commentIdea(ideaId, this.replyText.trim(), parentId).subscribe({
      next: () => {
        this.replyText = '';
        this.replyingTo = null;
        this.commentBusy = false;
        this.changed.emit();
      },
      error: (e) => {
        this.commentError = e?.error?.detail || `Fehler (HTTP ${e?.status})`;
        this.commentBusy = false;
      },
    });
  }

  /** Wer darf den Kommentar löschen? Der Verfasser selbst oder ein
   *  Moderator. Username wird gegen `creator.authorityName` gematcht. */
  canDeleteComment(c: Comment): boolean {
    if (!this.api.hasCredentials()) return false;
    if (this.api.isModerator()) return true;
    const me = (this.api.currentUser() || '').toLowerCase();
    const author = (c?.creator?.authorityName || '').toLowerCase();
    return !!me && me === author;
  }

  deleteComment(c: Comment, ideaId: string) {
    if (!confirm('Diesen Kommentar wirklich löschen? Antworten bleiben sichtbar.')) return;
    const cid = c?.ref?.id;
    if (!cid) return;
    this.deletingCommentId = cid;
    this.api.deleteComment(cid, ideaId).subscribe({
      next: () => { this.deletingCommentId = null; this.changed.emit(); },
      error: (e) => {
        this.deletingCommentId = null;
        alert(e?.error?.detail || `Löschen fehlgeschlagen (HTTP ${e?.status})`);
      },
    });
  }

  /** Returns parent-comment-id for a comment, or null if it's a root.
   *  edu-sharing serialisiert `replyTo` als Objekt `{id, repo, ...}`. */
  private replyParentId(c: Comment): string | null {
    // edu-sharing liefert `replyTo` als Objekt {id}; defensiv auch String
    // zulassen (ältere/abweichende Repo-Antworten) — daher lokal aufweiten.
    const rt = c?.replyTo as { id?: string } | string | null | undefined;
    if (!rt) return null;
    if (typeof rt === 'string') return rt;
    return rt.id || null;
  }
  /** Helper fürs Template (Class-Binding `[class.reply]`). */
  isReply(c: Comment): boolean { return this.replyParentId(c) !== null; }

  /** Wenn der User auf eine Antwort antwortet, hängen wir die neue
   *  Antwort an denselben Thread-Root, damit unser flacher 1-Level-Tree
   *  konsistent bleibt. Bei einem Top-Level-Kommentar ist die Eltern-ID
   *  der Kommentar selbst. */
  replyTargetId(c: Comment): string {
    return this.replyParentId(c) || c.ref.id;
  }

  /** Order comments so each reply follows its parent. One level deep;
   *  nested replies (reply-to-reply) come out flat unter dem Thread-Root. */
  threadedComments(list: Comment[]): Comment[] {
    const byId = new Map<string, Comment>(list.map((c) => [c.ref.id, c]));
    const roots = list.filter((c) => {
      const pid = this.replyParentId(c);
      return !pid || !byId.has(pid);
    });
    const out: Comment[] = [];
    for (const r of roots) {
      out.push(r);
      for (const c of list) {
        if (this.replyParentId(c) === r.ref.id) out.push(c);
      }
    }
    return out;
  }

  /** edu-sharing kann Vor-/Nachnamen an drei Stellen liefern:
   *  - direkt am creator (`creator.firstName`)
   *  - im Profile-Objekt (`creator.profile.firstName`)
   *  - oder als Property-Array (`creator.properties['cm:firstName']`)
   *  Wir checken in der Reihenfolge profile → properties → creator-direct
   *  und fallen zurück auf userName/authorityName. */
  formatUser(c: Comment): string {
    // Optional-Chaining ersetzt die früheren `|| {}`-Fallbacks 1:1 (undefined
    // an jeder Stelle → nächster Fallback) und ist gegen den `Comment`-Typ sauber.
    const u = c?.creator;
    const props = u?.properties;
    const fn = u?.profile?.firstName || props?.['cm:firstName']?.[0] || u?.firstName;
    const ln = u?.profile?.lastName || props?.['cm:lastName']?.[0] || u?.lastName;
    const name = [fn, ln].filter(Boolean).join(' ');
    return name
      || u?.userName
      || props?.['cm:userName']?.[0]
      || u?.authorityName
      || 'Unbekannt';
  }

  initials(c: Comment): string {
    // Avatar-Initialen — initialsOf ist geteilt (auch Team-Sidebar).
    return initialsOf(this.formatUser(c));
  }

  formatTs(t: number) { return t ? new Date(t).toLocaleString('de-DE') : ''; }
}
