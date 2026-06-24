import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { AppShellComponent } from './app/app-shell/app-shell.component';
import { TileGridComponent } from './app/tile-grid/tile-grid.component';
import { authInterceptor } from './app/auth.interceptor';

createApplication({
  providers: [
    // Zone-basierte Change Detection EXPLIZIT aktivieren. createApplication()
    // (Angular-Elements-Bootstrap) verdrahtet sie — anders als
    // bootstrapApplication() — NICHT automatisch. Ohne sie lösen asynchrone
    // HTTP-Antworten keine View-Aktualisierung aus (nur Events/Signals täten es)
    // → Kacheln blieben nach Navigation/Filter auf „Lädt…" stehen.
    // eventCoalescing: mehrere Events im selben Tick lösen NUR EINEN CD-Lauf aus
    // (Angulars empfohlener Default seit v18) — weniger Render-Last bei den
    // großen Default-CD-Komponenten (app-shell, idea-detail, tile-grid).
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([authInterceptor])),
    importProvidersFrom(BrowserAnimationsModule),
  ],
}).then((appRef) => {
  const inj = appRef.injector;

  const app = createCustomElement(AppShellComponent, { injector: inj });
  const grid = createCustomElement(TileGridComponent, { injector: inj });

  if (!customElements.get('ideendb-app')) {
    customElements.define('ideendb-app', app);
  }
  if (!customElements.get('ideendb-tile-grid')) {
    customElements.define('ideendb-tile-grid', grid);
  }

  // Auto-mount a default <ideendb-app> if the host page has not placed one.
  if (document.readyState !== 'loading') mountDefault();
  else document.addEventListener('DOMContentLoaded', mountDefault);

  function mountDefault() {
    if (!document.querySelector('ideendb-app, ideendb-tile-grid')) {
      document.body.appendChild(document.createElement('ideendb-app'));
    }
  }
});
