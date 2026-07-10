import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { Attachment, InboxItem, InboxPreview, Topic } from '../models';
import { formatSize as fmtSize } from '../format-utils';
import { SyncDiffComponent } from './sync-diff.component';

/**
 * Postfach des Mod-Bereichs — aus moderation.component.ts herausgelöst
 * (verhaltensgleich). Triagiert neue Einreichungen (einsortieren/löschen,
 * einzeln + bulk, Lazy-Vorschau); der Sync-Differenz-Filter rendert das
 * eigenständige sync-diff.component (bekommt die challengeGroups als Input,
 * meldet seine Trefferzahl für die Filter-Pille). Besitzt die Topic-Maps
 * selbst und lädt sich in ngOnInit — bei jedem Tab-Eintritt frisch, daher
 * keine (changed)-Kopplung an den Themen-Editor nötig.
 */
@Component({
  selector: 'ideendb-inbox-list',
  standalone: true,
  imports: [FormsModule, SyncDiffComponent],
  styles: [`
    :host { display: block; }
    .btn {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      color: var(--wlo-text);
      &:hover { background: var(--wlo-primary-soft, #e6edf7); border-color: var(--wlo-primary); color: var(--wlo-primary); }
      &:disabled { opacity: .5; cursor: not-allowed; }
    }
    .btn.danger { background: var(--wlo-surface, #fff); border-color: #e1a5ac; color: #b00020;
                  &:hover { background: #b00020; border-color: #b00020; color: #fff; } }
    .btn.primary-move {
      background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
      &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
    }
    select {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 8px;
      padding: 8px 10px; font: inherit; width: 100%; box-sizing: border-box;
    }
    .intro {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-left: 4px solid var(--wlo-primary);
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: .95rem;
      color: var(--wlo-text);
      line-height: 1.55;
    }
    .item {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 14px;
      display: flex; flex-direction: column; gap: 12px;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .item:hover { border-color: #c9d2e3; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
    .item .head { display: flex; align-items: flex-start; gap: 12px; }
    .item .head .titlewrap { flex: 1; min-width: 0; }
    .item h3 { margin: 0 0 6px; color: var(--wlo-text); font-size: 1.1rem; line-height: 1.3; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 0; }
    .tag {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 2px 10px;
      border-radius: 999px;
      font-size: .75rem;
      color: var(--wlo-muted);
    }
    .tag.phase { background: var(--wlo-primary-soft, #e6edf7); color: var(--wlo-primary); border-color: transparent; font-weight: 600; }
    .tag.event { background: var(--wlo-accent-soft, #fff8db); color: #5c4a00; border-color: transparent; }
    .tag.target { background: #e6f4ea; color: #0f5b24; border-color: transparent; }
    .desc { color: var(--wlo-text); font-size: .92rem; line-height: 1.55;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
            overflow: hidden; margin: 0; }
    .desc.expanded {
      display: block; -webkit-line-clamp: unset; overflow: visible;
      white-space: pre-wrap;
    }
    .meta-row { color: var(--wlo-muted); font-size: .82rem;
                display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
    .meta-row .id { font-family: monospace; font-size: .72rem; opacity: .7; }
    .preview-toggle {
      background: none; border: none; padding: 0; cursor: pointer;
      color: var(--wlo-primary); font: inherit; font-size: .85rem;
      text-decoration: underline; align-self: flex-start;
    }
    .preview-toggle:hover { filter: brightness(1.2); }
    .preview-card {
      border: 1px solid var(--wlo-border); border-radius: 8px;
      background: var(--wlo-surface-2, var(--wlo-surface, #fafbfd));
      padding: 16px 18px;
      display: flex; flex-direction: column; gap: 14px;
    }
    .preview-row { display: flex; gap: 16px; align-items: flex-start; }
    .preview-row .thumb {
      width: 160px; height: 100px; flex-shrink: 0;
      border: 1px solid var(--wlo-border); border-radius: 6px;
      background: var(--wlo-surface, #fff) center / cover no-repeat;
      display: flex; align-items: center; justify-content: center;
      color: var(--wlo-muted); font-size: 1.8rem;
    }
    .preview-row .body { flex: 1; min-width: 0; }
    .preview-card h4 {
      margin: 0 0 6px; font-size: .8rem; color: var(--wlo-muted);
      text-transform: uppercase; letter-spacing: .04em;
    }
    .preview-card .full-desc {
      white-space: pre-wrap; line-height: 1.55; color: var(--wlo-text);
      font-size: .92rem; margin: 0;
    }
    .meta-grid {
      display: grid; grid-template-columns: max-content 1fr;
      gap: 6px 14px; font-size: .85rem; align-items: baseline;
    }
    .meta-grid dt { color: var(--wlo-muted); font-weight: 500; }
    .meta-grid dd { margin: 0; color: var(--wlo-text); word-break: break-word; }
    .meta-grid dd a { color: var(--wlo-primary); }
    .kw-list { display: flex; flex-wrap: wrap; gap: 5px; }
    .kw-list .kw {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      padding: 2px 8px; border-radius: 999px;
      font-size: .76rem; color: var(--wlo-muted);
    }
    .preview-attachments { margin-top: 4px; }
    .preview-attachments h4 { margin-bottom: 8px; }
    .preview-attachments .att {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 12px; margin: 0 8px 6px 0;
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 8px; font-size: .88rem;
    }
    .preview-attachments .att .filename { font-weight: 600; color: var(--wlo-text); }
    .preview-attachments .att .att-actions {
      display: inline-flex; gap: 6px; margin-left: 6px;
    }
    .preview-attachments .att a {
      color: var(--wlo-primary); text-decoration: none;
      padding: 3px 8px; border-radius: 4px;
      background: var(--wlo-primary-soft, #e6edf7); font-size: .82rem;
    }
    .preview-attachments .att a:hover { background: var(--wlo-primary); color: #fff; }
    .preview-loading { color: var(--wlo-muted); font-size: .9rem; padding: 8px 0; }
    /* Einreicher-Wunsch (target-topic) — Hinweis direkt über der Move-Aktion,
       damit klar ist, dass das Ziel-Dropdown nach Wunsch vorausgewählt wurde. */
    .wish-hint {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      margin-top: 10px; padding: 8px 12px;
      background: #e6f4ea; border: 1px solid #b6dfc4; border-left: 3px solid #2e9e5b;
      border-radius: 6px; font-size: .86rem; color: var(--wlo-text);
    }
    .wish-hint .wish-ico { font-size: 1rem; line-height: 1; }
    .wish-ok { color: #0f5b24; font-weight: 600; margin-left: auto; }
    .wish-apply {
      margin-left: auto; cursor: pointer; font: inherit; font-size: .82rem;
      border: 1px solid var(--wlo-primary); color: var(--wlo-primary);
      background: transparent; padding: 3px 10px; border-radius: 5px;
    }
    .wish-apply:hover { background: var(--wlo-primary); color: #fff; }
    .meta-grid .wish-dt { color: #0f5b24; font-weight: 600; }
    .meta-grid .wish-dd { font-weight: 600; }
    .meta-grid .place-dt { color: var(--wlo-primary); font-weight: 600; }
    .meta-grid .place-dd { font-weight: 600; }
    .actions {
      display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      padding-top: 10px; border-top: 1px dashed var(--wlo-border);
    }
    .actions select { flex: 1; min-width: 220px; max-width: 360px;
                      padding: 7px 10px; border: 1px solid var(--wlo-border);
                      border-radius: 6px; background: var(--wlo-surface, #fff); font: inherit; }
    .actions .spacer { flex: 1; }
    .empty { text-align: center; color: var(--wlo-muted); padding: 60px 20px;
             background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px; }
    .confirm { background: var(--wlo-accent-soft, #fff8db); border: 1px solid #f5b600; padding: 10px 14px;
               border-radius: 6px; display: flex; gap: 10px; align-items: center; font-size: .88rem; }
    .loading { padding: 40px; text-align: center; color: var(--wlo-muted); }
    .stat-ico {
      width: 14px; height: 14px;
      vertical-align: -2px; margin-right: 4px; flex-shrink: 0;
      stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; fill: none;
    }
    /* Bulk-Move-Bar in Inbox */
    .bulk-bar {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
      padding: 10px 16px; margin-bottom: 14px;
      background: var(--wlo-primary, #1d3a6e); color: #fff;
      border-radius: 8px;
      strong { font-weight: 700; }
      select { padding: 6px 10px; border: none; border-radius: 6px;
               font: inherit; min-width: 180px; }
      .bulk-msg { font-size: .85rem; opacity: .9; }
    }
    .item.selected { background: #f0f5ff; border-color: var(--wlo-primary);
                     box-shadow: 0 0 0 1px var(--wlo-primary); }
    .bulk-check { width: 18px; height: 18px; cursor: pointer;
                  margin-top: 4px; flex-shrink: 0; }
    /* Textlink-Tabs (z.B. Inbox-Filter) — visuell wie die oberen Tabs,
       aber ohne Bottom-Border-Channel; nutzt einen Unterstrich beim
       aktiven Eintrag. */
    .inbox-filter-row {
      display: flex; flex-wrap: wrap; align-items: center;
      gap: 0 14px; margin-bottom: 14px;
      font-size: .92rem;
    }
    .inbox-filter-label {
      color: var(--wlo-muted); font-weight: 600;
      font-size: .82rem; margin-right: 6px;
    }
    /* Aktionen (Aktualisieren / Sync) rechtsbündig in der Filterzeile. */
    .inbox-toolbar { margin-left: auto; display: inline-flex; gap: 8px; flex-shrink: 0; }
    .link-tab {
      background: none; border: none; padding: 4px 0; margin: 0;
      cursor: pointer; font: inherit; font-size: .92rem; font-weight: 600;
      color: var(--wlo-muted); white-space: nowrap;
      border-bottom: 2px solid transparent;
      &:hover { color: var(--wlo-primary); }
      &.on {
        color: var(--wlo-primary);
        border-bottom-color: var(--wlo-primary);
      }
    }
    .vis-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 9px; border-radius: 999px; font-size: .72rem; font-weight: 600;
      &.hidden { background: #fdecef; color: #b00020; }
      &.live   { background: #e6f4ea; color: #0f5b24; }
    }
  `],
  template: `
        <div class="intro">
          Neu eingereichte Ideen landen hier. Ordne jede einer Herausforderung
          zu — Ziel rechts wählen und „Verschieben" — oder lösche Dubletten und
          Spam direkt.
        </div>
        <div class="inbox-filter-row">
          <span class="inbox-filter-label">Anzeigen:</span>
          <button class="link-tab" [class.on]="inboxFilter === 'uncategorized'"
                  (click)="setInboxFilter('uncategorized')">
            Inbox
            @if (inboxCounts['uncategorized'] !== undefined) { ({{ inboxCounts['uncategorized'] }}) }
          </button>
          <button class="link-tab" [class.on]="inboxFilter === 'all'"
                  (click)="setInboxFilter('all')">
            Alle
            @if (inboxCounts['all'] !== undefined) { ({{ inboxCounts['all'] }}) }
          </button>
          <button class="link-tab" [class.on]="inboxFilter === 'categorized'"
                  (click)="setInboxFilter('categorized')">
            In Herausforderung
            @if (inboxCounts['categorized'] !== undefined) { ({{ inboxCounts['categorized'] }}) }
          </button>
          <button class="link-tab" [class.on]="inboxFilter === 'diff'"
                  (click)="setInboxFilter('diff')">
            Sync-Differenz
            @if (inboxCounts['diff'] !== undefined) { ({{ inboxCounts['diff'] }}) }
          </button>
          <span class="inbox-toolbar">
            <button class="btn" (click)="load()" [disabled]="loading()">↻ Aktualisieren</button>
            <button class="btn" (click)="resync()" [disabled]="syncing()">
              {{ syncing() ? 'Synchronisiert…' : 'edu-sharing Sync auslösen' }}
            </button>
          </span>
        </div>

        @if (inboxFilter === 'diff') {
          <ideendb-sync-diff
            [challengeGroups]="challengeGroups()"
            [refresh]="diffRefresh"
            (countChanged)="inboxCounts['diff'] = $event" />
        } @else if (loading()) {
        <div class="loading">Lädt…</div>
      } @else if (!items().length) {
        <div class="empty">
          <p>🎉 Keine offenen Einreichungen.</p>
          <p style="font-size:.9rem">Neue Ideen erscheinen hier, sobald jemand im Formular „+ Idee einreichen" abschickt.</p>
        </div>
      } @else {
        @if (selectedInbox.size) {
          <div class="bulk-bar">
            <strong>{{ selectedInbox.size }} ausgewählt</strong>
            <select [(ngModel)]="bulkTarget">
              <option [ngValue]="undefined">— Themenbereich › Herausforderung —</option>
              @for (grp of challengeGroups(); track grp.themeId) {
                <optgroup [label]="grp.themeTitle">
                  @for (c of grp.challenges; track c.id) {
                    <option [ngValue]="c.id">{{ c.title }}</option>
                  }
                </optgroup>
              }
            </select>
            <button class="btn primary-move"
                    [disabled]="!bulkTarget || bulkBusy"
                    (click)="doBulkMove()">
              {{ bulkBusy ? 'Verschiebt…' : '➜ Alle verschieben' }}
            </button>
            <button class="btn" (click)="selectedInbox.clear()">Auswahl aufheben</button>
            @if (bulkResultMsg) { <span class="bulk-msg">{{ bulkResultMsg }}</span> }
          </div>
        }
        @for (it of items(); track it.id) {
          <div class="item" [class.selected]="selectedInbox.has(it.id)">
            <div class="head">
              <input type="checkbox" class="bulk-check" [title]="'Für Bulk-Aktion auswählen'"
                     [checked]="selectedInbox.has(it.id)"
                     (change)="toggleBulk(it.id)" />
              <div class="titlewrap">
                <h3>{{ it.title || it.name || '(ohne Titel)' }}</h3>
                <div class="tags">
                  @if (it.phase) { <span class="tag phase">{{ it.phase }}</span> }
                  @if (it.event) {
                    <span class="tag event">
                      <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      {{ it.event }}
                    </span>
                  }
                  @if (it.target_topic && topicsById[it.target_topic]) {
                    <span class="tag target">➜ {{ topicTitleFor(it.target_topic) }}</span>
                  }
                  @if (it.in_collection) {
                    @if (it.placements?.length) {
                      @for (pid of it.placements; track pid) {
                        <span class="tag" style="background:#e6f6ec;color:#137333">✓ {{ topicTitleFor(pid) }}</span>
                      }
                    } @else {
                      <span class="tag" style="background:#e6f6ec;color:#137333">✓ In Herausforderung</span>
                    }
                  }
                </div>
              </div>
            </div>

            @if (it.description) {
              <p class="desc" [class.expanded]="expandedInbox.has(it.id)">{{ it.description }}</p>
            }

            <div class="meta-row">
              @if (it.author) { <span>👤 {{ it.author }}</span> }
              @if (it.created_at) {
                <span>
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {{ formatDate(it.created_at) }}
                </span>
              }
              @if (it.project_url) {
                <span>🔗 <a [href]="it.project_url" target="_blank" rel="noopener">{{ shortUrl(it.project_url) }}</a></span>
              }
              <span class="id">{{ it.id }}</span>
              <span class="spacer"></span>
              <button type="button" class="preview-toggle"
                      (click)="toggleInboxPreview(it.id)">
                {{ expandedInbox.has(it.id) ? '▴ Vorschau schließen' : '▾ Vorschau öffnen' }}
              </button>
            </div>

            @if (expandedInbox.has(it.id)) {
              @if (inboxPreview[it.id]; as p) {
                <div class="preview-card">
                  <!-- Header: Vorschaubild + Metadaten-Grid -->
                  <div class="preview-row">
                    <div class="thumb"
                         [style.background-image]="p.preview_url ? 'url(' + p.preview_url + ')' : null">
                      @if (!p.preview_url) { 📄 }
                    </div>
                    <div class="body">
                      <h4>Metadaten</h4>
                      <dl class="meta-grid">
                        @if (it.placements?.length) {
                          @for (pid of it.placements; track pid) {
                            <dt class="place-dt">✅ Einsortiert in</dt>
                            <dd class="place-dd">{{ topicTitleFor(pid) }}</dd>
                          }
                        }
                        @if (wishedChallenge(it); as wc) {
                          <dt class="wish-dt">📂 Gewünschter Themenbereich</dt>
                          <dd class="wish-dd">{{ wishThemeTitle(wc.id) }}</dd>
                          <dt class="wish-dt">🎯 Gewünschte Herausforderung</dt>
                          <dd class="wish-dd">{{ wc.title }}</dd>
                        }
                        @if (p.submitter) {
                          <dt>📨 Eingereicht von (Login)</dt><dd>{{ p.submitter }}</dd>
                        }
                        @if (p.owner_username) {
                          <dt>👤 Owner (ES)</dt><dd>{{ p.owner_username }}</dd>
                        }
                        @if (p.author && p.author !== p.owner_username) {
                          <dt>
                            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 20h9"/>
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
                            </svg>
                            Autor (Freitext)
                          </dt><dd>{{ p.author }}</dd>
                        }
                        @if (p.project_url) {
                          <dt>🔗 Projekt-Link</dt>
                          <dd><a [href]="p.project_url" target="_blank" rel="noopener">{{ p.project_url }}</a></dd>
                        }
                        @if (p.contact) {
                          <dt class="wish-dt">✉️ Kontakt (nur Mod)</dt>
                          <dd class="wish-dd">{{ p.contact }}</dd>
                        }
                        @if (p.phase) {
                          <dt>
                            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                              <line x1="4" y1="22" x2="4" y2="15"/>
                            </svg>
                            Phase
                          </dt><dd>{{ p.phase }}</dd>
                        }
                        @if (p.events?.length) {
                          <dt>
                            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                              <line x1="16" y1="2" x2="16" y2="6"/>
                              <line x1="8" y1="2" x2="8" y2="6"/>
                              <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            Veranstaltung(en)
                          </dt>
                          <dd>{{ p.events?.join(', ') }}</dd>
                        }
                        @if (p.created_at) {
                          <dt>🆕 Erstellt</dt><dd>{{ formatDate(p.created_at) }}</dd>
                        }
                        @if (p.modified_at && p.modified_at !== p.created_at) {
                          <dt>✎ Geändert</dt><dd>{{ formatDate(p.modified_at) }}</dd>
                        }
                        @if (p.rating_count) {
                          @if (votingMode === 'thumbs') {
                            <dt>
                              <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                              </svg>
                              Zustimmung
                            </dt>
                            <dd>👍 {{ p.rating_count }}</dd>
                          } @else {
                            <dt>
                              <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>
                              </svg>
                              Bewertung
                            </dt>
                            <dd>{{ p.rating_avg?.toFixed(1) }} / 5 ({{ p.rating_count }})</dd>
                          }
                        }
                        @if (p.comment_count) {
                          <dt>
                            <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            Kommentare
                          </dt><dd>{{ p.comment_count }}</dd>
                        }
                      </dl>
                    </div>
                  </div>

                  <!-- Volltext (falls über Karte hinaus) -->
                  @if (p.description) {
                    <div>
                      <h4>Beschreibung</h4>
                      <p class="full-desc">{{ p.description }}</p>
                    </div>
                  }

                  <!-- Keywords / Schlagwörter -->
                  @if (p.keywords?.length) {
                    <div>
                      <h4>Schlagwörter ({{ p.keywords?.length }})</h4>
                      <div class="kw-list">
                        @for (kw of p.keywords; track kw) {
                          <span class="kw">#{{ kw }}</span>
                        }
                      </div>
                    </div>
                  }

                  <!-- Anhänge -->
                  @if (p.attachments?.length) {
                    <div class="preview-attachments">
                      <h4>Dokumente / Anhänge ({{ p.attachments?.length }})</h4>
                      @for (a of p.attachments; track a.id) {
                        <span class="att">
                          <span>{{ attIcon(a) }}</span>
                          <span class="filename">{{ a.title || a.name || 'Datei' }}</span>
                          @if (a.mimetype) {
                            <small style="color:var(--wlo-muted)">{{ a.mimetype }}</small>
                          }
                          @if (a.size) {
                            <small style="color:var(--wlo-muted)">· {{ formatSize(a.size) }}</small>
                          }
                          <span class="att-actions">
                            @if (a.download_url) {
                              <a [href]="a.download_url" target="_blank" rel="noopener" download>
                                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                  <polyline points="7 10 12 15 17 10"/>
                                  <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                                Download
                              </a>
                            }
                            @if (a.render_url) {
                              <a [href]="a.render_url" target="_blank" rel="noopener">
                                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                  <polyline points="15 3 21 3 21 9"/>
                                  <line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                                Öffnen
                              </a>
                            }
                          </span>
                        </span>
                      }
                    </div>
                  }
                </div>
              } @else {
                <div class="preview-loading">Lädt Vorschau…</div>
              }
            }

            @if (wishedChallenge(it); as wc) {
              <div class="wish-hint">
                <span class="wish-ico">💡</span>
                <span>Vom Einreicher gewünscht:
                  <strong>{{ wishThemeTitle(wc.id) }} › {{ wc.title }}</strong></span>
                @if (moveTargets[it.id] === wc.id) {
                  <span class="wish-ok">✓ als Ziel vorausgewählt</span>
                } @else {
                  <button type="button" class="wish-apply"
                          (click)="moveTargets[it.id] = wc.id">übernehmen</button>
                }
              </div>
            }
            <div class="actions">
              <select [(ngModel)]="moveTargets[it.id]"
                      (focus)="suggestMoveTarget(it)">
                <option [ngValue]="undefined">— Themenbereich › Herausforderung wählen —</option>
                @for (grp of challengeGroups(); track grp.themeId) {
                  <optgroup [label]="grp.themeTitle">
                    @for (c of grp.challenges; track c.id) {
                      <option [ngValue]="c.id">{{ c.title }}</option>
                    }
                  </optgroup>
                }
              </select>
              <button class="btn primary-move"
                      [disabled]="!moveTargets[it.id] || movingId === it.id"
                      (click)="doMove(it.id)">
                {{ movingId === it.id ? 'Verschiebt…' : '➜ Verschieben' }}
              </button>
              <button class="btn" (click)="openInRepo(it.id)">
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Im Repo
              </button>
              @if (confirmId === it.id) {
                <span class="confirm">
                  Sicher?
                  <button class="btn danger" (click)="doDelete(it.id)">Ja, löschen</button>
                  <button class="btn" (click)="confirmId=null">Abbrechen</button>
                </span>
              } @else {
                <button class="btn danger" (click)="confirmId=it.id">
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                  Löschen
                </button>
              }
              @if (moveError[it.id]) {
                <span style="color:#b00020; font-size:.82rem">{{ moveError[it.id] }}</span>
              }
            </div>
          </div>
        }
      }
  `,
})
export class InboxListComponent implements OnInit {
  api = inject(ApiService);

