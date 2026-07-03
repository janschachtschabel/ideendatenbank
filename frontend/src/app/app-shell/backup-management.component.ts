import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../api.service';
import { BackupInfo } from '../models';
import { formatSize, formatTime } from '../format-utils';

/**
 * Backup-Tab des Mod-Bereichs — aus moderation.component.ts herausgelöst
 * (verhaltensgleich): Backup erstellen/auflisten/downloaden/löschen +
 * Restore-Upload. Völlig in sich geschlossen (nur ApiService); lädt sich
 * beim Einblenden selbst (ngOnInit — die Komponente wird vom Tab-@if des
 * Eltern-Templates erst bei Aktivierung erzeugt).
 */
@Component({
  selector: 'ideendb-backup-management',
  standalone: true,
  imports: [],
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
      &:hover { background: var(--wlo-primary-soft, #eef2f7); }
      &[disabled] { opacity: .55; cursor: not-allowed; }
    }
    .btn.danger { background: var(--wlo-surface, #fff); border-color: #e1a5ac; color: #b00020;
                  &:hover { background: #b00020; border-color: #b00020; color: #fff; } }
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
    .empty { text-align: center; color: var(--wlo-muted); padding: 60px 20px;
             background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border); border-radius: 12px; }
    .loading { padding: 40px; text-align: center; color: var(--wlo-muted); }
    .stat-ico {
      width: 14px; height: 14px;
      vertical-align: -2px; margin-right: 4px; flex-shrink: 0;
      stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; fill: none;
    }
    .backup-actions {
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
      margin-bottom: 16px;
      label.btn { cursor: pointer; }
      .backup-msg { font-size: .9rem; color: var(--wlo-muted); }
    }
    .backup-list {
      background: var(--wlo-surface, #fff); border: 1px solid var(--wlo-border);
      border-radius: 8px; overflow: hidden;
    }
    .backup-row {
      display: flex; justify-content: space-between; align-items: center;
      gap: 12px; padding: 10px 16px;
      border-bottom: 1px solid #f1f3f5;
      &:last-child { border-bottom: none; }
      .backup-meta {
        strong { display: block; font-family: monospace; font-size: .9rem;
                 color: var(--wlo-text); }
        small { color: var(--wlo-muted); font-size: .82rem; }
      }
      .backup-actions-row { display: flex; gap: 6px; flex-shrink: 0; }
    }
  `],
  template: `
    <div class="intro">
      Sichert die App-Datenbank (Activity-Log, Trend-Snapshots, Reports,
      Mithacken/Folgen, Taxonomien, Topic-Sortierung) als ZIP. edu-sharing-
      Daten (Ideen, Kommentare, Ratings) werden NICHT gesichert — die
      liegen im edu-sharing-Repo. <strong>Konfiguration / Secrets sind
      ebenfalls NICHT im Backup</strong> — die gehören in System-/Docker-
      Umgebungsvariablen. Auto-Backup läuft alle
      <strong>{{ backupConfig().interval_hours }}h</strong>, behalten werden
      die letzten <strong>{{ backupConfig().keep }}</strong>.
    </div>

    <div class="backup-actions">
      <button class="btn primary-move" (click)="createBackup()"
              [disabled]="backupBusy">
        <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        {{ backupBusy ? 'Erstellt…' : 'Backup jetzt erstellen' }}
      </button>
      <label class="btn">
        <input type="file" accept=".zip" hidden
               (change)="onRestorePick($event)" />
        <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Backup hochladen + wiederherstellen
      </label>
      @if (backupMsg()) { <span class="backup-msg">{{ backupMsg() }}</span> }
    </div>

    @if (backupsLoading()) {
      <div class="loading">Lädt…</div>
    } @else if (!backups().length) {
      <div class="empty"><p>Noch keine Backups vorhanden.</p></div>
    } @else {
      <div class="backup-list">
        @for (b of backups(); track b.filename) {
          <div class="backup-row">
            <div class="backup-meta">
              <strong>{{ b.filename }}</strong>
              <small>
                {{ formatTime(b.created_at) }} ·
                {{ formatSize(b.size) }}
                @if (b.metadata?.idea_count !== undefined) {
                  · {{ b.metadata.idea_count }} Ideen
                }
              </small>
            </div>
            <div class="backup-actions-row">
              <button class="btn" (click)="downloadBackup(b.filename)">
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download
              </button>
              <button class="btn danger" (click)="deleteBackup(b.filename)"
                      aria-label="Löschen">
                <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  <line x1="10" y1="11" x2="10" y2="17"/>
                  <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
              </button>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class BackupManagementComponent implements OnInit {
  private api = inject(ApiService);

  backups = signal<BackupInfo[]>([]);
  backupConfig = signal<{ keep: number; interval_hours: number; enabled: boolean }>({
    keep: 3, interval_hours: 24, enabled: true,
  });
  backupsLoading = signal(false);
  backupBusy = false;
  backupMsg = signal('');

  ngOnInit() { this.loadBackups(); }

  formatTime(iso: string): string { return formatTime(iso); }
  formatSize(b: number): string { return formatSize(b); }

  loadBackups() {
    this.backupsLoading.set(true);
    this.api.listBackups().subscribe({
      next: (r) => {
        this.backups.set(r.backups || []);
        this.backupConfig.set({
          keep: r.keep, interval_hours: r.interval_hours, enabled: r.enabled,
        });
        this.backupsLoading.set(false);
      },
      error: () => { this.backups.set([]); this.backupsLoading.set(false); },
    });
  }
  createBackup() {
    this.backupBusy = true;
    this.backupMsg.set('');
    this.api.createBackup().subscribe({
      next: (r) => {
        this.backupBusy = false;
        this.backupMsg.set(`✓ ${r.filename} (${this.formatSize(r.size)})`);
        this.loadBackups();
        setTimeout(() => this.backupMsg.set(''), 4000);
      },
      error: (e) => {
        this.backupBusy = false;
        this.backupMsg.set(`✗ ${e?.error?.detail || e?.message}`);
      },
    });
  }
  downloadBackup(filename: string) {
    this.api.downloadBackup(filename).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => alert(`Download fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }
  deleteBackup(filename: string) {
    if (!confirm(`Backup „${filename}" wirklich löschen?`)) return;
    this.api.deleteBackup(filename).subscribe({
      next: () => this.loadBackups(),
      error: (e) => alert(`Löschen fehlgeschlagen: ${e?.error?.detail || e?.message}`),
    });
  }
  onRestorePick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!confirm(
      `WARNUNG: Restore aus „${file.name}" überschreibt die gesamte App-Datenbank ` +
      `(Activity-Log, Trends, Reports, Mithacken/Folgen, Taxonomien, ` +
      `Topic-Sortierung). Vor dem Austausch wird automatisch ein „pre-restore"-` +
      `Backup angelegt. edu-sharing-Daten bleiben unangetastet.\n\nFortfahren?`
    )) {
      input.value = '';
      return;
    }
    this.backupMsg.set('Stelle wieder her…');
    this.api.restoreBackup(file).subscribe({
      next: (r) => {
        this.backupMsg.set(`✓ Wiederhergestellt (${this.formatSize(r.size)})`);
        input.value = '';
        this.loadBackups();
      },
      error: (e) => {
        this.backupMsg.set(`✗ ${e?.error?.detail || e?.message}`);
        input.value = '';
      },
    });
  }
}
