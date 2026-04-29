import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { provideHttpClient } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { AppShellComponent } from './app/app-shell/app-shell.component';
import { TileGridComponent } from './app/tile-grid/tile-grid.component';

createApplication({
  providers: [
    provideHttpClient(),
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
