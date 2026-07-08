
import { FormsModule } from '@angular/forms';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { ApiService, API_BASE_DEFAULT } from '../api.service';
import { Idea, UserProfileMeta, PROFILE_ROLE_GROUPS } from '../models';
import { VotingService } from '../voting.service';
import { ShareDialogComponent } from './share-dialog.component';

/** Ein Eintrag des „Was ist neu"-Feeds (GET /me/notifications). Schmaler als
 *  ActivityEvent (kein is_mod). `detail` ist konstruktiv beliebiges JSON je
 *  Aktion — daher bewusst `any` (defensive Auswertung in openTarget). */
interface FeedEvent {
  id: number; ts: string; actor: string | null; action: string;
  target_type: string | null; target_id: string | null; target_label: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
}

type Tab = 'feed' | 'mine' | 'follows' | 'interest' | 'requests' | 'settings';

interface TeamRequest {
  idea_id: string; idea_title: string; user_key: string; name: string;
  status: string; approved: boolean; can_edit: boolean; created_at: string;
}

@Component({
  selector: 'ideendb-profile',
  standalone: true,
  imports: [FormsModule, ShareDialogComponent],
  styles: [`
    :host { display: block; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .head { margin-bottom: 20px; }
    h1 { margin: 0 0 4px; color: var(--wlo-primary); font-size: 1.6rem; }
    .username { color: var(--wlo-muted); font-size: .95rem; }
    /* Filterpillen-Menü — analog zum Moderationsbereich. */
    .tabs {
      display: flex; flex-wrap: wrap; gap: 6px;
      margin-bottom: 24px;
    }
    .tabs button {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border); border-radius: 8px;
      padding: 0 14px; height: 38px;
      cursor: pointer; font: inherit; font-size: .9rem; font-weight: 600;
      color: var(--wlo-muted);
      display: inline-flex; align-items: center; gap: 7px;
      white-space: nowrap;
      transition: background .12s, border-color .12s, color .12s;
      &:hover { color: var(--wlo-primary); background: var(--wlo-bg, #f4f6f9); }
      &.active {
        color: var(--wlo-primary);
        background: var(--wlo-primary-soft, #e6edf7);
        border-color: var(--wlo-primary);
      }
      .tab-ico { width: 15px; height: 15px; stroke: currentColor;
                 stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
                 fill: none; flex-shrink: 0; opacity: .85; }
      .badge {
        display: inline-block; margin-left: 4px;
        background: var(--wlo-bg); border-radius: 999px;
        padding: 1px 8px; font-size: .74rem; font-weight: 700;
      }
      &.active .badge { background: var(--wlo-primary); color: #fff; }
    }
    .tabs button .badge.alert,
    .tabs button.active .badge.alert { background: #e24b4a; color: #fff; }
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
    /* Offene-Anfragen-Badge auf eigenen Idee-Kacheln (klickt zur Verwaltung). */
    .tile .mine-req {
      display: inline-flex; align-items: center; gap: 4px; margin: 0 0 8px 6px;
      background: #fdecef; color: #b00020; border: 1px solid #f3c0c8;
      border-radius: 999px; padding: 2px 10px; font-size: .72rem; font-weight: 700;
      cursor: pointer; font-family: inherit;
      &:hover { background: #f7d3da; }
    }
    /* Team-Status (Mithacken-Tab) + Anfragen-Verwaltung */
    .team-status { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
    .team-status .badge { margin-bottom: 0; }
    .badge.team-ok { background: #e6f4ea; color: #1a7f37; text-transform: none; }
    .badge.team-pending { background: var(--wlo-bg, #eef1f5); color: var(--wlo-muted, #5b6778); text-transform: none; }
    .badge.team-edit { background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary, #002855); text-transform: none; }
    .badge.alert { background: #fdecea; color: #c5221f; }
    .req-group {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 10px; padding: 12px 16px; margin-bottom: 12px;
    }
    .req-idea { margin: 0 0 8px; font-size: 1rem; color: var(--wlo-primary); cursor: pointer;
                &:hover { text-decoration: underline; } }
    .req-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .req-list li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .req-list li.is-busy { opacity: .5; pointer-events: none; }
    .req-name { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 6px;
                flex-wrap: wrap; font-size: .92rem; color: var(--wlo-text); }
    .req-name .badge { margin-bottom: 0; }
    .req-actions { display: inline-flex; gap: 4px; flex-shrink: 0; margin-left: auto; }
    .team-btn {
      width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: .85rem; line-height: 1;
      border: 1px solid var(--wlo-border); background: var(--wlo-surface, #fff); color: var(--wlo-text);
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
      &:hover { border-color: var(--wlo-primary); color: var(--wlo-primary); }
      &.on { background: var(--wlo-primary, #002855); color: #fff; border-color: var(--wlo-primary); }
      &.danger:hover { border-color: #c5221f; color: #c5221f; }
    }
    /* Settings-Tab (Profil bearbeiten + Teilen) */
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    .card-form {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 12px;
      padding: 22px 24px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .card-form h2 {
      margin: 0; font-size: 1.05rem; color: var(--wlo-primary);
    }
    .card-form .hint {
      margin: -4px 0 6px;
      font-size: .82rem; color: var(--wlo-muted);
      line-height: 1.4;
    }
    .card-form label {
      display: flex; flex-direction: column; gap: 4px;
      font-size: .82rem; font-weight: 600; color: var(--wlo-text);
      text-transform: uppercase; letter-spacing: .04em;
    }
    .card-form input, .card-form textarea, .card-form select {
      font: inherit; font-weight: normal; text-transform: none;
      padding: 9px 12px;
      border: 1px solid var(--wlo-border); border-radius: 8px;
      background: var(--wlo-bg);
      color: var(--wlo-text);
      letter-spacing: 0;
    }
    .card-form textarea { resize: vertical; min-height: 64px; }
    .card-form .counter {
      align-self: flex-end;
      font-size: .72rem; font-weight: 400; color: var(--wlo-muted);
      text-transform: none; letter-spacing: 0;
      margin-top: -4px;
    }
    .card-form .actions {
      display: flex; gap: 12px; align-items: center; margin-top: 6px;
      .ok { color: #1a7f37; font-size: .85rem; font-weight: 600; text-transform: none; letter-spacing: 0; }
      .err { color: #b00020; font-size: .85rem; text-transform: none; letter-spacing: 0; }
    }
    .card-form .btn {
      padding: 9px 18px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--wlo-border); background: var(--wlo-surface, #fff);
      color: var(--wlo-text); font: inherit; font-weight: 600;
      &:hover:not(:disabled) { background: var(--wlo-bg); }
      &:disabled { opacity: .6; cursor: not-allowed; }
      &.primary {
        background: var(--wlo-primary); border-color: var(--wlo-primary); color: #fff;
        &:hover:not(:disabled) { background: #142f5d; }
      }
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
          Mithacken <span class="badge">{{ interest().length }}</span>
        </button>
        @if (mine().length) {
          <button [class.active]="tab() === 'requests'" (click)="setTab('requests')">
            <svg class="tab-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <polyline points="16 11 18 13 22 9"/>
            </svg>
            Mithack-Anfragen
            @if (pendingRequests() > 0) { <span class="badge alert">{{ pendingRequests() }}</span> }
          </button>
        }
        <button [class.active]="tab() === 'settings'" (click)="setTab('settings')">
          <svg class="tab-ico" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          Profil &amp; Teilen
        </button>
      </div>

      @switch (tab()) {
        @case ('feed') {
          @if (!feed().length) {
            <div class="empty">
              <h2>Noch nichts Neues</h2>
              <p>Hier siehst du Aktivität (Kommentare, Edits, Bewegungen) zu Ideen,
                denen du folgst, an denen du mithackst oder die dir gehören.
                Sobald andere etwas tun, erscheinen die Ereignisse hier.</p>
            </div>
          } @else {
            <div class="feed">
              @for (e of feed(); track e.id) {
                <div class="feed-row" role="button" tabindex="0"
                     (click)="openTarget(e)" (keyup.enter)="openTarget(e)">
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
                <article class="tile" role="button" tabindex="0"
                         (click)="ideaSelected.emit(i)" (keyup.enter)="ideaSelected.emit(i)">
                  @if (i.phase) { <span class="badge">{{ i.phase }}</span> }
                  @if (pendingForIdea(i.id); as n) {
                    <button class="mine-req" title="Offene Mithack-Anfragen freigeben/ablehnen"
                            (click)="$event.stopPropagation(); setTab('requests')">
                      ⏳ {{ n }} Mithack-Anfrage{{ n === 1 ? '' : 'n' }}
                    </button>
                  }
                  <h3>{{ i.title }}</h3>
                  <div class="meta">
                    <span [title]="voting.globalMode() === 'thumbs' ? 'Daumen hoch' : 'Bewertung'">{{ ratingDisplay(i) }}</span>
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
                <article class="tile" role="button" tabindex="0"
                         (click)="ideaSelected.emit(i)" (keyup.enter)="ideaSelected.emit(i)">
                  @if (i.phase) { <span class="badge">{{ i.phase }}</span> }
                  <h3>{{ i.title }}</h3>
                  <div class="meta">
                    <span [title]="voting.globalMode() === 'thumbs' ? 'Daumen hoch' : 'Bewertung'">{{ ratingDisplay(i) }}</span>
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
              <h2>Noch keine Mithack-Ideen</h2>
              <p>Auf einer Idee, die dich interessiert, klick auf „🤝 Ich will
                 mithacken" — sie erscheint dann hier.</p>
            </div>
          } @else {
            <div class="grid">
              @for (i of interest(); track i.id) {
                <article class="tile" role="button" tabindex="0"
                         (click)="ideaSelected.emit(i)" (keyup.enter)="ideaSelected.emit(i)">
                  <div class="team-status">
                    @if (i.my_status === 'approved') {
                      <span class="badge team-ok">✓ Angenommen</span>
                    } @else {
                      <span class="badge team-pending">⏳ Wartet auf Bestätigung</span>
                    }
                    @if (i.my_can_edit) { <span class="badge team-edit">✎ darf bearbeiten</span> }
                  </div>
                  <h3>{{ i.title }}</h3>
                  <div class="meta">
                    <span [title]="voting.globalMode() === 'thumbs' ? 'Daumen hoch' : 'Bewertung'">{{ ratingDisplay(i) }}</span>
                    <span>💬 {{ i.comment_count }}</span>
                  </div>
                </article>
              }
            </div>
          }
        }

        @case ('requests') {
          @if (!teamRequests().length) {
            <div class="empty">
              <h2>Keine Mithack-Anfragen</h2>
              <p>Sobald sich jemand an einer deiner Ideen zum Mithacken einträgt,
                 erscheint die Anfrage hier zum Annehmen.</p>
            </div>
          } @else {
            <p class="hint" style="margin: 0 0 14px;">
              Anfragen freigeben (✓) oder ablehnen (✕), Angenommenen Bearbeitungsrecht
              geben/entziehen (✎) oder aus dem Team entfernen (✕). Angenommene erscheinen
              mit grünem Häkchen auf der Ideenseite und sehen die Idee in „Mithacken".
            </p>
            @for (g of requestsByIdea(); track g.idea_id) {
              <section class="req-group">
                <h3 class="req-idea" role="button" tabindex="0"
                    (click)="openIdeaById(g.idea_id)" (keyup.enter)="openIdeaById(g.idea_id)">
                  {{ g.idea_title }}
                </h3>
                <ul class="req-list">
                  @for (m of g.members; track m.user_key) {
                    <li [class.is-busy]="teamBusy === g.idea_id + ':' + m.user_key">
                      <span class="req-name">
                        {{ m.name }}
                        @if (!m.approved) { <span class="badge team-pending">neu</span> }
                        @if (m.approved) { <span class="badge team-ok">✓</span> }
                        @if (m.can_edit) { <span class="badge team-edit">✎ bearbeitet mit</span> }
                      </span>
                      <span class="req-actions">
                        @if (!m.approved) {
                          <button class="team-btn" title="Ins Team annehmen"
                                  (click)="setTeam(g.idea_id, m.user_key, { status: 'approved' })">✓</button>
                        } @else {
                          <button class="team-btn" [class.on]="m.can_edit"
                                  [title]="m.can_edit ? 'Bearbeitungsrecht entziehen' : 'Bearbeitungsrecht geben'"
                                  (click)="setTeam(g.idea_id, m.user_key, { can_edit: !m.can_edit })">✎</button>
                        }
                        <button class="team-btn danger"
                                [title]="m.approved ? 'Aus Team entfernen' : 'Anfrage ablehnen'"
                                (click)="removeTeam(g.idea_id, m.user_key)">✕</button>
                      </span>
                    </li>
                  }
                </ul>
              </section>
            }
          }
        }

        @case ('settings') {
          <div class="settings-grid">
            <section class="card-form">
              <h2>Profil-Felder</h2>
              <p class="hint">
                Diese Angaben sind sichtbar auf deinem öffentlichen Profil
                ({{ profileShareUrl() }}). Alle Felder sind optional.
              </p>

              <label>Anzeigename
                <input type="text" maxlength="80" [(ngModel)]="meta.display_name"
                       placeholder="z.B. Anna Beispiel" />
              </label>

              <label>Kurzbeschreibung
                <textarea maxlength="280" rows="3"
                          [(ngModel)]="meta.bio"
                          placeholder="Ein bis zwei Sätze zu dir oder deiner Arbeit."></textarea>
                <span class="counter">{{ (meta.bio || '').length }} / 280</span>
              </label>

              <label>Website
                <input type="url" maxlength="2000" [(ngModel)]="meta.website"
                       placeholder="https://…" />
              </label>

              <label>Rolle / Kontext
                <select [(ngModel)]="meta.role">
                  <option value="">— keine Angabe —</option>
                  @for (g of roleGroups; track g.group) {
                    <optgroup [label]="g.group">
                      @for (r of g.items; track r.value) {
                        <option [value]="r.value">{{ r.label }}</option>
                      }
                    </optgroup>
                  }
                </select>
              </label>

              <div class="actions">
                <button class="btn primary"
                        [disabled]="savingMeta()"
                        (click)="saveMeta()">
                  {{ savingMeta() ? 'Speichern…' : 'Speichern' }}
                </button>
                @if (metaSaved()) { <span class="ok">✓ Gespeichert</span> }
                @if (metaError()) { <span class="err">{{ metaError() }}</span> }
              </div>
            </section>

            <section class="card-form">
              <h2>Profil teilen</h2>
              <p class="hint">
                Direktlink + QR-Code für dein öffentliches Profil — funktioniert
                auch ohne Login der Besucher:innen.
              </p>
              <button class="btn" (click)="shareOpen = true">
                🔲 Link &amp; QR-Code öffnen
              </button>
            </section>
          </div>

          <ideendb-share-dialog
            [open]="shareOpen"
            [title]="'Dein Profil teilen'"
            [intro]="'Direkter Link plus QR-Code zu deinem öffentlichen Profil.'"
            [url]="profileShareUrl()"
            [embedSnippet]="profileEmbedSnippet()"
            [qrFilename]="'qr-profil-' + currentUser + '.png'"
            (closed)="shareOpen = false">
          </ideendb-share-dialog>
        }
      }
    </div>
  `,
})
export class ProfileComponent implements OnInit {
  api = inject(ApiService);
  voting = inject(VotingService);

  @Input() apiBase = API_BASE_DEFAULT;
  @Input() currentUser = '';
  @Output() ideaSelected = new EventEmitter<Idea>();

  tab = signal<Tab>('feed');
  mine = signal<Idea[]>([]);
  follows = signal<Idea[]>([]);
  interest = signal<Idea[]>([]);
  teamRequests = signal<TeamRequest[]>([]);
  teamBusy: string | null = null;  // "ideaId:userKey" gerade in Bearbeitung

  /** Anzahl offener (noch nicht angenommener) Mithack-Anfragen auf eigenen Ideen. */
  pendingRequests(): number {
    return this.teamRequests().filter((r) => !r.approved).length;
  }
  /** Offene Anfragen für eine bestimmte eigene Idee (für die Kachel-Badge). */
  pendingForIdea(ideaId: string): number {
    return this.teamRequests().filter((r) => r.idea_id === ideaId && !r.approved).length;
  }
  /** Anfragen/Team gruppiert nach Idee, offene zuerst. */
  requestsByIdea(): { idea_id: string; idea_title: string; members: TeamRequest[] }[] {
    const groups = new Map<string, { idea_id: string; idea_title: string; members: TeamRequest[] }>();
    for (const r of this.teamRequests()) {
      let g = groups.get(r.idea_id);
      if (!g) { g = { idea_id: r.idea_id, idea_title: r.idea_title, members: [] }; groups.set(r.idea_id, g); }
      g.members.push(r);
    }
    const list = [...groups.values()];
    // Ideen mit offenen Anfragen nach oben
    list.sort((a, b) => {
      const ap = a.members.some((m) => !m.approved) ? 0 : 1;
      const bp = b.members.some((m) => !m.approved) ? 0 : 1;
      return ap !== bp ? ap - bp : a.idea_title.localeCompare(b.idea_title);
    });
    return list;
  }
  feed = signal<FeedEvent[]>([]);

  // ----- Profil-Felder (settings-Tab) -----
  meta: UserProfileMeta = {
    display_name: '', bio: '', website: '', role: '',
  };
  roleGroups = PROFILE_ROLE_GROUPS;
  savingMeta = signal(false);
  metaSaved = signal(false);
  metaError = signal<string>('');
  private metaSavedTimer?: number;

  // ----- Share-Dialog state -----
  shareOpen = false;

  ngOnInit() {
    this.api.setBase(this.apiBase);
    this.voting.load();  // globaler Bewertungs-Modus (Sterne/Daumen)
    this.reloadAll();
    this.loadMeta();
  }

  /** Bewertungs-Anzeige für Kacheln je nach globalem Modus (Sterne/Daumen). */
  ratingDisplay(i: Idea): string {
    return this.voting.globalMode() === 'thumbs'
      ? `👍 ${i.rating_count ?? 0}`
      : `★ ${(i.rating_avg ?? 0).toFixed(1)}`;
  }

  loadMeta() {
    this.api.getMyProfileMeta().subscribe({
      next: (m) => {
        this.meta = {
          display_name: m.display_name ?? '',
          bio: m.bio ?? '',
          website: m.website ?? '',
          role: m.role ?? '',
        };
      },
      error: () => { /* unangemeldet — Felder bleiben leer */ },
    });
  }

  saveMeta() {
    this.savingMeta.set(true);
    this.metaError.set('');
    this.metaSaved.set(false);
    this.api.updateMyProfileMeta({
      display_name: this.meta.display_name || null,
      bio: this.meta.bio || null,
      website: this.meta.website || null,
      role: this.meta.role || null,
    }).subscribe({
      next: () => {
        this.savingMeta.set(false);
        this.metaSaved.set(true);
        if (this.metaSavedTimer) window.clearTimeout(this.metaSavedTimer);
        this.metaSavedTimer = window.setTimeout(() => this.metaSaved.set(false), 2500);
      },
      error: (e) => {
        this.savingMeta.set(false);
        this.metaError.set(e?.error?.detail || `Fehler (HTTP ${e?.status})`);
      },
    });
  }

  profileShareUrl(): string {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return `${base}?view=user&u=${encodeURIComponent(this.currentUser)}`;
  }

  profileEmbedSnippet(): string {
    const origin = window.location.origin;
    return [
      `<script type="module" src="${origin}/main.js"></script>`,
      `<ideendb-app api-base="${origin}/api/v1"`,
      `             view="user"`,
      `             u="${this.currentUser}"></ideendb-app>`,
    ].join('\n');
  }

  setTab(t: Tab) {
    this.tab.set(t);
  }

  /** Öffnet eine Idee nur anhand der ID (Shell lädt die Detailseite). */
  openIdeaById(id: string) {
    // B-lite-Stub: nur die id — die Detailseite lädt den Rest selbst nach.
    this.ideaSelected.emit({ id } as Idea);
  }

  reloadAll() {
    // Jede Sektion lädt UNABHÄNGIG. Die auth-geprüften /me-Routen
    // (follows/interest/team-requests verifizieren live gegen edu-sharing)
    // können transient scheitern — ein error-Callback fängt das ab, damit die
    // Seite NICHT mit einem uncaught error abbricht (der sichtbare „Fehler"
    // beim Öffnen von „Mein Bereich"). Die betroffene Sektion behält ihren
    // letzten Stand, die übrigen laden normal weiter.
    this.api.myIdeas().subscribe({ next: (r) => this.mine.set(r.items || []), error: this._sectionSoftFail });
    this.api.myFollows().subscribe({ next: (r) => this.follows.set(r.items || []), error: this._sectionSoftFail });
    this.api.myInterest().subscribe({ next: (r) => this.interest.set(r.items || []), error: this._sectionSoftFail });
    this.api.myActivity().subscribe({ next: (r) => this.feed.set(r.items || []), error: this._sectionSoftFail });
    this.api.myTeamRequests().subscribe({ next: (r) => this.teamRequests.set(r.items || []), error: this._sectionSoftFail });
  }

  /** Transienter /me-Fehler: bewusst weich abfangen (Sektion behält ihren
   *  Stand), damit eine einzelne flaky Auth-Prüfung nicht die ganze
   *  Profilseite als uncaught error abbrechen lässt. */
  private _sectionSoftFail = () => { /* intentional graceful degradation */ };

  private reloadTeam() {
    this.api.myInterest().subscribe({ next: (r) => this.interest.set(r.items || []), error: this._sectionSoftFail });
    this.api.myTeamRequests().subscribe({ next: (r) => this.teamRequests.set(r.items || []), error: this._sectionSoftFail });
  }

  /** Owner: Mithackende:n auf einer eigenen Idee annehmen / Recht (de)aktivieren. */
  setTeam(ideaId: string, userKey: string,
          patch: { status?: 'pending' | 'approved'; can_edit?: boolean }) {
    this.teamBusy = ideaId + ':' + userKey;
    this.api.setTeamMember(ideaId, userKey, patch).subscribe({
      next: () => { this.teamBusy = null; this.reloadTeam(); },
      error: (e) => { this.teamBusy = null; alert(`Aktion fehlgeschlagen: ${e?.error?.detail || e?.message}`); },
    });
  }
  /** Owner: Mithackende:n aus dem Team entfernen. */
  removeTeam(ideaId: string, userKey: string) {
    if (!confirm('Diese Person aus dem Team entfernen?')) return;
    this.teamBusy = ideaId + ':' + userKey;
    this.api.removeTeamMember(ideaId, userKey).subscribe({
      next: () => { this.teamBusy = null; this.reloadTeam(); },
      error: (e) => { this.teamBusy = null; alert(`Entfernen fehlgeschlagen: ${e?.error?.detail || e?.message}`); },
    });
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
      team_join_requested: 'möchte mithacken bei',
      team_approved: 'hat ein Teammitglied angenommen bei',
      team_edit_granted: 'hat Bearbeitungsrecht erteilt bei',
      team_edit_revoked: 'hat Bearbeitungsrecht entzogen bei',
      team_unapproved: 'hat eine Team-Annahme zurückgenommen bei',
      team_member_removed: 'hat ein Teammitglied entfernt bei',
      team_member_updated: 'hat den Team-Status geändert bei',
    };
    return m[action] || action;
  }
  openTarget(e: FeedEvent) {
    if (!e?.target_id) return;
    const ttype = e.target_type;
    let ideaId: string = e.target_id;
    // Bei Attachment-Events nutzen wir die idea_id aus detail
    if (ttype === 'attachment' && e.detail?.idea_id) {
      ideaId = e.detail.idea_id;
    } else if (ttype !== 'idea' && ttype !== 'attachment') {
      return;
    }
    // B-lite-Stub: nur die id — die Detailseite lädt den Rest selbst nach.
    this.ideaSelected.emit({ id: ideaId } as Idea);
  }
}
