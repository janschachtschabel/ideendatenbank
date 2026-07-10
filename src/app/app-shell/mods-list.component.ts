import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../api.service';

/**
 * Moderatoren-Übersicht (Tab „Moderatoren") — read-only aus
 * moderation.component.ts herausgelöst (verhaltensgleich). Zeigt die
 * konfigurierten edu-sharing-Moderationsgruppen und ihre Mitglieder.
 * Bewusst nur lesend: Rechtevergabe passiert ausschließlich im Repository,
 * nicht hier. Lädt sich in ngOnInit selbst — keine Inputs/Outputs.
 */
@Component({
  selector: 'ideendb-mods-list',
  standalone: true,
  imports: [],
  styles: [`
    :host { display: block; }
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
    .stat-ico {
      width: 14px; height: 14px;
      vertical-align: -2px; margin-right: 4px; flex-shrink: 0;
      stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; fill: none;
    }
    .tax-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap; gap: 12px;
    }
    .tax-list {
      background: var(--wlo-surface, #fff);
      border: 1px solid var(--wlo-border);
      border-radius: 10px;
      overflow: hidden;
    }
    .tax-row {
      display: grid;
      grid-template-columns: 100px 1fr 1fr 90px auto;
      gap: 14px;
      padding: 12px 16px;
      align-items: center;
      border-bottom: 1px solid var(--wlo-border);
      &:last-child { border-bottom: none; }
      &.header { background: var(--wlo-bg); font-weight: 600;
                 font-size: .82rem; text-transform: uppercase;
                 letter-spacing: .05em; color: var(--wlo-muted); }
    }
    .tax-row .slug {
      font-family: monospace; font-size: .85rem; color: var(--wlo-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tax-row .pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 10px; border-radius: 999px; font-size: .75rem;
      font-weight: 600;
    }
    .tax-empty { padding: 30px; text-align: center; color: var(--wlo-muted);
                 background: var(--wlo-surface, #fff); border: 1px dashed var(--wlo-border);
                 border-radius: 10px; }
  `],
  template: `
    <div class="intro">
      Mod-Rechte werden ausschließlich über Mitgliedschaft in den
      unten gelisteten edu-sharing-Gruppen vergeben. Die Verwaltung
      (hinzufügen/entfernen) erfolgt direkt im Repository — diese
      Übersicht ist bewusst nur lesend, um nicht versehentlich
      globale Admin-Rechte zu vergeben.
    </div>

    @if (modsGroups.length) {
      <div style="margin-bottom: 14px; font-size: .88rem">
        <strong>edu-sharing-Gruppen:</strong>
        @for (g of modsGroupStatus; track g.group) {
          <span class="pill"
                [style.background]="g.ok ? 'var(--wlo-primary-soft)' : 'var(--wlo-accent-soft)'"
                [style.color]="g.ok ? 'var(--wlo-text)' : '#8a3a00'"
                [title]="g.error || g.group"
                style="margin: 0 6px 6px 0; display: inline-flex; gap: 5px; align-items: center">
            <strong>{{ g.display_name || g.group }}</strong>
            @if (g.display_name) {
              <code style="background: transparent; padding: 0; opacity: .65">{{ g.group }}</code>
            }
            · {{ g.count }}
            @if (!g.ok) {
              <svg class="stat-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            }
          </span>
        }
      </div>
    }

    <div class="tax-toolbar">
      <strong>Mitglieder der edu-sharing-Moderationsgruppen ({{ moderators().length }})</strong>
    </div>
    <div class="tax-list">
      <div class="tax-row header" style="grid-template-columns: 1fr 1fr 1.4fr 1.6fr">
        <span>Username</span>
        <span>Name</span>
        <span>E-Mail</span>
        <span>Gruppe</span>
      </div>
      @for (m of moderators(); track m.username) {
        <div class="tax-row" style="grid-template-columns: 1fr 1fr 1.4fr 1.6fr">
          <span class="slug">{{ m.username }}</span>
          <span>{{ (m.first_name || '') + ' ' + (m.last_name || '') }}</span>
          <span style="color: var(--wlo-muted)">{{ m.email || '—' }}</span>
          <span>
            @if (m.source === 'bootstrap') {
              <span class="pill"
                    style="background:var(--wlo-accent-soft, #fff8db);color:#5c4a00">
                Bootstrap (.env)
              </span>
            } @else {
              <span [title]="m.source">{{ groupLabel(m.source) }}</span>
            }
          </span>
        </div>
      } @empty {
        <div class="tax-empty">
          Keine Mitglieder gefunden. Prüfe MODERATION_FALLBACK_GROUPS in der .env.
        </div>
      }
    </div>

    @if (modError) {
      <div style="margin-top: 10px; color: #b00020; font-size: .9rem">{{ modError }}</div>
    }
  `,
})
export class ModsListComponent implements OnInit {
  private api = inject(ApiService);

  modsGroups: string[] = [];
  modsGroupStatus: { group: string; display_name?: string | null; ok: boolean; error?: string | null; count: number }[] = [];
  moderators = signal<{
    username: string; first_name?: string; last_name?: string;
    email?: string; source: string;
  }[]>([]);
  modError = '';

  ngOnInit() {
    this.loadMods();
  }

  /** Klartext-Bezeichnung einer Gruppe (Fallback: technische ID). */
  groupLabel(id: string): string {
    return this.modsGroupStatus.find((g) => g.group === id)?.display_name || id;
  }

  loadMods() {
    this.modError = '';
    this.api.listModerators().subscribe({
      next: (r) => {
        this.modsGroups = r.groups || [];
        this.modsGroupStatus = r.group_status || [];
        this.moderators.set(r.members || []);
      },
      error: (e) => (this.modError = e?.error?.detail || 'Konnte Moderator-Liste nicht laden'),
    });
  }
}