  /** Basis-URL des edu-sharing-Repos (für das Öffnen im Repo). */
  @Input() repoBaseUrl = 'https://redaktion.openeduhub.net';
  /** Globaler Bewertungsmodus (Sterne vs. Daumen) — Source-of-Truth im
   *  Parent (Settings); hier nur für die korrekte Vorschau-Darstellung. */
  @Input() votingMode: 'stars' | 'thumbs' = 'stars';
  /** Aktuelle Item-Anzahl nach jedem Laden — der Parent hält damit die
   *  „Postfach (N)"-Nav-Pille aktuell (Muster wie reports-list.countChanged). */
  @Output() countChanged = new EventEmitter<number>();

  items = signal<InboxItem[]>([]);
  loading = signal(false);
  syncing = signal(false);
  confirmId: string | null = null;
  topicsById: Record<string, Topic> = {};
  /** Herausforderungen gruppiert nach Themenbereich — für die optgroup-Auswahl
   *  im Postfach, damit Themenbereich UND Herausforderung beim Einsortieren
   *  sichtbar sind. */
  challengeGroups = signal<{ themeId: string; themeTitle: string; challenges: Topic[] }[]>([]);
  moveTargets: Record<string, string | undefined> = {};
  moveError: Record<string, string> = {};
  movingId: string | null = null;

