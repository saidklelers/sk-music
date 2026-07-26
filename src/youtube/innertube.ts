import '@/lib/polyfills'; // debe ir primero: youtubei.js lee globals al importarse

import { Innertube } from 'youtubei.js';

/** Tope para cualquier petición de red que haga la librería. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * `fetch` con tope de tiempo.
 *
 * React Native no aplica ningún timeout por defecto, así que una petición que
 * se queda colgada lo hace para siempre y la descarga se congela sin dar error.
 * Inyectando esto en la sesión, toda llamada de la librería queda acotada.
 */
const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const started = Date.now();
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // Sin esto, RN reporta el aborto como "Fetch request has been canceled",
    // que suena a que algo cancelo la descarga a proposito y esconde el dato
    // util: que YouTube nunca respondio.
    if (timedOut) {
      const host = typeof input === 'string' ? new URL(input).host : 'YouTube';
      throw new Error(
        `${host} no respondio en ${REQUEST_TIMEOUT_MS / 1000} s (peticion abortada)`,
      );
    }
    const ms = Date.now() - started;
    throw new Error(
      `${err instanceof Error ? err.message : 'fallo de red'} (tras ${ms} ms)`,
    );
  } finally {
    clearTimeout(timer);
  }
};

let pending: Promise<Innertube> | null = null;

/**
 * Cliente Innertube compartido.
 *
 * `retrieve_player: false` es la decisión importante acá. Con el player activo,
 * la librería descarga el base.js de YouTube (~2 MB minificados) y lo parsea con
 * meriyah, que es un parser escrito en JavaScript: sobre Hermes, en un teléfono,
 * eso bloquea el hilo de JS durante muchísimo tiempo y la app se queda congelada
 * en "Resolviendo".
 *
 * No lo necesitamos: el player sirve solo para descifrar firmas, y los clientes
 * IOS y ANDROID —los dos primeros que probamos— entregan las URLs de audio ya
 * en claro. Ver `pickAudioFormat` en resolve.ts, que descarta cualquier formato
 * que sí venga cifrado en lugar de intentar descifrarlo.
 */
export function getInnertube(): Promise<Innertube> {
  if (!pending) {
    pending = Innertube.create({
      lang: 'es',
      location: 'CO',
      retrieve_player: false,
      generate_session_locally: true,
      enable_session_cache: false,
      fetch: fetchWithTimeout,
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
