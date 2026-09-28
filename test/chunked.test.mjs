import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DownloadAbortedError,
  downloadChunked,
  parseContentRange,
  withRangeParam,
} from '../src/downloads/chunked.ts';

/** Archivo de prueba con contenido reconocible byte a byte. */
function makeFile(size) {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = i % 251;
  return data;
}

/**
 * googlevideo simulado, con las reglas medidas en dispositivo:
 * cada URL sirve UNA petición, y se rechaza lo que pida más de `maxRequest`.
 */
function fakeGooglevideo(file, opts = {}) {
  const { maxRequest = Infinity, singleUse = true, ignoreRange = false, failAt = new Set() } = opts;
  const used = new Set();
  let tokens = 0;
  let calls = 0;

  const freshUrl = () => `https://rr1---sn-test.googlevideo.com/videoplayback?t=${tokens++}`;

  const fetchImpl = async (input, init = {}) => {
    calls++;
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const url = new URL(input);
    const token = url.searchParams.get('t');
    if (singleUse && used.has(token)) return new Response(null, { status: 403 });
    used.add(token);
    if (failAt.has(calls)) return new Response(null, { status: 503 });

    const header = init.headers?.Range ?? init.headers?.range;
    const param = url.searchParams.get('range');
    const spec = header ? header.replace('bytes=', '') : param;

    if (!spec || ignoreRange) {
      if (file.byteLength > maxRequest) return new Response(null, { status: 403 });
      return new Response(file, { status: 200 });
    }

    const [a, b] = spec.split('-').map(Number);
    if (a >= file.byteLength) return new Response(null, { status: 416 });
    const end = Math.min(b, file.byteLength - 1);
    if (end - a + 1 > maxRequest) return new Response(null, { status: 403 });

    const body = file.slice(a, end + 1);
    // Con cabecera responde 206 + Content-Range; con parámetro, 200 a secas,
    // que es como se comporta googlevideo con `&range=`.
    return header
      ? new Response(body, {
          status: 206,
          headers: { 'Content-Range': `bytes ${a}-${end}/${file.byteLength}` },
        })
      : new Response(body, { status: 200 });
  };

  return { fetchImpl, freshUrl, calls: () => calls };
}

function collect() {
  const parts = [];
  return {
    sink: { write: (b) => parts.push(b) },
    bytes: () => {
      const size = parts.reduce((n, p) => n + p.byteLength, 0);
      const out = new Uint8Array(size);
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.byteLength;
      }
      return out;
    },
  };
}

const fast = { firstTimeoutMs: 2000, timeoutMs: 2000, chunkSize: 1000, minChunkSize: 100 };

describe('parseContentRange', () => {
  test('lee inicio, fin y total', () => {
    assert.deepEqual(parseContentRange('bytes 0-1023/5400000'), {
      start: 0,
      end: 1023,
      total: 5400000,
    });
  });

  test('total desconocido', () => {
    assert.deepEqual(parseContentRange('bytes 10-19/*'), { start: 10, end: 19, total: null });
  });

  test('cabecera ausente o rara', () => {
    assert.equal(parseContentRange(null), null);
    assert.equal(parseContentRange('items 0-1/2'), null);
  });
});

test('withRangeParam añade o reemplaza el parámetro range', () => {
  const url = withRangeParam('https://x.googlevideo.com/videoplayback?a=1&range=0-1', 5, 9);
  assert.equal(new URL(url).searchParams.get('range'), '5-9');
  assert.equal(new URL(url).searchParams.get('a'), '1');
});