  ngOnInit() {
    // Wie zuvor im Parent: Topic-Maps und Inbox-Items parallel anstoßen —
    // prefillMoveTargets ist idempotent und läuft nach BEIDEN Antworten.
    this.reloadTopicMaps();
    this.load();
  }

  // ===== Bulk-Move (Inbox) =====
  selectedInbox = new Set<string>();
  /** IDs der Inbox-Einträge, deren Vorschau ausgeklappt ist. */
  expandedInbox = new Set<string>();
  bulkTarget?: string;
  bulkBusy = false;
  bulkResultMsg = '';

  toggleBulk(id: string) {
    if (this.selectedInbox.has(id)) this.selectedInbox.delete(id);
    else this.selectedInbox.add(id);
    this.bulkResultMsg = '';
  }

  /** Cache der schon geladenen Vorschau-Detaildaten je Inbox-Eintrag.
   *  Lädt lazy beim ersten Aufklappen via /api/v1/inbox/{id}/preview — direkt
   *  aus edu-sharing, damit auch noch nicht einsortierte Einreichungen (die
   *  `getIdea` mangels Cache-Eintrag mit 404 quittiert) vollständig mit
   *  Beschreibung, Schlagwörtern und Anhängen geprüft werden können. */
  inboxPreview: Record<string, InboxPreview> = {};

