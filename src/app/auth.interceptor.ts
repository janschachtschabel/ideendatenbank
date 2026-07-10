import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { AuthService } from './auth.service';

/**
 * Hängt den HTTP-Basic-Auth-Header an — aber AUSSCHLIESSLICH an Requests zur
 * eigenen API ({@link AuthService.isApiUrl}). Das ist die strukturelle
 * Garantie, dass die im Browser gehaltenen Credentials niemals an eine
 * Fremd-Origin der Einbettungsseite gelangen, egal von welcher Call-Site der
 * Request stammt. Ein einziger Chokepoint statt ~58 manueller Header pro Call.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const header = auth.authHeaderValue();
  if (header && auth.isApiUrl(req.url)) {
    return next(req.clone({ setHeaders: { Authorization: header } }));
  }
  return next(req);
};
