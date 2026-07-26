import '@/lib/polyfills'; // debe ir primero: youtubei.js lee globals al importarse

import { Innertube } from 'youtubei.js';

/**
 * Tope por intento.
 *
 * 45 s y no 20 porque el arranque en frío puede ser brutal: en pruebas reales
 * la primera conexión a youtube.com tardó más de 4 minutos (DNS o IPv6
 * colgándose antes de caer a IPv4) mientras que todas las siguientes tardaron
 * ~400 ms. No sirve subir el tope hasta cubrir ese peor caso —serían minutos de
 * app congelada— así que la solución real es el reintento de abajo: al segundo
 * intento la conexión ya está caliente y responde al instante.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/** Reintentos ante fallo o vencimiento. Las llamadas a InnerTube son lecturas. */
const MAX_RETRIES = 2;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Reintenta ante vencimiento o fallo de red.
 *
 * Es la pieza que de verdad resuelve el arranque en frío: si el primer intento
 * se queda esperando a que resuelva el DNS, el timeout lo corta y el segundo
 * sale por una conexión ya establecida. Sólo se reintenta el transporte —un 400
 * o un 403 de YouTube se propaga tal cual, porque reintentarlo no cambia nada.
 */
const fetchWithRetry = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchWithTimeout(input, init);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await delay(400 * 2 ** attempt);
    }
  }

  throw lastError;
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
      fetch: fetchWithRetry,
    }).catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

/**
 * Adelanta el arranque en frío.
 *
 * Se llama al abrir la app para que el coste de la primera conexión —que puede
 * ser de minutos— se pague en segundo plano y no cuando el usuario ya pegó un
 * link y está esperando. Deliberadamente no propaga errores: si falla, la
 * descarga real volverá a intentarlo y mostrará el problema entonces.
 */
export function warmUp() {
  getInnertube().catch(() => {});
}

/** Fuerza recrear el cliente. Útil cuando YouTube invalida la sesión. */
export function resetInnertube() {
  pending = null;
}
