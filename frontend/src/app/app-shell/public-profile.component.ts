import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { ApiService } from '../api.service';
import { Idea } from '../models';

/**
 * Öffentliches Profil eines Idee-Autors. Erreichbar über `?view=user&u=<username>`
 * oder durch Klick auf einen Autor-Namen. Zeigt Stats + Liste aller Ideen
 * dieser Person (ohne Hidden) als Kachelraster. Keine privaten Daten.
 */
@Component({
  standalone: true,
  selector: 'ideendb-public-profile',
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 24px; }

    .head {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 12px; padding: 22px 26px; margin-bottom: 18px;
      display: flex; align-items: flex-start; gap: 18px; position: relative;
    }
    .avatar {
      width: 72px; height: 72px; border-radius: 50%;
      background: var(--wlo-primary-soft);
      color: var(--wlo-primary);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 1.8rem; font-weight: 700; flex-shrink: 0;
    }
    .head-info { flex: 1; }
    .head-info h1 { margin: 0 0 2px; font-size: 1.4rem; color: var(--wlo-text); }
    .head-info .sub { color: var(--wlo-muted); font-size: .88rem; }
    .stats {
      display: flex; flex-wrap: wrap; gap: 24px; margin-top: 12px;
      .stat-num { font-weight: 700; color: var(--wlo-primary); }
      .stat-label { color: var(--wlo-muted); margin-left: 4px; font-size: .85rem; }
    }
    .share-btn {
      position: absolute; top: 18px; right: 22px;
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--wlo-surface-2, var(--wlo-bg));
      border: 1px solid var(--wlo-border);
      color: var(--wlo-text); padding: 7px 14px; border-radius: 8px;
      cursor: pointer; font-weight: 600; font-size: .85rem;
      &:hover { border-color: var(--wlo-primary); color: var(--wlo-primary); }
      svg { width: 14px; height: 14px; stroke: currentColor;
            stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
            fill: none; }
    }

    h2.section-title { margin: 0 0 12px; font-size: 1.05rem; }

    .empty {
      background: var(--wlo-surface, #fff); border: 1px dashed var(--wlo-border);
      border-radius: 10px; padding: 32px 20px; text-align: center;
      color: var(--wlo-muted);
    }

    /* Tile-Grid — 1:1-Übernahme aus tile-grid.component.scss damit
       die Kacheln auf Profil- und Startseite identisch aussehen
       (2-Zeilen-Title-Reserve, Phase/Event als identische Pille,
       Description-Clamp, Footer mit Bewertung + Kommentare). */
    .idea-grid {
      display: grid; gap: 16px; grid-template-columns: 1fr;
      @media (min-width: 640px)  { grid-template-columns: repeat(2, 1fr); }
      @media (min-width: 1100px) { grid-template-columns: repeat(4, 1fr); }
    }
    .idea-tile {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border, #e2e7ef);
      border-radius: 12px; overflow: hidden; cursor: pointer;
      transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
      display: flex; flex-direction: column;
      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 18px rgba(0, 40, 85, .10);
        border-color: var(--wlo-primary, #002855);
      }
    }
    .tile-thumb {
      width: 100%; aspect-ratio: 16 / 9; object-fit: cover;
      background: var(--wlo-bg, #f4f6f9);
      display: flex; align-items: center; justify-content: center;
      &.placeholder {
        background: linear-gradient(135deg, #002855, #003c7e);
        color: #fff; font-size: 2.2rem; font-weight: 600; letter-spacing: .05em;
      }
    }
    .tile-body { padding: 14px; display: flex; flex-direction: column;
                  gap: 8px; flex: 1; }
    .tile-title {
      margin: 0; font-size: 1rem; font-weight: 600;
      color: var(--wlo-text, #1a2235); line-height: 1.35;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: calc(2 * 1.35em);
    }
    .badges { display: flex; flex-wrap: wrap; gap: 4px; }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: .72rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: .04em; white-space: nowrap;
      &.phase, &.event {
        background: var(--wlo-primary-soft, #e6edf7);
        color: var(--wlo-primary, #002855);
      }
    }
    .tile-desc {
      margin: 0; color: var(--wlo-muted, #5b6778); font-size: .88rem;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .tile-meta {
      margin-top: auto; display: flex; gap: 10px; align-items: center;
      font-size: .8rem; color: var(--wlo-muted);
      .kpi { display: inline-flex; align-items: center; gap: 3px; }
      small { opacity: .7; }
    }

    /* Share-Dialog — gleiche Optik wie der Event-Share im Mod-Tab */
    .share-overlay {
      position: fixed; inset: 0; z-index: 50;
      background: rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .share-box {
      background: var(--wlo-surface, #fff);
      border-radius: 12px; padding: 24px 28px 22px;
      max-width: 520px; width: 100%; max-height: 90vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .share-head { display: flex; justify-content: space-between;
                   align-items: flex-start; margin-bottom: 14px; }
    .share-head h2 { margin: 0; font-size: 1.1rem; color: var(--wlo-text); }
    .share-head .x {
      background: none; border: none; font-size: 1.4rem; cursor: pointer;
      line-height: 1; color: var(--wlo-muted);
      &:hover { color: var(--wlo-text); }
    }
    .share-box label { display: block; font-size: .82rem; font-weight: 600;
                        color: var(--wlo-text); margin: 6px 0 4px; }
    .share-link { display: flex; gap: 8px; }
    .share-link input {
      flex: 1; padding: 8px 12px; border: 1px solid var(--wlo-border);
      border-radius: 6px; font-size: .85rem; background: var(--wlo-surface-2, #fff);
      color: var(--wlo-text);
    }
    .share-link button {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--wlo-cta-bg, var(--wlo-primary));
      color: var(--wlo-cta-text, #fff);
      border: none; padding: 0 14px; border-radius: 6px;
      cursor: pointer; font-weight: 600; font-size: .85rem;
      &:hover { background: var(--wlo-cta-bg-hover, var(--wlo-primary-600)); }
      &.ok { background: #137333; color: #fff; }
      svg { width: 14px; height: 14px; stroke: currentColor;
            stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
            fill: none; }
    }
    .embed-snippet {
      background: var(--wlo-bg); padding: 10px 12px; border-radius: 6px;
      font-size: .78rem; overflow-x: auto; margin: 4px 0 6px;
      white-space: pre-wrap; word-break: break-all; color: var(--wlo-text);
      border: 1px solid var(--wlo-border);
    }
    .embed-actions { display: flex; gap: 8px; }
    .embed-actions button {
      background: var(--wlo-surface-2, var(--wlo-bg));
      border: 1px solid var(--wlo-border);
      color: var(--wlo-text); padding: 6px 12px; border-radius: 6px;
      cursor: pointer; font-size: .82rem; font-weight: 600;
      &:hover { border-color: var(--wlo-primary); color: var(--wlo-primary); }
      &.ok { background: #e6f6ec; color: #137333; border-color: #b6e3c5; }
    }
    .share-note { font-size: .8rem; color: var(--wlo-muted);
                   margin-top: 16px; line-height: 1.55; }
  `],
  template: `
    <div class="wrap">
    @if (profile(); as p) {
      <div class="head">
        <div class="avatar">{{ initials(p.username) }}</div>
        <div class="head-info">
          <h1>{{ p.username }}</h1>
          <div class="sub">
            @if (p.last_activity) {
              Letzte Aktivität: {{ formatDate(p.last_activity) }}
            } @else {
              Noch keine Ideen veröffentlicht
            }
          </div>
          <div class="stats">
            <span><span class="stat-num">{{ p.stats.ideas }}</span><span class="stat-label">Ideen</span></span>
            <span><span class="stat-num">{{ p.stats.comments }}</span><span class="stat-label">Kommentare gesamt</span></span>
            <span><span class="stat-num">{{ p.stats.ratings }}</span><span class="stat-label">Bewertungen</span></span>
            @if (p.stats.avg_rating > 0) {
              <span><span class="stat-num">{{ p.stats.avg_rating | number: '1.1-2' }}</span><span class="stat-label">Schnitt</span></span>
            }
          </div>
        </div>
        <button class="share-btn" (click)="shareOpen = true" title="Profil teilen">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          Teilen
        </button>
      </div>

      @if (p.ideas.length > 0) {
        <h2 class="section-title">Ideen von {{ p.username }}</h2>
        <div class="idea-grid">
          @for (i of p.ideas; track i.id) {
            <div class="idea-tile" (click)="ideaSelected.emit(i)">
              @if (i.preview_url) {
                <img class="tile-thumb" [src]="i.preview_url" [alt]="i.title" loading="lazy" />
              } @else {
                <div class="tile-thumb placeholder">{{ initials(i.title) }}</div>
              }
              <div class="tile-body">
                <h3 class="tile-title">{{ i.title }}</h3>
                <div class="badges">
                  @if (i.phase) { <span class="badge phase">{{ i.phase }}</span> }
                  @for (ev of i.events; track ev) {
                    <span class="badge event">{{ ev }}</span>
                  }
                </div>
                @if (i.description) {
                  <p class="tile-desc">{{ clip(i.description, 180) }}</p>
                }
                <div class="tile-meta">
                  <span class="kpi" title="Bewertung">
                    ★ {{ i.rating_avg | number: '1.1-1' }}
                    <small>({{ i.rating_count }})</small>
                  </span>
                  <span class="kpi" title="Kommentare">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    {{ i.comment_count }}
                  </span>
                </div>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="empty">
          {{ p.username }} hat noch keine öffentlich sichtbaren Ideen.
        </div>
      }
    } @else if (error()) {
      <div class="empty">{{ error() }}</div>
    } @else {
      <div class="empty">Lade Profil…</div>
    }

    @if (shareOpen && profile(); as p) {
      <div class="share-overlay" (click)="closeShare($event)">
        <div class="share-box" (click)="$event.stopPropagation()">
          <div class="share-head">
            <h2>Profil von {{ p.username }} teilen</h2>
            <button class="x" (click)="shareOpen = false">×</button>
          </div>
          <p style="margin: 0 0 14px; color: var(--wlo-muted); font-size: .9rem;">
            Direkter Link zum Profil oder als Webkomponente in eine andere Seite einbetten.
          </p>

          <label>Profil-Link</label>
          <div class="share-link">
            <input type="text" [value]="shareUrl()" readonly
                   #linkInput (click)="linkInput.select()" />
            <button (click)="copyShareLink()" [class.ok]="copied">
              @if (copied) {
                <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                Kopiert
              } @else {
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Kopieren
              }
            </button>
          </div>

          <label style="margin-top: 18px">Als Webkomponente einbetten</label>
          <pre class="embed-snippet">{{ embedSnippet() }}</pre>
          <div class="embed-actions">
            <button (click)="copyEmbed()" [class.ok]="embedCopied">
              {{ embedCopied ? '✓ Code kopiert' : 'Code kopieren' }}
            </button>
          </div>
          <p class="share-note">
            Das Snippet lädt das App-Bundle und rendert das Profil als eigenständige
            Webkomponente — funktioniert auf jeder Seite, die das Bundle einbindet.
          </p>
        </div>
      </div>
    }
    </div>
  `,
})
export class PublicProfileComponent implements OnChanges {
  api = inject(ApiService);

  @Input() username = '';
  @Input() apiBase = '';
  @Output() ideaSelected = new EventEmitter<Idea>();

  profile = signal<any | null>(null);
  error = signal<string>('');
  shareOpen = false;
  copied = false;
  embedCopied = false;

  ngOnChanges(ch: SimpleChanges) {
    // Nur setzen, wenn explizit ein Wert übergeben wurde — sonst zerlegen
    // wir die schon vom AppShell gewählte Base, wenn diese Komponente
    // ohne `api-base`-Attribut gemountet wird.
    if (ch['apiBase'] && this.apiBase) this.api.setBase(this.apiBase);
    if (ch['username']) this.load();
  }

  load() {
    if (!this.username) return;
    this.profile.set(null);
    this.error.set('');
    this.api.publicUserProfile(this.username).subscribe({
      next: (r) => this.profile.set(r),
      error: (e) => this.error.set(
        e?.status === 404
          ? 'Kein öffentliches Profil für diesen Nutzer.'
          : `Profil konnte nicht geladen werden (HTTP ${e?.status}).`
      ),
    });
  }

  initials(name: string): string {
    if (!name) return '?';
    return name.slice(0, 2).toUpperCase();
  }

  clip(t: string, n: number): string {
    if (!t) return '';
    const cleaned = t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return cleaned.length > n ? cleaned.slice(0, n - 1) + '…' : cleaned;
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch { return iso; }
  }

  shareUrl(): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=user&u=${encodeURIComponent(this.username)}`;
  }

  copyShareLink() {
    navigator.clipboard?.writeText(this.shareUrl());
    this.copied = true;
    setTimeout(() => (this.copied = false), 2000);
  }

  embedSnippet(): string {
    const apiBase = this.api.base || '/api/v1';
    return `<ideendb-app api-base="${apiBase}" view="user" u="${this.username}"></ideendb-app>`;
  }

  copyEmbed() {
    navigator.clipboard?.writeText(this.embedSnippet());
    this.embedCopied = true;
    setTimeout(() => (this.embedCopied = false), 2000);
  }

  closeShare(e: MouseEvent) {
    if (e.target === e.currentTarget) this.shareOpen = false;
  }
}
