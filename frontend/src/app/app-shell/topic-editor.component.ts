import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { Topic } from '../models';

/**
 * Themenbereiche-Tab des Mod-Bereichs — aus moderation.component.ts
 * herausgelöst (verhaltensgleich): Themen/Herausforderungen anlegen,
 * umbenennen, Vorschaubild setzen, sortieren (▲▼ + Sammel-Speichern),
 * leere löschen. Besitzt seine EIGENE Topic-Liste (lädt via ngOnInit);
 * die Eltern-Komponente hält für Inbox/Versteckt/Sync-Diff separate
 * Topic-Maps und wird nach Mutationen über `(changed)` zum Neuaufbau
 * angestoßen — kein geteilter Zustand, klare Richtung.
 */
@Component({
  selector: 'ideendb-topic-editor',
  standalone: true,
  imports: [FormsModule],
  styles: [`
    :host { display: block; }
    .btn {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--wlo-text);
      &:hover:not(:disabled) { background: var(--wlo-primary-soft, #eef2f7); }
      &[disabled] { opacity: .55; cursor: not-allowed; }
    }
    .btn.primary-move {
      background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
      &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
    }
    .intro {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-left: 4px solid var(--wlo-primary);
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 24px;
      color: var(--wlo-text);
      font-size: .92rem; line-height: 1.55;
    }
    .loading { padding: 40px; text-align: center; color: var(--wlo-muted); }
    .stat-ico {
      width: 14px; height: 14px;
      vertical-align: -2px; margin-right: 4px; flex-shrink: 0;
      stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; fill: none;
    }
    .topic-create-row {
      display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
      margin-bottom: 16px;
      select, input[type=text] {
        padding: 8px 10px; border: 1px solid var(--wlo-border);
        border-radius: 6px; font: inherit; background: var(--wlo-surface, #fff);
      }
      input[type=text] { flex: 1 1 240px; }
    }
    .topic-tree {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 8px; overflow: hidden;
    }
    .topic-root {
      border-bottom: 1px solid var(--wlo-border);
      &:last-child { border-bottom: none; }
    }
    .topic-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px;
      &.editing { background: var(--wlo-bg); }
      &.child   { padding-left: 32px; background: var(--wlo-surface-2, var(--wlo-bg));
                  border-top: 1px solid var(--wlo-border); }
      .sort-handle { display: inline-flex; flex-direction: column; gap: 2px;
        button { background: none; border: 1px solid var(--wlo-border);
          border-radius: 4px; width: 22px; height: 18px; cursor: pointer;
          font-size: .7rem; padding: 0; line-height: 1;
          &:hover:not(:disabled) { background: var(--wlo-bg);
            border-color: var(--wlo-primary); }
          &:disabled { opacity: .3; cursor: not-allowed; } }
      }
      .title { flex: 1; small { color: var(--wlo-muted); margin-left: 6px;
                font-size: .82rem; font-weight: 400; } }
      input[type=text] { flex: 1; padding: 6px 10px;
        border: 1px solid var(--wlo-border); border-radius: 6px;
        font: inherit; }
      .row-actions { display: inline-flex; gap: 4px; }
    }
    .topic-preview {
      width: 36px; height: 36px; object-fit: cover;
      border-radius: 4px; border: 1px solid var(--wlo-border);
    }
    .topic-desc {
      display: block; color: var(--wlo-muted); font-weight: 400;
      font-size: .82rem; margin-top: 2px;
      max-width: 600px;
      overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap;
    }
    .topic-edit-form {
      flex: 1; display: flex; flex-direction: column; gap: 6px;
      input, textarea {
        padding: 6px 10px; border: 1px solid var(--wlo-border);
        border-radius: 6px; font: inherit;
      }
      textarea { resize: vertical; }
    }
    .topic-edit-actions {
      display: flex; gap: 6px; align-items: center;
      label.btn { cursor: pointer; }
    }
    .topic-save-bar {
      padding: 10px 14px;
      background: var(--wlo-accent-soft, #fff8eb);
      color: var(--wlo-text);
      border-top: 1px solid var(--wlo-border);
      display: flex; align-items: center; gap: 12px;
    }
  `],
  template: `
    <div class="intro">
      Themenbereiche (Ebene 1) und Herausforderungen (Ebene 2) verwalten —
      anlegen, umbenennen, sortieren, leere löschen. Reihenfolge mit ▲▼
      pro Zeile, Speichern-Button schreibt die neue sort_order in einem
      Rutsch. <strong>Löschen</strong> erfordert, dass die Sammlung leer ist.
    </div>

    <div class="topic-create-row">
      <select [(ngModel)]="newTopic.parent_id">
        <option [ngValue]="null">— Oberste Ebene (neuer Themenbereich) —</option>
        @for (t of rootThemes(); track t.id) {
          <option [ngValue]="t.id">↳ unter „{{ t.title }}" (Herausforderung)</option>
        }
      </select>
      <input type="text" [(ngModel)]="newTopic.title"
             placeholder="Titel der neuen Sammlung"
             (keyup.enter)="createTopic()" />
      <button class="btn primary-move" (click)="createTopic()"
              [disabled]="topicCreateBusy || !newTopic.title.trim()">
        {{ topicCreateBusy ? '…' : '+ Anlegen' }}
      </button>
    </div>

    @if (topicsLoading()) {
      <div class="loading">Lädt…</div>
    } @else {
      <div class="topic-tree">
        @for (root of rootThemes(); track root.id) {
          <div class="topic-root">
            <div class="topic-row" [class.editing]="editingTopicId === root.id">
              <span class="sort-handle">
                <button (click)="moveTopicUp(root)"   [disabled]="topicSortIndex(root)===0">▲</button>
                <button (click)="moveTopicDown(root)" [disabled]="topicIsLast(root)">▼</button>
              </span>
              @if (editingTopicId === root.id) {
                <div class="topic-edit-form">
                  <input type="text" [(ngModel)]="editTopicTitle" placeholder="Titel" />
                  <textarea [(ngModel)]="editTopicDescription" rows="2"
                            placeholder="Beschreibung (optional)"></textarea>
                  <div class="topic-edit-actions">
                    <label class="btn">
                      <input type="file" accept="image/*" hidden
                             (change)="onTopicPreviewPick($event, root)" />
                      <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      Vorschaubild
                    </label>
                    <button class="btn primary-move" (click)="saveTopicEdit(root)">✓ Speichern</button>
                    <button class="btn" (click)="editingTopicId=null">✕ Abbrechen</button>
                  </div>
                </div>
              } @else {
                @if (root.preview_url) {
                  <img class="topic-preview" [src]="root.preview_url" alt="" />
                }
                <span class="title">
                  <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <strong>{{ root.title }}</strong>
                  @if (root.description) {
                    <small class="topic-desc">{{ root.description }}</small>
                  }
                </span>
                <span class="row-actions">
                  <button class="btn" (click)="startTopicEdit(root)">✎</button>
                  <button class="btn" (click)="deleteTopic(root)"
                          [disabled]="topicChildrenCount(root.id) > 0 || topicIdeasCount(root.id) > 0"
                          [title]="(topicChildrenCount(root.id) || topicIdeasCount(root.id))
                                   ? 'Sammlung ist nicht leer — kann nicht gelöscht werden'
                                   : 'Sammlung löschen'"
                          aria-label="Löschen">
                    <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </button>
                </span>
              }
            </div>
            <div class="topic-children">
              @for (ch of childrenOf(root.id); track ch.id) {
                <div class="topic-row child" [class.editing]="editingTopicId === ch.id">
                  <span class="sort-handle">
                    <button (click)="moveTopicUp(ch)"   [disabled]="topicSortIndex(ch)===0">▲</button>
                    <button (click)="moveTopicDown(ch)" [disabled]="topicIsLast(ch)">▼</button>
                  </span>
                  @if (editingTopicId === ch.id) {
                    <div class="topic-edit-form">
                      <input type="text" [(ngModel)]="editTopicTitle" placeholder="Titel" />
                      <textarea [(ngModel)]="editTopicDescription" rows="2"
                                placeholder="Beschreibung"></textarea>
                      <div class="topic-edit-actions">
                        <label class="btn">
                          <input type="file" accept="image/*" hidden
                                 (change)="onTopicPreviewPick($event, ch)" />
                          <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      Vorschaubild
                        </label>
                        <button class="btn primary-move" (click)="saveTopicEdit(ch)">✓</button>
                        <button class="btn" (click)="editingTopicId=null">✕</button>
                      </div>
                    </div>
                  } @else {
                    @if (ch.preview_url) {
                      <img class="topic-preview" [src]="ch.preview_url" alt="" />
                    }
                    <span class="title">↳ {{ ch.title }}
                      <small>({{ topicIdeasCount(ch.id) }} Ideen)</small>
                      @if (ch.description) {
                        <small class="topic-desc">{{ ch.description }}</small>
                      }
                    </span>
                    <span class="row-actions">
                      <button class="btn" (click)="startTopicEdit(ch)">✎</button>
                      <button class="btn" (click)="deleteTopic(ch)"
                              [disabled]="topicIdeasCount(ch.id) > 0"
                              [title]="topicIdeasCount(ch.id) > 0
                                       ? 'Enthält noch Ideen — kann nicht gelöscht werden'
                                       : 'Herausforderung löschen'"
                              aria-label="Löschen">
                        <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          <line x1="10" y1="11" x2="10" y2="17"/>
                          <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                      </button>
                    </span>
                  }
                </div>
              }
            </div>
          </div>
        }
        @if (topicSortDirty) {
          <div class="topic-save-bar">
            Reihenfolge geändert.
            <button class="btn primary-move" (click)="saveTopicOrder()"
                    [disabled]="topicSortBusy">
              {{ topicSortBusy ? '…' : '✓ Reihenfolge speichern' }}
            </button>
            <button class="btn" (click)="reloadTopicsOrder()">Verwerfen</button>
          </div>
        }
      </div>
    }
  `,
})
export class TopicEditorComponent implements OnInit {
  private api = inject(ApiService);