  toggleInboxPreview(id: string) {
    if (this.expandedInbox.has(id)) {
      this.expandedInbox.delete(id);
      return;
    }
    this.expandedInbox.add(id);
    if (!this.inboxPreview[id]) {
      this.api.inboxItemPreview(id).subscribe({
        next: (idea) => { this.inboxPreview[id] = idea; },
        error: () => {
          // Fallback: minimaler Stub mit Inbox-Daten, damit was angezeigt wird
          const it = this.items().find(x => x.id === id);
          this.inboxPreview[id] = {
            description: it?.description || '',
            preview_url: null, attachments: [],
          };
        },
      });
    }
  }

  attIcon(a: Attachment): string {
    const m = (a?.mimetype || '').toLowerCase();
    if (m.startsWith('image/')) return '🖼';
    if (m === 'application/pdf') return '📕';
    if (m.startsWith('video/')) return '🎬';
    if (m.startsWith('audio/')) return '🎵';
    if (m.includes('zip') || m.includes('archive')) return '🗜';
    return '📄';
  }
  doBulkMove() {
    if (!this.bulkTarget || !this.selectedInbox.size) return;
    this.bulkBusy = true;
    this.bulkResultMsg = '';
    const ids = Array.from(this.selectedInbox);
    this.api.bulkMove(ids, this.bulkTarget).subscribe({
      next: (r) => {
        this.bulkBusy = false;
        this.bulkResultMsg = `${r.succeeded_count}/${ids.length} verschoben`
          + (r.failed_count ? ` · ${r.failed_count} Fehler` : '');
        this.selectedInbox.clear();
        this.bulkTarget = undefined;
        this.load();
      },
      error: (e) => {
        this.bulkBusy = false;
        alert(`Bulk-Move fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }

  /** Baut die Topic-Maps (topicsById, challengeGroups) für Wunsch-Ziele
   *  und die Move-Dropdowns auf. Läuft bei jedem Tab-Eintritt frisch
   *  (ngOnInit über das @if des Parents) — Änderungen aus dem Themen-
   *  Editor sind so beim nächsten Postfach-Besuch automatisch sichtbar. */
  reloadTopicMaps() {
    this.api.topics().subscribe({
      next: (ts) => {
      this.topicsById = Object.fromEntries(ts.map((t) => [t.id, t]));
      // Challenge-Ebene (Ebene 2) als Move-Ziel — Moderator sortiert Ideen
      // konkret in eine Herausforderung, nicht in den Themen-Oberbereich.
      const challenges = ts.filter((t) => t.parent_id);
      // Nach Themenbereich gruppieren (für die optgroup-Auswahl).
      const themes = ts.filter((t) => !t.parent_id);
      const known = new Set(themes.map((t) => t.id));
      const groups = themes
        .map((theme) => ({
          themeId: theme.id,
          themeTitle: theme.title,
          challenges: challenges
            .filter((c) => c.parent_id === theme.id)
            .sort((a, b) => a.title.localeCompare(b.title)),
        }))
        .filter((g) => g.challenges.length)
        .sort((a, b) => a.themeTitle.localeCompare(b.themeTitle));
      // Defensive: Herausforderungen ohne (bekanntes) Eltern-Thema separat.
      const orphans = challenges.filter((c) => !c.parent_id || !known.has(c.parent_id));
      if (orphans.length) {
        groups.push({ themeId: '_orphan', themeTitle: 'Weitere', challenges: orphans });
      }
      this.challengeGroups.set(groups);
      // Falls die Items schon geladen sind (Topics-Request kam später):
      // Wunsch-Ziele jetzt vorbelegen.
      this.prefillMoveTargets();
      },
      error: () => { /* soft-fail: Move-Ziel-Dropdowns bleiben leer, kein uncaught error */ },
    });
  }

  inboxFilter: 'uncategorized' | 'all' | 'categorized' | 'diff' = 'uncategorized';
  inboxCounts: Record<string, number | undefined> = {};
  /** Zähl-Tick für das Sync-Diff-Kind: der Aktualisieren-Button erhöht ihn,
   *  das Kind gleicht dann neu ab (statt es zu zerstören/neu zu mounten). */
  diffRefresh = 0;

  // ===== Sync-Differenz ===== → ausgelagert nach sync-diff.component.ts
  // (lädt beim Mount + bei [refresh]-Tick; meldet (countChanged) für die Pille)

  setInboxFilter(f: 'uncategorized' | 'all' | 'categorized' | 'diff') {
    if (this.inboxFilter === f) return;
    this.inboxFilter = f;
    if (f !== 'diff') this.load();  // 'diff': das Sync-Diff-Kind lädt sich selbst
  }

  /** Holt die Counts der ÜBRIGEN Inbox-Filter für die „(N)"-Anzeige. Der
   *  aktive Filter ist bereits durch `load()` bekannt und wird hier
   *  übersprungen (sonst ein redundanter Live-ES-Walk pro Postfach-Öffnung). */
  private loadInboxCounts() {
    const filters = (['uncategorized', 'all', 'categorized'] as const)
      .filter((f) => f !== this.inboxFilter);
    for (const f of filters) {
      this.api.inbox(f).subscribe({
        next: (r) => (this.inboxCounts[f] = (r as { total?: number }).total ?? r.count),
        error: () => { /* Zähler-Nebenabfrage — Fehler ignorieren */ },
      });
    }
  }

  load() {
    if (this.inboxFilter === 'diff') { this.diffRefresh++; return; }  // Kind neu abgleichen
    const filter = this.inboxFilter;
    this.loading.set(true);
    this.api.inbox(filter).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.countChanged.emit(r.items.length);
        // Count des AKTIVEN Filters aus dem Haupt-Load übernehmen (kein
        // zweiter Request dafür); die übrigen holt loadInboxCounts.
        this.inboxCounts[filter] = (r as { total?: number }).total ?? r.count;
        this.prefillMoveTargets();
        this.loading.set(false);
        this.loadInboxCounts();
      },
      error: () => this.loading.set(false),
    });
  }

  /** Wunsch-Einsortierung des Einreichers (`target-topic:`) als Default in das
   *  Ziel-Dropdown setzen, damit die Herausforderung bei der Annahme bereits
   *  vorausgewählt ist und die Moderation nur noch „Verschieben" klicken muss.
   *  Nur wenn das Ziel eine bekannte, wählbare Herausforderung (Ebene 2) ist
   *  und die Mod noch keine eigene Auswahl getroffen hat — idempotent, daher
   *  gefahrlos sowohl nach dem Items-Load als auch nach dem Topics-Load aufrufbar
   *  (die beiden Requests laufen parallel, die Reihenfolge ist nicht garantiert). */
  private prefillMoveTargets() {
    for (const it of this.items()) {
      if (this.moveTargets[it.id]) continue;
      const t = it.target_topic;
      if (t && this.topicsById[t]?.parent_id) {
        this.moveTargets[it.id] = t;
      }
    }
  }

  /** Titel des Themenbereichs (Eltern-Themas) zur gewünschten Herausforderung. */
  wishThemeTitle(targetTopicId: string): string {
    const c = this.topicsById[targetTopicId];
    const parent = c?.parent_id ? this.topicsById[c.parent_id] : null;
    return parent?.title || c?.title || '';
  }

  /** Die vom Einreicher gewünschte, wählbare Herausforderung (Ebene 2) zu
   *  einem Item — oder null, wenn kein bzw. kein bekanntes Ziel hinterlegt ist.
   *  Kapselt die Null-Prüfung für die Template-Typsicherheit. */
  wishedChallenge(it: InboxItem): Topic | null {
    const t = it.target_topic;
    const c = t ? this.topicsById[t] : null;
    return c?.parent_id ? c : null;
  }

  doDelete(id: string) {
    this.api.deleteInboxItem(id).subscribe({
      next: () => {
        this.confirmId = null;
        this.load();
      },
      error: (e) => alert(`Löschen fehlgeschlagen: ${e?.error?.detail || 'HTTP ' + (e?.status ?? '?')}`),
    });
  }

  /** Beim ersten Fokus auf das Dropdown: wenn die Idee einen
   *  `target-topic:`-Hinweis des Einreichers trägt, als Vorschlag setzen. */
  suggestMoveTarget(it: InboxItem) {
    if (this.moveTargets[it.id]) return;
    if (it.target_topic && this.topicsById[it.target_topic]) {
      this.moveTargets[it.id] = it.target_topic;
    }
  }

  doMove(id: string) {
    const target = this.moveTargets[id];
    if (!target) return;
    this.movingId = id;
    this.moveError[id] = '';
    this.api.moveInboxItem(id, target).subscribe({
      next: () => {
        this.movingId = null;
        delete this.moveTargets[id];
        this.load();
      },
      error: (e) => {
        this.movingId = null;
        this.moveError[id] = this.friendlyMoveError(e);
      },
    });
  }

  /** Übersetzt häufige edu-sharing-Fehler in lesbare Mod-Hinweise.
   *  Bleibt sprachlich kurz, damit der Hinweis neben der Idee Platz hat. */
  private friendlyMoveError(e: HttpErrorResponse): string {
    const detail: string = e?.error?.detail || '';
    const status = e?.status || 0;
    if (detail.includes('DAODuplicateNodeNameException') || status === 409) {
      return 'Idee ist bereits in dieser Herausforderung referenziert.';
    }
    if (detail.includes('DAOSecurityException') || detail.includes('DAOToolPermissionException')) {
      return 'Keine Berechtigung — der Admin muss die Sammlung freischalten.';
    }
    if (status === 401) return 'Nicht angemeldet.';
    if (status === 403) return 'Keine Mod-Rechte für diese Aktion.';
    if (status === 404) return 'Ziel-Herausforderung nicht gefunden.';
    if (status === 502) return 'edu-sharing antwortet gerade nicht — bitte gleich nochmal probieren.';
    // Fallback: erste Zeile des Detail-Strings, oder generisch
    const firstLine = detail.split('\n')[0]?.slice(0, 120);
    return firstLine || `Fehler (HTTP ${status || '?'})`;
  }

  resync() {
    this.syncing.set(true);
    this.api.triggerSync().subscribe({
      next: () => this.syncing.set(false),
      error: () => this.syncing.set(false),
    });
  }

  openInRepo(id: string) {
    window.open(
      `${this.repoBaseUrl}/edu-sharing/components/render/${id}`,
      '_blank',
      'noopener',
    );
  }

  topicTitleFor(id: string) {
    const t = this.topicsById[id];
    if (!t) return id.slice(0, 8);
    const parent = t.parent_id ? this.topicsById[t.parent_id] : null;
    return parent ? `${parent.title} › ${t.title}` : t.title;
  }

  formatDate(iso: string) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE');
  }

  shortUrl(u: string) {
    try { return new URL(u).hostname; } catch { return u; }
  }

  // Delegat auf die geteilte Util (format-utils.ts) — eine Quelle für alle
  // Mod-Komponenten.
  formatSize(b: number): string { return fmtSize(b); }
}
