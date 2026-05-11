import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { Idea } from '../models';
import { TileGridComponent } from '../tile-grid/tile-grid.component';

type Tab = 'feed' | 'mine' | 'follows' | 'interest';

@Component({
  selector: 'ideendb-profile',
  standalone: true,
  imports: [CommonModule, TileGridComponent],
  styles: [`
    :host { display: block; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .head { margin-bottom: 20px; }
    h1 { margin: 0 0 4px; color: var(--wlo-primary); font-size: 1.6rem; }
    .username { color: var(--wlo-muted); font-size: .95rem; }
    .tabs {
      display: flex; gap: 2px;
      border-bottom: 2px solid var(--wlo-border);
      margin-bottom: 24px;
    }
    .tabs button {
      background: none; border: none;
      padding: 12px 18px;
      cursor: pointer; font: inherit;
      font-weight: 600; color: var(--wlo-muted);
      border-bottom: 3px solid transparent; margin-bottom: -2px;
      display: inline-flex; align-items: center; gap: 6px;
      &:hover { color: var(--wlo-primary); }
      &.active { color: var(--wlo-primary); border-bottom-color: var(--wlo-primary); }
      .tab-ico { width: 14px; height: 14px; stroke: currentColor;
                 stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
                 fill: none; flex-shrink: 0; }
      .badge {
        display: inline-block; margin-left: 8px;
        background: var(--wlo-bg); border-radius: 999px;
        padding: 1px 9px; font-size: .75rem; font-weight: 600;
      }
      &.active .badge {
        background: var(--wlo-primary); color: #fff;
      }
    }
    .empty {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 10px;
      padding: 48px 24px; text-align: center; color: var(--wlo-muted);
    }
    .empty h2 { margin: 0 0 8px; color: var(--wlo-text); font-size: 1.1rem; }
    .empty p { margin: 0; font-size: .95rem; }
    .grid { display: grid; gap: 14px;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .feed { background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
            border-radius: 10px; overflow: hidden; }
    .feed-row {
      display: grid;
      grid-template-columns: 110px 30px 1fr;
      gap: 10px; align-items: baseline;
      padding: 10px 16px; cursor: pointer;
      border-bottom: 1px solid #f1f3f5;
      &:last-child { border-bottom: none; }
      &:hover { background: var(--wlo-bg, #f4f6f9); }
      .feed-time { color: var(--wlo-muted); font-size: .82rem;
                   font-variant-numeric: tabular-nums; }
      .feed-icon { font-size: 1.1rem; text-align: center;
                   display: inline-flex; align-items: center; justify-content: center;
                   svg { width: 16px; height: 16px; stroke: currentColor;
                         stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
                         fill: none; color: var(--wlo-muted); } }
      .feed-text { color: var(--wlo-text); font-size: .92rem;
                   em { color: var(--wlo-primary); font-style: normal; font-weight: 600; }
                   .loc { color: var(--wlo-primary); font-weight: 600; } }
    }
    @media (max-width: 600px) {
      .feed-row { grid-template-columns: 30px 1fr;
                  .feed-time { grid-column: 2; font-size: .78rem; } }
    }
    .tile {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 10px;
      padding: 16px; cursor: pointer; transition: border-color .12s, transform .12s;
      &:hover { border-color: var(--wlo-primary); transform: translateY(-2px); }
    }
    .tile h3 { margin: 0 0 8px; font-size: 1rem; color: var(--wlo-text); line-height: 1.35;
               display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
               overflow: hidden; }
    .tile .meta { display: flex; gap: 12px; font-size: .82rem; color: var(--wlo-muted); }
    .tile .badge {
      display: inline-block; padding: 2px 9px; border-radius: 999px;
      background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary);
      font-size: .7rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: .04em; margin-bottom: 8px;
    }
  `],
  template: `
    <div class="wrap">
      <div class="head">
        <h1>Mein Bereich</h1>
        <span class="username">Eingeloggt als <strong>{{ currentUser }}</strong></span>
      </div>

      <div class="tabs">
        <button [class.active]="tab() === 'feed'" (click)="setTab('feed')">
          <svg class="tab-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
            <path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>
          </svg>
          Was ist neu @if (feed().length) { <span class="badge">{{ feed().length }}</span> }
        </button>
        <button [class.active]="tab() === 'mine'" (click)="setTab('mine')">
          <svg class="tab-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
          </svg>
          Meine Ideen <span class="badge">{{ mine().length }}</span>
        </button>
        <button [class.active]="tab() === 'follows'" (click)="setTab('follows')">
          <svg class="tab-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          Gefolgt <span class="badge">{{ follows().length }}</span>
        </button>
        <button [class.active]="tab() === 'interest'" (click)="setTab('interest')">
          <svg class="tab-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Mitmachen <span class="badge">{{ interest().length }}</span>
        </button>
      </div>

      @switch (tab()) {
        @case ('feed') {
          @if (!feed().length) {
            <div class="empty">
              <h2>Noch nichts Neues</h2>
              <p>Hier siehst du Aktivität (Kommentare, Edits, Bewegungen) zu Ideen,
                denen du folgst, an denen du mitmachst oder die dir gehören.
                Sobald andere etwas tun, erscheinen die Ereignisse hier.</p>
            </div>
          } @else {
            <div class="feed">
              @for (e of feed(); track e.id) {
                <div class="feed-row" (click)="openTarget(e)">
                  <span class="feed-time">{{ formatTime(e.ts) }}</span>
                  <span class="feed-icon">
                    @switch (e.action) {
                      @case ('idea_edited') {
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 20h9"/>
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
                        </svg>
                      }
                      @case ('idea_moved') {
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <line x1="5" y1="12" x2="19" y2="12"/>
                          <polyline points="12 5 19 12 12 19"/>
                        </svg>
                      }
                      @case ('idea_duplicated') {
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      }
                      @case ('attachment_uploaded') {
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                        </svg>
                      }
                      @case ('attachment_renamed') {
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 20h9"/>
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
                        </svg>
                      }
                      @case ('attachment_deleted') {
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      }
                      @case ('attachment_folder_created') {
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                      }
                      @case ('report_submitted') {
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/>
                          <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                      }
                      @default {
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                        </svg>
                      }
                    }
                  </span>
                  <span class="feed-text">
                    <strong>{{ e.actor || 'Jemand' }}</strong>
                    {{ feedVerb(e.action) }}
                    @if (e.target_label) { „<em>{{ e.target_label }}</em>" }
                    @if (e.action === 'idea_moved' && e.detail?.to_topic_title) {
                      → <span class="loc">{{ e.detail.to_topic_title }}</span>
                    }
                  </span>
                </div>
              }
            </div>
          }
        }

        @case ('mine') {
          @if (!mine().length) {
            <div class="empty">
              <h2>Noch keine eigenen Ideen</h2>
              <p>Über „+ Idee einreichen" oben rechts startest du deine erste Idee.
                 Sie erscheint dann hier zur Pflege.</p>
            </div>
          } @else {
            <div class="grid">
              @for (i of mine(); track i.id) {
                <article class="tile" (click)="ideaSelected.emit(i)">
                  @if (i.phase) { <span class="badge">{{ i.phase }}</span> }
                  <h3>{{ i.title }}</h3>
                  <div class="meta">
                    <span>★ {{ i.rating_avg | number: '1.1-1' }}</span>
                    <span>💬 {{ i.comment_count }}</span>
                  </div>
                </article>
              }
            </div>
          }
        }

        @case ('follows') {
          @if (!follows().length) {
            <div class="empty">
              <h2>Du folgst noch keiner Idee</h2>
              <p>Auf einer Detailseite kannst du auf „🔔 Folgen" klicken — dann
                 siehst du Updates dazu hier.</p>
            </div>
          } @else {
            <div class="grid">
              @for (i of follows(); track i.id) {
                <article class="tile" (click)="ideaSelected.emit(i)">
                  @if (i.phase) { <span class="badge">{{ i.phase }}</span> }
                  <h3>{{ i.title }}</h3>
                  <div class="meta">
                    <span>★ {{ i.rating_avg | number: '1.1-1' }}</span>
                    <span>💬 {{ i.comment_count }}</span>
                  </div>
                </article>
              }
            </div>
          }
        }

        @case ('interest') {
          @if (!interest().length) {
            <div class="empty">
              <h2>Noch keine Mitmach-Ideen</h2>
              <p>Auf einer Idee, die dich interessiert, klick auf „🤝 Ich will
                 mitmachen" — sie erscheint dann hier.</p>
            </div>
          } @else {
            <div class="grid">
              @for (i of interest(); track i.id) {
                <article class="tile" (click)="ideaSelected.emit(i)">
                  @if (i.phase) { <span class="badge">{{ i.phase }}</span> }
                  <h3>{{ i.title }}</h3>
                  <div class="meta">
                    <span>★ {{ i.rating_avg | number: '1.1-1' }}</span>
                    <span>💬 {{ i.comment_count }}</span>
                  </div>
                </article>
              }
            </div>
          }
        }
      }
    </div>
  `,
})
export class ProfileComponent implements OnInit {
  api = inject(ApiService);

