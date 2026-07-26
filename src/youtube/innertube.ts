import '@/lib/polyfills'; // debe ir primero: youtubei.js lee globals al importarse

import { Innertube } from 'youtubei.js';

let pending: Promise<Innertube> | null = null;

/**
 * Cliente Innertube compartido.
 *
 * Crearlo es caro (descarga y parsea el player de YouTube para poder descifrar
 * las URLs de stream), así que se hace una sola vez por sesión. Si falla se
 * limpia la promesa para que el siguiente intento reintente de cero en vez de
 * quedar cacheado en estado de error.
 */
export function getInnertube(): Promise<Innertube> {
  if (!pending) {
    pending = Innertube.create({
      lang: 'es',
      location: 'CO',
      retrieve_player: true,
      generate_session_locally: true,
      // Sin caché en disco: el polyfill de mmkvStorage vive en memoria y la
      // sesión se regenera barato en cada arranque.
      enable_session_cache: false,
    }).catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

/** Fuerza recrear el cliente. Útil cuando YouTube invalida la sesión. */
export function resetInnertube() {
  pending = null;
}