describe('downloadChunked', () => {
  test('descarga completa renovando la URL en cada trozo', async () => {
    const file = makeFile(4500);
    const server = fakeGooglevideo(file, { maxRequest: 1000 });
    const out = collect();
    let refreshes = 0;

    const result = await downloadChunked({
      ...fast,
      url: server.freshUrl(),
      sizeHint: file.byteLength,
      sink: out.sink,
      refreshUrl: async () => {
        refreshes++;
        return server.freshUrl();
      },
      fetchImpl: server.fetchImpl,
    });

    assert.equal(result.bytes, file.byteLength);
    assert.equal(result.chunks, 5);
    assert.equal(refreshes, 4);
    assert.deepEqual(out.bytes(), file);
  });

  test('reduce el trozo cuando el servidor rechaza por tamaño', async () => {
    const file = makeFile(3000);
    const server = fakeGooglevideo(file, { maxRequest: 300 });
    const out = collect();

    const result = await downloadChunked({
      ...fast,
      url: server.freshUrl(),
      sizeHint: file.byteLength,
      sink: out.sink,
      refreshUrl: async () => server.freshUrl(),
      fetchImpl: server.fetchImpl,
    });

    assert.equal(result.chunkSize, 250);
    assert.deepEqual(out.bytes(), file);
  });

  test('el total de Content-Range manda sobre un sizeHint equivocado', async () => {
    const file = makeFile(2500);
    const server = fakeGooglevideo(file);
    const out = collect();

    const result = await downloadChunked({
      ...fast,
      url: server.freshUrl(),
      sizeHint: 99_999,
      sink: out.sink,
      refreshUrl: async () => server.freshUrl(),
      fetchImpl: server.fetchImpl,
    });

    assert.equal(result.bytes, 2500);
    assert.deepEqual(out.bytes(), file);
  });

  test('sin tamaño conocido termina con el 416 de un múltiplo exacto', async () => {
    const file = makeFile(2000);
    const server = fakeGooglevideo(file);
    const out = collect();

    const result = await downloadChunked({
      ...fast,
      url: server.freshUrl(),
      sink: out.sink,
      refreshUrl: async () => server.freshUrl(),
      // Sólo funciona el parámetro `range`, que no trae Content-Range: el
      // total nunca se llega a conocer.
      fetchImpl: async (input, init) => {
        if (init.headers?.Range) return new Response(null, { status: 403 });
        return server.fetchImpl(input, init);
      },
    });

    assert.equal(result.bytes, 2000);
    assert.deepEqual(out.bytes(), file);
  });

  test('acepta el archivo entero si el servidor ignora el rango desde el byte 0', async () => {
    const file = makeFile(1800);
    const server = fakeGooglevideo(file, { ignoreRange: true });
    const out = collect();

    const result = await downloadChunked({
      ...fast,
      url: server.freshUrl(),
      sink: out.sink,
      refreshUrl: async () => server.freshUrl(),
      fetchImpl: server.fetchImpl,
    });

    assert.equal(result.bytes, 1800);
    assert.equal(result.chunks, 1);
    assert.deepEqual(out.bytes(), file);
  });

  test('tolera fallos aislados sin sumarlos entre sí', async () => {
    const file = makeFile(8000);
    // Un 503 cada pocas peticiones: nunca cinco seguidos.
    const server = fakeGooglevideo(file, { failAt: new Set([2, 5, 9, 14, 20, 27]) });
    const out = collect();

    const result = await downloadChunked({
      ...fast,
      url: server.freshUrl(),
      sizeHint: file.byteLength,
      sink: out.sink,
      refreshUrl: async () => server.freshUrl(),
      fetchImpl: server.fetchImpl,
    });

    assert.equal(result.bytes, 8000);
    assert.deepEqual(out.bytes(), file);
  });

  test('se rinde tras cinco rechazos seguidos, con un mensaje útil', async () => {
    const file = makeFile(3000);
    const server = fakeGooglevideo(file, { maxRequest: 10 });

    await assert.rejects(
      downloadChunked({
        ...fast,
        url: server.freshUrl(),
        sizeHint: file.byteLength,
        sink: collect().sink,
        refreshUrl: async () => server.freshUrl(),
        fetchImpl: server.fetchImpl,
      }),
      /Rechazado en el byte 0 de 3000 tras 5 intentos/,
    );
  });

  test('reutilizar la URL agotada falla: por eso se renueva', async () => {
    const file = makeFile(3000);
    const server = fakeGooglevideo(file);
    const url = server.freshUrl();

    await assert.rejects(
      downloadChunked({
        ...fast,
        url,
        sizeHint: file.byteLength,
        sink: collect().sink,
        refreshUrl: async () => url,
        fetchImpl: server.fetchImpl,
      }),
      /Rechazado en el byte 1000/,
    );
  });

  test('nunca da por buena una descarga truncada', async () => {
    const file = makeFile(3000);
    const server = fakeGooglevideo(file);

    await assert.rejects(
      downloadChunked({
        ...fast,
        url: server.freshUrl(),
        sizeHint: file.byteLength,
        sink: collect().sink,
        refreshUrl: async () => server.freshUrl(),
        // El servidor corta a mitad: a partir del byte 2000 devuelve vacío.
        fetchImpl: async (input, init) => {
          const spec = init.headers?.Range?.replace('bytes=', '');
          if (spec && Number(spec.split('-')[0]) >= 2000) {
            return new Response(new Uint8Array(0), {
              status: 206,
              headers: { 'Content-Range': 'bytes 2000-2000/3000' },
            });
          }
          return server.fetchImpl(input, init);
        },
      }),
      /Descarga incompleta: llegaron 2000 de 3000 bytes/,
    );
  });

  test('rechaza un trozo que no empieza donde se pidió', async () => {
    const file = makeFile(2000);
    const server = fakeGooglevideo(file);
    const out = collect();
    let lied = false;

    const result = await downloadChunked({
      ...fast,
      url: server.freshUrl(),
      sizeHint: file.byteLength,
      sink: out.sink,
      refreshUrl: async () => server.freshUrl(),
      fetchImpl: async (input, init) => {
        const spec = init.headers?.Range?.replace('bytes=', '');
        if (!lied && spec?.startsWith('1000-')) {
          lied = true;
          return new Response(file.slice(0, 1000), {
            status: 206,
            headers: { 'Content-Range': 'bytes 0-999/2000' },
          });
        }
        return server.fetchImpl(input, init);
      },
    });

    assert.equal(result.bytes, 2000);
    assert.deepEqual(out.bytes(), file);
  });

  test('un trozo colgado se corta por tiempo y se reintenta', async () => {
    const file = makeFile(2000);
    const server = fakeGooglevideo(file);
    const out = collect();
    let hung = false;

    const result = await downloadChunked({
      ...fast,
      timeoutMs: 50,
      url: server.freshUrl(),
      sizeHint: file.byteLength,
      sink: out.sink,
      refreshUrl: async () => server.freshUrl(),
      fetchImpl: (input, init) => {
        if (!hung && init.headers?.Range === 'bytes=1000-1999') {
          hung = true;
          return new Promise((_, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            ),
          );
        }
        return server.fetchImpl(input, init);
      },
    });

    assert.equal(result.bytes, 2000);
    assert.deepEqual(out.bytes(), file);
  });

  test('cancelar corta la petición en vuelo', async () => {
    const file = makeFile(5000);
    const server = fakeGooglevideo(file);
    const controller = new AbortController();
    let chunksWritten = 0;

    const promise = downloadChunked({
      ...fast,
      url: server.freshUrl(),
      sizeHint: file.byteLength,
      sink: {
        write: () => {
          chunksWritten++;
          if (chunksWritten === 2) controller.abort();
        },
      },
      refreshUrl: async () => server.freshUrl(),
      fetchImpl: server.fetchImpl,
      signal: controller.signal,
    });

    await assert.rejects(promise, DownloadAbortedError);
    assert.equal(chunksWritten, 2);
  });

  test('un fallo al renovar el enlace se informa, no se traga', async () => {
    const file = makeFile(3000);
    const server = fakeGooglevideo(file);

    await assert.rejects(
      downloadChunked({
        ...fast,
        url: server.freshUrl(),
        sizeHint: file.byteLength,
        sink: collect().sink,
        refreshUrl: async () => {
          throw new Error('sin red');
        },
        fetchImpl: server.fetchImpl,
      }),
      /No se pudo renovar el enlace en el byte 1000: sin red/,
    );
  });
});