  @Input() apiBase = API_BASE_DEFAULT;
  @Input() currentUser = '';
  @Output() ideaSelected = new EventEmitter<Idea>();

  tab = signal<Tab>('feed');
  mine = signal<Idea[]>([]);
  follows = signal<Idea[]>([]);
  interest = signal<Idea[]>([]);
  feed = signal<{
    id: number; ts: string; actor: string | null; action: string;
    target_type: string | null;
    target_id: string | null; target_label: string | null; detail: any;
  }[]>([]);

  ngOnInit() {
    this.api.setBase(this.apiBase);
    this.reloadAll();
  }

  setTab(t: Tab) {
    this.tab.set(t);
  }

  reloadAll() {
    this.api.myIdeas().subscribe((r) => this.mine.set(r.items || []));
    this.api.myFollows().subscribe((r) => this.follows.set(r.items || []));
    this.api.myInterest().subscribe((r) => this.interest.set(r.items || []));
    this.api.myActivity().subscribe((r) => this.feed.set(r.items || []));
  }

  formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = (now.getTime() - d.getTime()) / 1000;
      if (diff < 60) return 'gerade eben';
      if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`;
      if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`;
      if (diff < 604800) return `vor ${Math.floor(diff / 86400)} Tagen`;
      return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch { return iso; }
  }

  feedIcon(action: string): string {
    const m: Record<string, string> = {
      idea_edited: '✎', idea_moved: '➡', idea_duplicated: '⎘',
      attachment_uploaded: '📎', attachment_renamed: '✏',
      attachment_deleted: '🗑', attachment_folder_created: '📁',
      report_submitted: '⚠',
    };
    return m[action] || '·';
  }
  feedVerb(action: string): string {
    const m: Record<string, string> = {
      idea_edited: 'hat eine Idee bearbeitet',
      idea_moved: 'hat eine Idee verschoben',
      idea_duplicated: 'hat eine Idee dupliziert',
      attachment_uploaded: 'hat einen Anhang hochgeladen zu',
      attachment_renamed: 'hat einen Anhang umbenannt von',
      attachment_deleted: 'hat einen Anhang gelöscht von',
      attachment_folder_created: 'hat eine Anhänge-Sammlung angelegt zu',
      attachment_folder_deleted: 'hat eine Anhänge-Sammlung gelöscht von',
      report_submitted: 'hat eine Meldung abgeschickt zu',
    };
    return m[action] || action;
  }
  openTarget(e: any) {
    if (!e?.target_id) return;
    const ttype = e.target_type;
    let ideaId: string = e.target_id;
    // Bei Attachment-Events nutzen wir die idea_id aus detail
    if (ttype === 'attachment' && e.detail?.idea_id) {
      ideaId = e.detail.idea_id;
    } else if (ttype !== 'idea' && ttype !== 'attachment') {
      return;
    }
    this.ideaSelected.emit({ id: ideaId } as any);
  }
}
