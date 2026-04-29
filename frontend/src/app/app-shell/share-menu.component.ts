import { CommonModule } from '@angular/common';
import { Component, HostListener, Input } from '@angular/core';

interface ShareTarget {
  label: string;
  icon: string;
  href: (url: string, text: string) => string;
}

const TARGETS: ShareTarget[] = [
  {
    label: 'E-Mail',
    icon: '✉️',
    href: (u, t) =>
      `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(t + '\n\n' + u)}`,
  },
  {
    label: 'WhatsApp',
    icon: '💬',
    href: (u, t) => `https://wa.me/?text=${encodeURIComponent(t + ' ' + u)}`,
  },
  {
    label: 'X (Twitter)',
    icon: '𝕏',
    href: (u, t) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}`,
  },
  {
    label: 'LinkedIn',
    icon: 'in',
    href: (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}`,
  },
  {
    label: 'Mastodon',
    icon: '🐘',
    href: (u, t) =>
      `https://mastodon.social/share?text=${encodeURIComponent(t + ' ' + u)}`,
  },
  {
    label: 'Bluesky',
    icon: '🦋',
    href: (u, t) =>
      `https://bsky.app/intent/compose?text=${encodeURIComponent(t + ' ' + u)}`,
  },
  {
    label: 'Telegram',
    icon: '✈',
    href: (u, t) =>
      `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`,
  },
];

@Component({
  selector: 'ideendb-share-menu',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host { display: inline-block; position: relative; }
    .trigger {
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 10px 14px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      width: 100%;
      font-size: .92rem;
      &:hover { background: #e6edf7; border-color: var(--wlo-primary); color: var(--wlo-primary); }
    }
    .menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      left: 0;
      background: #fff;
      border: 1px solid var(--wlo-border);
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0,40,85,.14);
      z-index: 50;
      padding: 6px;
      min-width: 200px;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      border: none;
      background: none;
      text-align: left;
      border-radius: 6px;
      cursor: pointer;
      font: inherit;
      color: var(--wlo-text);
      text-decoration: none;
      &:hover { background: var(--wlo-bg); }
      .icon { width: 22px; text-align: center; font-size: 1rem; }
    }
    .divider { height: 1px; background: var(--wlo-border); margin: 4px 0; }
    .toast {
      position: absolute;
      top: calc(100% + 6px);
      left: 0; right: 0;
      background: var(--wlo-primary);
      color: #fff;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: .85rem;
      text-align: center;
      z-index: 50;
    }
  `],
  template: `
    <button class="trigger" (click)="toggle($event)">🔗 Teilen</button>
    @if (open) {
      <div class="menu" (click)="$event.stopPropagation()">
        @for (t of targets; track t.label) {
          <a class="item" [href]="t.href(url, title)" target="_blank" rel="noopener"
             (click)="open=false">
            <span class="icon">{{ t.icon }}</span><span>{{ t.label }}</span>
          </a>
        }
        <div class="divider"></div>
        <button class="item" (click)="copy()">
          <span class="icon">📋</span><span>Link kopieren</span>
        </button>
        <button class="item" (click)="openRepo()">
          <span class="icon">↗</span><span>Im edu-sharing öffnen</span>
        </button>
      </div>
    }
    @if (copied) { <div class="toast">Link kopiert</div> }
  `,
})
export class ShareMenuComponent {
  @Input() url: string = '';
  @Input() title: string = '';
  @Input() repoUrl: string | null = null;

  open = false;
  copied = false;
  targets = TARGETS;

  toggle(e: MouseEvent) {
    e.stopPropagation();
    this.open = !this.open;
  }

  @HostListener('document:click')
  onDocClick() { this.open = false; }

  copy() {
    navigator.clipboard?.writeText(this.url).then(() => {
      this.copied = true;
      this.open = false;
      setTimeout(() => (this.copied = false), 1500);
    });
  }

  openRepo() {
    if (this.repoUrl) window.open(this.repoUrl, '_blank');
    this.open = false;
  }
}
