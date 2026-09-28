/**
 * Descarga por trozos contra googlevideo.
 *
 * No importa nada nativo a propósito: recibe `fetch` y el destino como
 * parámetros, así se puede probar en Node contra un servidor simulado.
 *
 * Lo que se sabe de googlevideo, medido en dispositivo:
 *
 * - No rechaza por *si* la petición lleva rango, sino por CUÁNTO pide: un byte
 *   devuelve 206 y el archivo entero 403. Por eso se pide en trozos, como hace
 *   yt-dlp.
 * - La URL no tiene un límite de tamaño sino de uso: se agota tras servir una
 *   petición. Por eso se pide un enlace nuevo antes de CADA trozo, no sólo tras
 *   un fallo. Cuesta ~400 ms por trozo; es el precio de que funcione.
 */

/**
 * Tamaño de trozo. 1 MiB es un compromiso: pocas peticiones y lejos del umbral
 * que dispara el rechazo.
 */
export const CHUNK_SIZE = 1_048_576;

/** Si un trozo es rechazado se reintenta con la mitad, hasta este mínimo. */
export const MIN_CHUNK_SIZE = 65_536;

/**
 * Fallos seguidos que se toleran antes de rendirse. Se cuentan SEGUIDOS y no en
 * total: en una descarga larga, un par de tropiezos aislados no deberían
 * sumarse hasta tumbarla.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Tope de tiempo por petición, cuerpo incluido. React Native no aplica ninguno
 * por defecto, así que un trozo colgado congelaba la descarga para siempre.
 *
 * El primero es mucho más paciente: googlevideo es otro host y su primera
 * conexión puede pagar el mismo arranque en frío (DNS/IPv6) que youtube.com,
 * que en dispositivo llegó a tardar minutos y sí completaba.
 */
export const FIRST_CHUNK_TIMEOUT_MS = 240_000;
export const CHUNK_TIMEOUT_MS = 90_000;

/** Techo de seguridad: ningún audio razonable pasa de esto. */
const MAX_BYTES = 2 * 1024 ** 3;

export type ChunkSink = {
  /** Recibe cada trozo en orden. Se llama sólo con datos ya validados. */
  write: (bytes: Uint8Array) => void;
};

export type ChunkedDownloadOptions = {
  url: string;
  /** Tamaño esperado si se conoce; `Content-Range` manda si lo contradice. */
  sizeHint?: number | null;
  sink: ChunkSink;
  /** Pide una URL nueva. Se llama antes de cada trozo salvo el primero. */
  refreshUrl: () => Promise<string>;
  onProgress?: (ratio: number | null) => void;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  chunkSize?: number;
  minChunkSize?: number;
  firstTimeoutMs?: number;
  timeoutMs?: number;
};

export type ChunkedDownloadResult = {
  bytes: number;
  chunks: number;
  /** Tamaño de trozo con el que terminó, por si hubo que reducirlo. */
  chunkSize: number;
};

/** Error que indica que la descarga se canceló a propósito. */
export class DownloadAbortedError extends Error {
  constructor() {
    super('Descarga cancelada.');
    this.name = 'AbortError';
  }
}

/** `Content-Range: bytes 0-1023/5400000` → inicio, fin y total. */
export function parseContentRange(
  header: string | null | undefined,
): { start: number; end: number; total: number | null } | null {
  const m = header?.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (!m) return null;
  return {
    start: Number(m[1]),
    end: Number(m[2]),
    total: m[3] === '*' ? null : Number(m[3]),
  };
}

/**
 * Rango como parámetro de la URL en vez de cabecera. Es la forma nativa de
 * googlevideo, y se prueba cuando la cabecera `Range` es rechazada porque el
 * servidor no las trata igual.
 */
export function withRangeParam(url: string, start: number, end: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set('range', `${start}-${end}`);
  return parsed.toString();
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DownloadAbortedError();
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : 'error';
}

type ChunkResult = {
  bytes: Uint8Array;
  /** Total del archivo si el servidor lo informó. */
  total: number | null;
  /** El servidor ignoró el rango y mandó el archivo completo. */
  whole: boolean;
};

/**
 * Una petición con tope de tiempo y cancelable desde fuera. El tope cubre
 * también la lectura del cuerpo, que es donde se cuelga una conexión lenta.
 */