  /** Nach jeder erfolgreichen Mutation (Anlegen/Umbenennen/Vorschaubild/
   *  Löschen) gefeuert — die Eltern-Komponente baut damit ihre eigenen
   *  Topic-Maps (Inbox-Move-Ziele, Sync-Diff-Gruppen) neu auf. */
  @Output() changed = new EventEmitter<void>();

  topics = signal<Topic[]>([]);
  topicsLoading = signal(false);
  ideasPerTopic: Record<string, number> = {};
  newTopic: { parent_id: string | null; title: string } = { parent_id: null, title: '' };
  topicCreateBusy = false;
  editingTopicId: string | null = null;
  editTopicTitle = '';
  editTopicDescription = '';
  topicSortDirty = false;
  topicSortBusy = false;
  // Lokaler Cache: id → sort_order (wird beim ▲/▼ angepasst, beim Speichern persistiert)
  private topicLocalOrder: Record<string, number> = {};

  ngOnInit() { this.loadTopics(); }

  loadTopics() {
    this.topicsLoading.set(true);
    this.topicSortDirty = false;
    this.api.topics().subscribe({
      next: (ts) => {
        this.topics.set(ts);
        this.topicLocalOrder = Object.fromEntries(
          ts.map((t, i) => [t.id, t.sort_order ?? 100 + i])
        );
        this.topicsLoading.set(false);
        // Ideen-Counts pro Topic für „leer?"-Check
        for (const t of ts) {
          this.api.listIdeas({ topic_id: t.id, limit: 1 }).subscribe((r) => {
            this.ideasPerTopic[t.id] = r.total;
          });
        }
      },
      error: () => { this.topics.set([]); this.topicsLoading.set(false); },
    });
  }
  reloadTopicsOrder() { this.loadTopics(); }

