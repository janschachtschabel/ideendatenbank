import { Injectable, signal } from '@angular/core';

export type ThemeKey = 'default' | 'hackathoern' | 'dark';

const THEMES: { key: ThemeKey; label: string; swatch: string }[] = [
  { key: 'default',     label: 'Klassisch (Blau)',   swatch: '#002855' },
  { key: 'hackathoern', label: 'HackathOERn (Hell)', swatch: '#27ABE2' },
  { key: 'dark',        label: 'Dunkel',             swatch: '#2a3445' },
];

const STORAGE_KEY = 'ideendb-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** Aktuelle Theme-Auswahl (signal-basiert für Component-Reaktivität). */
  readonly current = signal<ThemeKey>('hackathoern');
  readonly options = THEMES;

  constructor() {
    // Boot: gespeichertes Theme, sonst Standard = HackathOERn (hell, Logo-Farben).
    let initial: ThemeKey = 'hackathoern';
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeKey | null;
      if (saved && THEMES.find((t) => t.key === saved)) {
        initial = saved;
      }
    } catch { /* SSR / privacy mode */ }
    this.set(initial);
  }

  set(key: ThemeKey) {
    this.current.set(key);
    if (key === 'default') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', key);
    }
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* ignore */ }
  }

  next() {
    const i = THEMES.findIndex((t) => t.key === this.current());
    this.set(THEMES[(i + 1) % THEMES.length].key);
  }
}
