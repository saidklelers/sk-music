import '@/lib/polyfills'; // debe ir primero: youtubei.js lee globals al importarse

import { Innertube } from 'youtubei.js';

/**
 * Tiempos de espera, medidos contra el comportamiento real del dispositivo.
 *
 * El dato que manda: la PRIMERA conexión a youtube.com tardó 252 s en
 * completarse, y a partir de ahí todas las demás tardaron ~400 ms. Es el patrón
 * típico de DNS o IPv6 colgándose hasta agotar su propio tope antes de caer a
 * IPv4.
 *
 * De ahí salen dos reglas:
 *
 * 1. En frío hay que tener MUCHA paciencia. Cortar a los 45 s no "protegía"
 *    nada: condenaba al fallo una conexión que sí iba a establecerse.
 * 2. En frío NO hay que reintentar. Abortar mata la resolución DNS en curso y
 *    el reintento arranca de cero, así que reintentar empeora el caso en vez de
 *    mejorarlo. El reintento sólo sirve una vez la conexión está caliente, que
 *    es cuando un fallo sí es transitorio.
 */
const COLD_TIMEOUT_MS = 240_000; // 4 min, sólo hasta la primera respuesta
const WARM_TIMEOUT_MS = 30_000;

/** Reintentos en caliente. Las llamadas a InnerTube son lecturas idempotentes. */
const WARM_RETRIES = 2;

/**
 * Se pone en true con la primera respuesta que llegue de YouTube. A partir de
 * ahí la conexión está establecida y los tiempos largos dejan de tener sentido.
 */
let hasConnected = false;

/** true mientras no se haya conseguido ninguna respuesta todavía. */
export function isCold() {
  return !hasConnected;
}

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
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const started = Date.now();
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    // Primera respuesta: la conexión quedó establecida y a partir de aquí los
    // tiempos largos ya no aplican.
    hasConnected = true;
    return res;
  } catch (err) {
    // Sin esto, RN reporta el aborto como "Fetch request has been canceled",
    // que suena a una cancelación deliberada y esconde el dato útil: que el
    // servidor nunca respondió.
    if (timedOut) {
      const host = typeof input === 'string' ? new URL(input).host : 'YouTube';
      throw new Error(`${host} no respondió en ${Math.round(timeoutMs / 1000)} s`);
    }
    throw new Error(
      `${err instanceof Error ? err.message : 'fallo de red'} (tras ${Date.now() - started} ms)`,
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * `fetch` de la sesión: paciente en frío, rápido y con reintentos en caliente.
 *
 * La asimetría es deliberada. Mientras no haya habido ninguna respuesta se hace
 * UN solo intento con un tope muy alto, porque abortar cancelaría la resolución
 * DNS en curso y el reintento volvería a empezar de cero — reintentar en frío
 * hace daño. Ya con la conexión establecida, un fallo sí suele ser transitorio
 * y ahí los reintentos rápidos valen la pena.
 */
const sessionFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  if (isCold()) {
    return fetchWithTimeout(input, init, COLD_TIMEOUT_MS);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= WARM_RETRIES; attempt++) {
    try {
      return await fetchWithTimeout(input, init, WARM_TIMEOUT_MS);
    } catch (err) {
      lastError = err;
      if (attempt < WARM_RETRIES) await delay(400 * 2 ** attempt);
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
      fetch: sessionFetch,
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
