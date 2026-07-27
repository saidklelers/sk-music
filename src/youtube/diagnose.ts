import { getInnertube, resetInnertube } from './innertube';

/**
 * Video de prueba: uno público, sin restricción y que lleva años disponible.
 * Solo se le piden metadatos, nunca se descarga.
 */
const PROBE_ID = 'dQw4w9WgXcQ';

const CLIENTS = ['IOS', 'ANDROID'] as const;

/** Mismo UA que usa el gestor de descargas, para que la prueba sea equivalente. */
const IOS_UA =
  'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)';

/** Un solo byte: basta para saber si el servidor acepta la petición. */
const RANGE = { Range: 'bytes=0-0' };

/**
 * Tope de la prueba de red.
 *
 * Alto a propósito: en este dispositivo la primera conexión llegó a tardar 252 s
 * y sí completaba. Con 45 s el diagnóstico reportaba "sin salida a internet",
 * que era un falso negativo — había internet, sólo tardaba una barbaridad.
 */
const NET_PROBE_TIMEOUT_MS = 240_000;

/**
 * Prueba la cadena de resolución paso a paso y devuelve un informe legible.
 *
 * Existe porque un fallo de descarga puede venir de sitios muy distintos —red,
 * creación de sesión, un cliente concreto, o que YouTube dejara de entregar
 * URLs en claro— y desde la app no hay forma de distinguirlos. Esto lo hace
 * visible sin tener que conectar el teléfono a un depurador.
 */
export async function diagnose(): Promise<string> {
  const out: string[] = [];
  const stamp = (start: number) => `${Date.now() - start} ms`;

  /* 1. Red. Con tope propio: sin él esta prueba llegó a tardar 4 minutos en
     frío, que era justo el dato que había que ver y no quedarse esperando. */
  const tNet = Date.now();
  const controller = new AbortController();
  const netTimer = setTimeout(() => controller.abort(), NET_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch('https://www.youtube.com/generate_204', {
      signal: controller.signal,
    });
    const ms = Date.now() - tNet;
    out.push(`Red: OK (HTTP ${res.status}, ${ms} ms)`);
    if (ms > 5000) {
      out.push('   ⚠ arranque en frío lento — probablemente DNS o IPv6');
    }
  } catch {
    out.push(`Red: FALLA — sin respuesta en ${NET_PROBE_TIMEOUT_MS / 1000} s`);
    out.push('\nNo hay salida a internet. Lo demás no se puede probar.');
    return out.join('\n');
  } finally {
    clearTimeout(netTimer);
  }

  /* 2. Sesión. Aquí es donde se colgaba con retrieve_player activo. */
  const tSes = Date.now();
  try {
    await getInnertube();
    out.push(`Sesión: OK (${stamp(tSes)})`);
  } catch (err) {
    resetInnertube();
    out.push(`Sesión: FALLA — ${err instanceof Error ? err.message : 'error'}`);
    return out.join('\n');
  }

  /* 3. Cada cliente por separado. */
  const yt = await getInnertube();

  for (const client of CLIENTS) {
    const tCli = Date.now();
    try {
      const info = await yt.getBasicInfo(PROBE_ID, { client });
      const fmt = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' }) as
        | { url?: string; signature_cipher?: string; cipher?: string; content_length?: number }
        | undefined;

      if (!fmt) {
        out.push(`${client}: sin formato m4a (${stamp(tCli)})`);
      } else if (fmt.signature_cipher || fmt.cipher) {
        out.push(`${client}: formato CIFRADO, inservible sin player (${stamp(tCli)})`);
      } else if (!fmt.url) {
        out.push(`${client}: formato sin URL (${stamp(tCli)})`);
      } else {
        const mb = fmt.content_length ? (fmt.content_length / 1048576).toFixed(1) : '?';
        out.push(`${client}: OK — audio de ${mb} MB (${stamp(tCli)})`);

        // Tener una URL no significa que googlevideo la vaya a servir. Se
        // prueban las cuatro combinaciones porque las dos dimensiones importan
        // por separado: sin `Range` el servidor responde 403 aunque todo lo
        // demás esté bien, y eso sólo se ve comparando.
        for (const [label, headers] of [
          ['con rango + UA', { ...RANGE, 'User-Agent': IOS_UA }],
          ['con rango, sin UA', { ...RANGE }],
          ['sin rango, con UA', { 'User-Agent': IOS_UA }],
          ['sin rango ni UA', {}],
        ] as [string, Record<string, string>][]) {
          const tDl = Date.now();
          try {
            const probe = await fetch(fmt.url, { method: 'GET', headers });
            const verdict = probe.ok || probe.status === 206 ? 'OK' : 'RECHAZADO';
            out.push(`   ${label}: HTTP ${probe.status} ${verdict} (${stamp(tDl)})`);
          } catch (err) {
            out.push(`   ${label}: FALLA — ${err instanceof Error ? err.message : 'error'}`);
          }
        }
      }
    } catch (err) {
      out.push(`${client}: FALLA — ${err instanceof Error ? err.message : 'error'} (${stamp(tCli)})`);
    }
  }

  const anyOk = out.some((l) => l.includes(': OK — audio'));
  out.push('');
  out.push(
    anyOk
      ? 'Resultado: al menos un cliente entrega audio. Las descargas deberían funcionar.'
      : 'Resultado: ningún cliente entrega audio en claro. Toca actualizar youtubei.js y recompilar.',
  );

  return out.join('\n');
}
