import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';

/**
 * „⚠ Problem melden"-Modal — aus idea-detail.component.ts herausgelöst
 * (verhaltensgleich). In sich geschlossen: nimmt nur `ideaId`/`ideaTitle`/
 * `shareUrl` als Inputs, lädt den eigenen „bereits gemeldet?"-Status ERST bei
 * Öffnung (ngOnInit) — dadurch entfällt der frühere unbedingte Status-Fetch
 * im Detail-`load()` (ein Request weniger pro Detailaufruf). Wird vom Eltern-
 * `@if (reportOpen …)` erzeugt; `(closed)` schließt es.
 */
@Component({
  selector: 'ideendb-report-problem-modal',
  standalone: true,
  imports: [FormsModule],
  styles: [`
    :host { display: block; }
    .edit-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 200;
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .edit-box {
      background: var(--wlo-surface, #fff); border-radius: 12px; padding: 24px 28px;
      width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .edit-head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 16px;
      h2 { margin: 0; color: var(--wlo-primary); font-size: 1.2rem; }
      .x { background: none; border: none; font-size: 1.6rem; cursor: pointer;
           color: var(--wlo-muted); line-height: 1; padding: 0 4px;
           &:hover { color: var(--wlo-text); } }
    }
    textarea {
      width: 100%; padding: 9px 12px; border: 1px solid var(--wlo-border);
      border-radius: 8px; box-sizing: border-box; font: inherit;
      resize: vertical; min-height: 100px;
      &:focus { outline: none; border-color: var(--wlo-primary); }
    }
    .edit-actions {
      display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px;
    }
    .action-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      background: var(--wlo-bg); border: 1px solid var(--wlo-border);
      padding: 10px 14px; border-radius: 8px; cursor: pointer; font: inherit;
      font-weight: 600; color: var(--wlo-text); font-size: .92rem;
      min-width: 120px;
      &:hover:not(:disabled) { background: var(--wlo-primary-soft, #eef2f7); }
      &[disabled] { opacity: .55; cursor: not-allowed; }
      &.primary {
        background: var(--wlo-primary); color: #fff; border-color: var(--wlo-primary);
        &:hover:not(:disabled) { background: var(--wlo-primary-600); color: #fff; }
      }
    }
  `],
  template: `
    <!-- Overlay-Klick schließt (Maus); Tastatur schließt über die ×- und
         Abbrechen-Buttons. Fokussierbares Fullscreen-Overlay = a11y-Anti-Pattern. -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <div class="edit-overlay" (click)="$event.target === $event.currentTarget && close()">
      <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events -->
      <div class="edit-box" role="dialog" aria-modal="true" aria-label="Problem melden"
           (click)="$event.stopPropagation()">
        <div class="edit-head">
          <h2>⚠ Problem melden</h2>
          <button class="x" (click)="close()" aria-label="Schließen">×</button>
        </div>
        @if (reportSent()) {
          <p style="color: #137333; font-weight: 600; padding: 16px 0;">
            ✓ Meldung gesendet — danke! Das Mod-Team prüft sie zeitnah.
          </p>
        } @else if (reportStatus()?.reported && reportStatus()?.status === 'open') {
          <p style="background: var(--wlo-accent-soft, #fff8db); color: #8a5a00;
                    padding: 10px 14px; border-radius: 8px; margin-top: 0;">
            ⚠ Du hast diese Idee bereits am
            {{ formatHistoryDate(reportStatus()!.created_at!) }} gemeldet.
            Das Mod-Team prüft sie noch.
          </p>
        } @else if (reportStatus()?.reported && reportStatus()?.status === 'resolved') {
          <p style="background: #e6f6ec; color: #137333; padding: 10px 14px;
                    border-radius: 8px; margin-top: 0;">
            ✓ Deine frühere Meldung wurde bearbeitet. Du kannst bei Bedarf erneut melden.
          </p>
          <p style="color: var(--wlo-muted); margin-top: 8px;">
            Was stimmt mit „{{ ideaTitle }}" nicht?
          </p>
        } @else {
          <p style="color: var(--wlo-muted); margin-top: 0;">
            Was stimmt mit „{{ ideaTitle }}" nicht? (Spam, falsche Phase, doppelt, …)
          </p>
          <textarea [(ngModel)]="reportText" rows="5"
                    placeholder="Kurze Beschreibung — wird ans Mod-Team weitergeleitet."></textarea>
          <div class="edit-actions">
            <button class="action-btn" (click)="reportViaMail()">Stattdessen E-Mail</button>
            <button class="action-btn primary"
                    (click)="submit()"
                    [disabled]="reportBusy() || (reportText || '').trim().length < 3">
              {{ reportBusy() ? 'Sendet…' : 'Meldung senden' }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class ReportProblemModalComponent implements OnInit {
  private api = inject(ApiService);

  @Input() ideaId = '';
  @Input() ideaTitle = '';
  @Input() shareUrl = '';
  @Output() closed = new EventEmitter<void>();

  reportText = '';
  reportBusy = signal(false);
  reportSent = signal(false);
  reportStatus = signal<{ reported: boolean; status?: 'open' | 'resolved';
                          created_at?: string } | null>(null);

  ngOnInit() {
    // „Bereits gemeldet?"-Hinweis nur für eingeloggte User (Endpoint gated).
    if (this.api.hasCredentials()) {
      this.api.ideaReportStatus(this.ideaId).subscribe({
        next: (r) => this.reportStatus.set(r),
        error: () => this.reportStatus.set(null),
      });
    }
  }

  close() { this.closed.emit(); }

  submit() {
    const text = (this.reportText || '').trim();
    if (text.length < 3) { return; }
    this.reportBusy.set(true);
    this.api.reportIdea(this.ideaId, text).subscribe({
      next: () => {
        this.reportBusy.set(false);
        this.reportSent.set(true);
        setTimeout(() => this.closed.emit(), 1500);
      },
      error: (e) => {
        this.reportBusy.set(false);
        alert(`Senden fehlgeschlagen: ${e?.error?.detail || e?.message}`);
      },
    });
  }

  /** Fallback: User ohne Login bekommt mailto. */
  reportViaMail() {
    const mail = `mailto:redaktion@wirlernenonline.de`
      + `?subject=${encodeURIComponent('Problem mit Idee: ' + this.ideaTitle)}`
      + `&body=${encodeURIComponent('Idee-ID: ' + this.ideaId + '\nLink: ' + this.shareUrl + '\n\nBeschreibung:\n')}`;
    window.open(mail);
  }

  formatHistoryDate(iso: string): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  }
}
