import { CommonModule } from '@angular/common';
import { Component, HostListener, Input } from '@angular/core';

interface ShareTarget {
  label: string;
  icon: string;
  href: (url: string, text: string) => string;
}

const TARGETS: ShareTarget[] = [
  {
    // mailto: öffnet den Standard-Mail-Client. Universell.
    label: 'E-Mail',
    icon: '✉️',
    href: (u, t) =>
      `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(t + '\n\n' + u)}`,
  },
  {
    // wa.me öffnet auf Mobile WhatsApp App, auf Desktop Web-WhatsApp.
    label: 'WhatsApp',
    icon: '💬',
    href: (u, t) => `https://wa.me/?text=${encodeURIComponent(t + ' ' + u)}`,
  },
  {
    // X (vormals Twitter): neuer offizieller Endpoint x.com/intent/post.
    // Der alte twitter.com/intent/tweet redirectet noch, x.com ist sauberer.
    label: 'X (Twitter)',
    icon: '𝕏',
    href: (u, t) =>
      `https://x.com/intent/post?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}`,
  },
  {
    // Bluesky-Compose-Intent: Text mit URL muss zusammen im text-Param.
    label: 'Bluesky',
    icon: '🦋',
    href: (u, t) =>
      `https://bsky.app/intent/compose?text=${encodeURIComponent(t + ' ' + u)}`,
  },
  {
    // Mastodon ist föderiert — eine zentrale Share-URL gibt's nicht.
    // toot.kytta.dev ist der gängige Picker, der den User zur eigenen
    // Instanz weiterleitet (öffnet dort den Compose-Dialog mit Text).
    label: 'Mastodon',
    icon: '🐘',
    href: (u, t) =>
      `https://toot.kytta.dev/?text=${encodeURIComponent(t + ' ' + u)}`,
  },
  {
    // Threads (Meta): seit 2024 öffentlicher intent-Endpoint.
    label: 'Threads',
    icon: '@',
    href: (u, t) =>
      `https://www.threads.net/intent/post?text=${encodeURIComponent(t + ' ' + u)}`,
  },
  {
    // LinkedIn: offizieller share-offsite-Endpoint, holt Title+Description
    // automatisch aus den OG-Meta-Tags der geteilten URL.
    label: 'LinkedIn',
    icon: 'in',
    href: (u) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}`,
  },
  {
    // Facebook-Sharer: zieht ebenfalls OG-Meta aus der URL.
    label: 'Facebook',
    icon: 'f',
    href: (u) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
  },
  {
    // Reddit-Submit: title-Param wird als Posting-Headline genutzt.
    label: 'Reddit',
    icon: '🐶',
    href: (u, t) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t)}`,
  },
  {
    // Telegram: leitet auf t.me/share, das im Telegram-Web/App den
    // Empfänger-Dialog öffnet.
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
    :host { display: block; position: relative; }
    .row { display: flex; gap: 6px; align-items: stretch; }
    .primary {
      flex: 1;
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      padding: 9px 12px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      font-size: .88rem;
      color: var(--wlo-text);          /* Default-Browserlink-Blau überschreiben */
      text-decoration: none;           /* ohne Unterstrich, falls als <a> gerendert */
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      &:hover {
        background: var(--wlo-primary-soft, #e6edf7);
        border-color: var(--wlo-primary);
        color: var(--wlo-primary);
        text-decoration: none;
      }
      &:visited, &:focus { color: var(--wlo-text); text-decoration: none; }
    }
    .more {
      flex: 0 0 auto;
      background: var(--wlo-bg);
      border: 1px solid var(--wlo-border);
      width: 38px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      font-size: .9rem;
      &:hover { background: var(--wlo-primary-soft, #e6edf7); border-color: var(--wlo-primary); color: var(--wlo-primary); }
    }
    .menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0; left: 0;
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0,40,85,.14);
      z-index: 50;
      padding: 6px;
      min-width: 200px;
    }
    .item {
      display: flex; align-items: center; gap: 10px;
      width: 100%;
      padding: 8px 10px;
      border: none; background: none; text-align: left;
      border-radius: 6px; cursor: pointer;
      font: inherit; color: var(--wlo-text); text-decoration: none;
      &:hover { background: var(--wlo-bg); }
      .icon { width: 22px; text-align: center; font-size: 1rem; }
    }
    .toast {
      position: absolute;
      top: calc(100% + 6px); left: 0; right: 0;
      background: var(--wlo-primary); color: #fff;
      padding: 8px 12px; border-radius: 8px;
      font-size: .85rem; text-align: center; z-index: 50;
    }
  `],
  template: `
    <div class="row">
      <button type="button" class="primary" (click)="copy()">
        🔗 Link kopieren
      </button>
      <a class="primary" [href]="mailHref()"
         (click)="onMailClick($event)">
        ✉ E-Mail
      </a>
      <button type="button" class="more" (click)="toggle($event)"
              [attr.aria-expanded]="open" aria-label="Weitere Teilen-Optionen">▾</button>
    </div>
    @if (open) {
      <div class="menu" (click)="$event.stopPropagation()">
        @for (t of extraTargets; track t.label) {
          <a class="item" [href]="t.href(url, title)" target="_blank" rel="noopener noreferrer"
             (click)="onShareClick($event, t)">
            <span class="icon">{{ t.icon }}</span><span>{{ t.label }}</span>
          </a>
        }
      </div>
    }
    @if (copied) { <div class="toast">Link kopiert</div> }
  `,
})
export class ShareMenuComponent {
  @Input() url = '';
  @Input() title = '';
  @Input() repoUrl: string | null = null;

  open = false;
  copied = false;

  /** Im Drop-Down landen alle Share-Targets AUSSER E-Mail (das ist als
   *  Primär-Button neben „Link kopieren" sichtbar). */
  get extraTargets() { return TARGETS.filter(t => t.label !== 'E-Mail'); }

  toggle(e: MouseEvent) {
    e.stopPropagation();
    this.open = !this.open;
  }

  @HostListener('document:click')
  onDocClick() { this.open = false; }

  /** mailto:-Link für den E-Mail-Primärbutton. */
  mailHref(): string {
    const t = this.title || '';
    return `mailto:?subject=${encodeURIComponent(t)}`
         + `&body=${encodeURIComponent(t + '\n\n' + this.url)}`;
  }

  /** mailto: braucht location.href statt target=_blank, sonst öffnet manche
   *  Browser/Mailclient-Kombi gar nicht. */
  onMailClick(ev: MouseEvent) {
    ev.preventDefault();
    window.location.href = this.mailHref();
  }

  /** Klick auf einen Share-Link aus dem Drop-Down. Wir öffnen das Ziel selbst
   *  per window.open() statt auf das native <a target="_blank"> zu vertrauen
   *  — Angular's Change-Detection würde das @if-Menü sonst sofort
   *  neu rendern und den <a>-Knoten aus dem DOM entfernen, bevor der
   *  Browser navigieren kann. */
  onShareClick(ev: MouseEvent, t: ShareTarget) {
    ev.preventDefault();
    const href = t.href(this.url, this.title);
    if (href.startsWith('mailto:') || href.startsWith('tel:')) {
      window.location.href = href;
    } else {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
    setTimeout(() => (this.open = false), 0);
  }

  copy() {
    navigator.clipboard?.writeText(this.url).then(() => {
      this.copied = true;
      this.open = false;
      setTimeout(() => (this.copied = false), 1500);
    });
  }
}
