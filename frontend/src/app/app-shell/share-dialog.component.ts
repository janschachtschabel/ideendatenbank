import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';

/**
 * Wiederverwendbares Share-Modal: zeigt einen kopierbaren Link, einen
 * QR-Code (extern via qrserver.com — keine PII enthalten) und optional
 * ein Embed-Snippet für den Web-Component-Einbau.
 *
 * Nutzung:
 *   <ideendb-share-dialog
 *     [open]="shareOpen"
 *     [url]="shareUrl"
 *     [title]="'Idee teilen'"
 *     [embedSnippet]="embedCode"
 *     (closed)="shareOpen = false">
 *   </ideendb-share-dialog>
 *
 * Layout-konsistent zu den anderen Modals (.modal-backdrop / .modal-card)
 * und nutzt die WLO-CSS-Custom-Properties — passt sich allen drei Themes
 * an (default / hackathoern / dark).
 */
@Component({
  selector: 'ideendb-share-dialog',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host { display: contents; }
    .backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000; padding: 20px;
    }
    .card {
      background: var(--wlo-surface, #fff);
      color: var(--wlo-text, #1a2334);
      border: 1px solid var(--wlo-border);
      border-radius: 12px;
      width: 100%; max-width: 520px;
      max-height: 90vh; overflow-y: auto;
      box-shadow: 0 16px 40px rgba(0,0,0,.18);
    }
    .card-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid var(--wlo-border);
    }
    .card-head h3 { margin: 0; font-size: 1.05rem; color: var(--wlo-primary); }
    .card-head button {
      background: none; border: none; cursor: pointer;
      font-size: 1.4rem; color: var(--wlo-muted);
      &:hover { color: var(--wlo-text); }
    }
    .body { padding: 18px 20px; }
    .intro { margin: 0 0 14px; font-size: .88rem; color: var(--wlo-muted); }
    label {
      display: block; margin: 12px 0 4px;
      font-size: .82rem; font-weight: 600; color: var(--wlo-text);
      text-transform: uppercase; letter-spacing: .04em;
    }
    .link-row {
      display: flex; gap: 8px; align-items: stretch;
    }
    .link-row input {
      flex: 1; min-width: 0;
      padding: 10px 12px;
      border: 1px solid var(--wlo-border); border-radius: 8px;
      background: var(--wlo-bg);
      color: var(--wlo-text);
      font: inherit;
    }
    .copy {
      padding: 0 14px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--wlo-primary);
      background: var(--wlo-primary); color: #fff;
      font: inherit; font-weight: 600;
      transition: background .12s;
      &:hover { background: #142f5d; }
      &.ok {
        background: #1a7f37; border-color: #1a7f37;
      }
    }
    .qr-row {
      display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
      margin-top: 4px;
    }
    .qr-row img {
      border: 1px solid var(--wlo-border);
      border-radius: 8px;
      background: #fff;
      padding: 6px;
    }
    .qr-actions {
      display: flex; flex-direction: column; gap: 6px;
      font-size: .85rem;
      a {
        color: var(--wlo-primary);
        text-decoration: none;
        &:hover { text-decoration: underline; }
      }
    }
    .embed {
      margin-top: 18px;
    }
    .embed pre {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: .8rem;
      overflow-x: auto;
      color: var(--wlo-text);
      margin: 4px 0 6px;
    }
    .embed .copy-embed {
      background: none; border: none; cursor: pointer;
      color: var(--wlo-primary);
      font: inherit; font-size: .85rem;
      padding: 0;
      &:hover { text-decoration: underline; }
    }
  `],
  template: `
    @if (open) {
      <div class="backdrop" (click)="onBackdrop($event)">
        <div class="card" role="dialog" aria-modal="true">
          <div class="card-head">
            <h3>{{ title }}</h3>
            <button (click)="close()" aria-label="Schließen">×</button>
          </div>
          <div class="body">
            @if (intro) {
              <p class="intro">{{ intro }}</p>
            }

            <label>Direkt-Link</label>
            <div class="link-row">
              <input #linkInput type="text" [value]="url" readonly
                     (click)="linkInput.select()" />
              <button class="copy" [class.ok]="copied()" (click)="copy()">
                {{ copied() ? '✓ Kopiert' : '📋 Kopieren' }}
              </button>
            </div>

            <label>QR-Code</label>
            <div class="qr-row">
              <img [src]="qrUrl(240)" alt="QR-Code" width="180" height="180" />
              <div class="qr-actions">
                <a [href]="qrUrl(600)" target="_blank" rel="noopener">
                  ↗ Hochauflösend (600×600)
                </a>
                <a [href]="qrUrl(600)" [attr.download]="qrFilename">
                  ⬇ Als PNG herunterladen
                </a>
              </div>
            </div>

            @if (embedSnippet) {
              <div class="embed">
                <label>Embed-Snippet (Web Component)</label>
                <pre>{{ embedSnippet }}</pre>
                <button class="copy-embed" [class.ok]="embedCopied()" (click)="copyEmbed()">
                  {{ embedCopied() ? '✓ Kopiert' : '📋 Embed-Code kopieren' }}
                </button>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class ShareDialogComponent {
  @Input() open = false;
  @Input() title = 'Teilen';
  @Input() intro: string | null = null;
  @Input() url = '';
  @Input() embedSnippet: string | null = null;
  @Input() qrFilename = 'qr.png';
  @Output() closed = new EventEmitter<void>();

  copied = signal(false);
  embedCopied = signal(false);
  private copyTimer?: number;
  private embedTimer?: number;

  qrUrl(size: number): string {
    const data = encodeURIComponent(this.url);
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${data}`;
  }

  copy() {
    navigator.clipboard?.writeText(this.url);
    this.copied.set(true);
    if (this.copyTimer) window.clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => this.copied.set(false), 2000);
  }

  copyEmbed() {
    if (!this.embedSnippet) return;
    navigator.clipboard?.writeText(this.embedSnippet);
    this.embedCopied.set(true);
    if (this.embedTimer) window.clearTimeout(this.embedTimer);
    this.embedTimer = window.setTimeout(() => this.embedCopied.set(false), 2000);
  }

  close() { this.closed.emit(); }

  onBackdrop(ev: MouseEvent) {
    // Klick auf den Backdrop selbst (nicht auf die Karte) → schließen
    if ((ev.target as HTMLElement).classList.contains('backdrop')) {
      this.close();
    }
  }
}