  rootThemes(): Topic[] {
    return this.topics().filter((t) => !t.parent_id)
      .sort((a, b) => this.topicLocalOrder[a.id] - this.topicLocalOrder[b.id]);
  }
  childrenOf(parentId: string): Topic[] {
    return this.topics().filter((t) => t.parent_id === parentId)
      .sort((a, b) => this.topicLocalOrder[a.id] - this.topicLocalOrder[b.id]);
  }
  topicChildrenCount(id: string): number {
    return this.topics().filter((t) => t.parent_id === id).length;
  }
  topicIdeasCount(id: string): number { return this.ideasPerTopic[id] || 0; }
  topicSortIndex(t: Topic): number {
    const siblings = t.parent_id ? this.childrenOf(t.parent_id) : this.rootThemes();
    return siblings.findIndex((s) => s.id === t.id);
  }
  topicIsLast(t: Topic): boolean {
    const siblings = t.parent_id ? this.childrenOf(t.parent_id) : this.rootThemes();
    return this.topicSortIndex(t) === siblings.length - 1;
  }
  moveTopicUp(t: Topic) { this.swapTopic(t, -1); }
  moveTopicDown(t: Topic) { this.swapTopic(t, +1); }
  private swapTopic(t: Topic, dir: -1 | 1) {
    const siblings = t.parent_id ? this.childrenOf(t.parent_id) : this.rootThemes();
    const i = siblings.findIndex((s) => s.id === t.id);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    const a = this.topicLocalOrder[siblings[i].id];
    this.topicLocalOrder[siblings[i].id] = this.topicLocalOrder[siblings[j].id];
    this.topicLocalOrder[siblings[j].id] = a;
    this.topicSortDirty = true;
    // signal-Refresh durch Re-Set
    this.topics.set([...this.topics()]);
  }
  saveTopicOrder() {
    this.topicSortBusy = true;
    const items = Object.entries(this.topicLocalOrder).map(([id, sort_order]) => ({ id, sort_order }));
    this.api.sortTopics(items).subscribe({
      next: () => { this.topicSortBusy = false; this.topicSortDirty = false; },
      error: (e) => {
        this.topicSortBusy = false;
        alert(`Speichern fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }

  createTopic() {
    if (!this.newTopic.title.trim()) return;
    this.topicCreateBusy = true;
    this.api.createTopic({
      parent_id: this.newTopic.parent_id,
      title: this.newTopic.title.trim(),
    }).subscribe({
      next: () => {
        this.topicCreateBusy = false;
        this.newTopic.title = '';
        this.loadTopics();
        this.changed.emit();
      },
      error: (e) => {
        this.topicCreateBusy = false;
        alert(`Anlegen fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }
  startTopicEdit(t: Topic) {
    this.editingTopicId = t.id;
    this.editTopicTitle = t.title;
    this.editTopicDescription = t.description || '';
  }
  saveTopicEdit(t: Topic) {
    const newTitle = this.editTopicTitle.trim();
    const newDesc = this.editTopicDescription.trim();
    const patch: { title?: string; description?: string } = {};
    if (newTitle && newTitle !== t.title) patch.title = newTitle;
    if (newDesc !== (t.description || '')) patch.description = newDesc;
    if (!Object.keys(patch).length) { this.editingTopicId = null; return; }
    this.api.editTopic(t.id, patch).subscribe({
      next: () => { this.editingTopicId = null; this.loadTopics(); this.changed.emit(); },
      error: (e) => alert(`Bearbeiten fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }
  onTopicPreviewPick(ev: Event, t: Topic) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.api.uploadTopicPreview(t.id, file).subscribe({
      next: () => {
        input.value = '';
        // Voll-Sync zieht das Vorschaubild beim nächsten Lauf in den Cache;
        // optimistisch reload nach kurzer Verzögerung.
        setTimeout(() => { this.loadTopics(); this.changed.emit(); }, 1000);
      },
      error: (e) => alert(`Vorschaubild fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }
  deleteTopic(t: Topic) {
    if (!confirm(`Sammlung „${t.title}" wirklich löschen?`)) return;
    this.api.deleteTopic(t.id).subscribe({
      next: () => { this.loadTopics(); this.changed.emit(); },
      error: (e) => alert(`Löschen fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }
}