async function timedRequest(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  read: (res: Response, abort: () => void) => Promise<ChunkResult | string>,
): Promise<ChunkResult | string> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetchImpl(url, { headers, signal: controller.signal });
    return await read(res, () => controller.abort());
  } catch (err) {
    throwIfAborted(signal);
    if (timedOut) throw new Error(`sin respuesta en ${Math.round(timeoutMs / 1000)} s`);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Pide un trozo concreto, probando las dos formas de expresar el rango, y
 * valida que lo recibido sea de verdad ese trozo.
 */
async function fetchChunk(
  fetchImpl: typeof fetch,
  url: string,
  start: number,
  end: number,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ChunkResult> {
  const wanted = end - start + 1;

  const read = async (res: Response, abort: () => void): Promise<ChunkResult | string> => {
    // 416: se pidió más allá del final. Sólo pasa sin tamaño conocido y con un
    // archivo que mide justo un múltiplo del trozo; es el fin, no un fallo.
    if (res.status === 416) return { bytes: new Uint8Array(0), total: null, whole: false };
    if (res.status !== 206 && !res.ok) return `HTTP ${res.status}`;

    const range = parseContentRange(res.headers.get('content-range'));
    if (range && range.start !== start) {
      abort();
      return `rango desalineado (pedido ${start}, recibido ${range.start})`;
    }

    // Sin Content-Range y con más bytes de los pedidos, el servidor ignoró el
    // rango. Desde el byte 0 eso es el archivo entero y sirve; a mitad de
    // descarga no, y se corta antes de bajar el cuerpo si se puede saber.
    const declared = Number(res.headers.get('content-length'));
    if (!range && start > 0 && declared > wanted) {
      abort();
      return 'el servidor ignoró el rango';
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!range && bytes.byteLength > wanted) {
      if (start === 0) return { bytes, total: bytes.byteLength, whole: true };
      return 'el servidor ignoró el rango';
    }
    return { bytes, total: range?.total ?? null, whole: false };
  };

  const attempts = [
    () =>
      timedRequest(
        fetchImpl,
        url,
        { ...headers, Range: `bytes=${start}-${end}` },
        timeoutMs,
        signal,
        read,
      ),
    () => timedRequest(fetchImpl, withRangeParam(url, start, end), headers, timeoutMs, signal, read),
  ];

  const problems: string[] = [];
  for (const attempt of attempts) {
    const result = await attempt();
    if (typeof result !== 'string') return result;
    problems.push(result);
  }
  throw new Error(problems.join(' / '));
}

/**
 * Descarga el audio por trozos, con un enlace nuevo para cada uno, y lo va
 * entregando a `sink` a medida que llega en vez de acumularlo en memoria.
 *
 * Termina con error, nunca en silencio, si el archivo queda incompleto:
 * un audio truncado que se guarda como bueno es peor que un fallo visible.
 */
export async function downloadChunked(
  options: ChunkedDownloadOptions,
): Promise<ChunkedDownloadResult> {
  const {
    sink,
    refreshUrl,
    onProgress,
    signal,
    headers = {},
    fetchImpl = fetch,
    minChunkSize = MIN_CHUNK_SIZE,
    firstTimeoutMs = FIRST_CHUNK_TIMEOUT_MS,
    timeoutMs = CHUNK_TIMEOUT_MS,
  } = options;

  let current = options.url;
  let chunkSize = options.chunkSize ?? CHUNK_SIZE;
  let total = options.sizeHint && options.sizeHint > 0 ? options.sizeHint : null;
  let offset = 0;
  let chunks = 0;
  let requests = 0;
  let failures = 0;

  for (;;) {
    throwIfAborted(signal);

    // Enlace nuevo para cada petición salvo la primera, que ya viene recién
    // resuelta. Un fallo aquí sí se propaga: tragárselo dejaba reutilizando la
    // URL agotada y convertía el problema real en un 403 indescifrable.
    if (requests > 0) {
      try {
        current = await refreshUrl();
      } catch (err) {
        throwIfAborted(signal);
        throw new Error(`No se pudo renovar el enlace en el byte ${offset}: ${describe(err)}`);
      }
      throwIfAborted(signal);
    }
    requests++;

    const start = offset;
    const end = total ? Math.min(start + chunkSize, total) - 1 : start + chunkSize - 1;

    let chunk: ChunkResult;
    try {
      chunk = await fetchChunk(
        fetchImpl,
        current,
        start,
        end,
        headers,
        chunks === 0 ? firstTimeoutMs : timeoutMs,
        signal,
      );
    } catch (err) {
      throwIfAborted(signal);
      failures++;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `Rechazado en el byte ${offset} de ${total ?? '?'} tras ${failures} intentos ` +
            `seguidos, con trozos de ${Math.round(chunkSize / 1024)} KiB (${describe(err)}).`,
        );
      }
      // Con enlace nuevo cada vez, un rechazo apunta a que el trozo es
      // demasiado grande: se parte por la mitad y se reintenta el mismo offset.
      chunkSize = Math.max(Math.floor(chunkSize / 2), minChunkSize);
      continue;
    }
    failures = 0;

    const size = chunk.bytes.byteLength;
    if (size === 0) break;

    if (chunk.total) total = chunk.total;
    sink.write(chunk.bytes);
    offset += size;
    chunks++;
    onProgress?.(total ? Math.min(offset / total, 1) : null);

    if (chunk.whole) break;
    if (total && offset >= total) break;
    // Sin total conocido, un trozo más corto de lo pedido significa el final.
    if (!total && size < end - start + 1) break;
    if (offset > MAX_BYTES) throw new Error('El archivo supera el tamaño máximo admitido.');
  }

  if (offset === 0) throw new Error('No se recibió ningún dato del servidor.');
  if (total && offset < total) {
    throw new Error(`Descarga incompleta: llegaron ${offset} de ${total} bytes.`);
  }

  return { bytes: offset, chunks, chunkSize };
}
