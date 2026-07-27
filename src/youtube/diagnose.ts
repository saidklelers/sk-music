import Constants from 'expo-constants';

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
/**
 * Radiografía de la URL de audio.
 *
 * Cuando una URL sirve y otra no, la explicación está en sus parámetros, no en
 * cómo se pide. Interesan cuatro:
 *
 * - `expire`: caducidad. Si ya pasó, el 403 es simplemente eso.
 * - `n`: parámetro de estrangulamiento. Descifrarlo exige el JS player, que
 *   está desactivado a propósito porque bloquea el hilo de JS en Hermes. Si
 *   está presente, YouTube puede rechazar la petición.
 * - `pot`: Proof of Origin Token. Si YouTube lo exige para este video y no lo
 *   llevamos, responde 403 y no hay cabecera que lo arregle.
 * - `ip`: si la URL está atada a una IP distinta a la actual, también da 403.
 */
function describeUrl(url: string): string[] {
  const lines: string[] = [];
  try {
    const q = new URL(url).searchParams;

    const expire = Number(q.get('expire'));
    if (expire) {
      const left = Math.round((expire * 1000 - Date.now()) / 1000);
      lines.push(`   expire: ${left > 0 ? `caduca en ${left}s` : `CADUCADA hace ${-left}s`}`);
    }
    lines.push(`   n (estrangulamiento): ${q.get('n') ? 'SÍ presente' : 'ausente'}`);
    lines.push(`   pot (proof of origin): ${q.get('pot') ? 'SÍ presente' : 'ausente'}`);
    lines.push(`   atada a IP: ${q.get('ip') ?? 'no'}`);
    lines.push(`   cliente en URL: ${q.get('c') ?? '?'}`);
  } catch {
    lines.push('   (no se pudo leer la URL)');
  }
  return lines;
}

/**
 * @param videoId Video a probar. Sin él usa el de referencia, que sirve para
 * saber si la cadena funciona en general; con él se prueba justo el que falla,
 * que es lo que permite distinguir un problema del método de uno del video.
 */
export async function diagnose(videoId?: string): Promise<string> {
  const out: string[] = [];
  const stamp = (start: number) => `${Date.now() - start} ms`;

  // Encabeza con la versión: sin esto no hay forma de saber si un informe
  // corresponde a la build que se acaba de instalar o a una anterior.
  out.push(`SK Music ${Constants.expoConfig?.version ?? '?'}`);
  out.push('');

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
  const target = videoId ?? PROBE_ID;
  out.push('');
  out.push(`Video: ${target}${videoId ? '' : ' (referencia)'}`);

  for (const client of CLIENTS) {
    const tCli = Date.now();
    try {
      const info = await yt.getBasicInfo(target, { client });
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
        // Los parámetros de la URL son lo que distingue una que sirve de una
        // que no; sin esto sólo se ve el 403 sin saber por qué.
        out.push(...describeUrl(fmt.url));

        // Lo decisivo no es SI la petición lleva rango, sino CUÁNTO pide: se
        // midió que un byte pasa y el archivo entero se rechaza. Se prueba una
        // escala de tamaños para ver dónde está el umbral exacto, que es lo que
        // determina el tamaño de trozo que usa la descarga.
        const sizes: [string, string][] = [
          ['1 byte', 'bytes=0-0'],
          ['64 KiB', 'bytes=0-65535'],
          ['1 MiB', 'bytes=0-1048575'],
          ['4 MiB', 'bytes=0-4194303'],
        ];
        if (fmt.content_length) {
          sizes.push(['archivo entero', `bytes=0-${fmt.content_length - 1}`]);
        }

        for (const [label, range] of sizes) {
          const tDl = Date.now();
          try {
            const probe = await fetch(fmt.url, {
              method: 'GET',
              headers: { Range: range, 'User-Agent': IOS_UA },
            });
            const verdict = probe.status === 206 || probe.ok ? 'OK' : 'RECHAZADO';
            out.push(`   ${label}: HTTP ${probe.status} ${verdict} (${stamp(tDl)})`);
          } catch (err) {
            out.push(`   ${label}: FALLA — ${err instanceof Error ? err.message : 'error'}`);
          }
        }

        // Sin rango, para conservar la comparación que reveló el patrón.
        const tPlain = Date.now();
        try {
          const probe = await fetch(fmt.url, { method: 'GET' });
          out.push(
            `   sin rango: HTTP ${probe.status} ${probe.ok ? 'OK' : 'RECHAZADO'} (${stamp(tPlain)})`,
          );
        } catch (err) {
          out.push(`   sin rango: FALLA — ${err instanceof Error ? err.message : 'error'}`);
        }
      }
    } catch (err) {
      out.push(`${client}: FALLA — ${err instanceof Error ? err.message : 'error'} (${stamp(tCli)})`);
    }
  }

  const anyOk = out.some((l) => l.includes(': OK — audio'));
  // El veredicto tiene que mirar la prueba de descarga, no sólo que exista una
  // URL: decir "deberían funcionar" mientras las peticiones sin rango daban 403
  // fue precisamente lo que ocultó la causa durante varias rondas.
  const rangeWorks = out.some((l) => l.includes('con rango') && l.includes('OK'));
  const plainFails = out.some((l) => l.includes('sin rango') && l.includes('RECHAZADO'));

  out.push('');
  if (!anyOk) {
    out.push('Resultado: ningún cliente entrega audio en claro.');
    out.push('Toca actualizar youtubei.js y recompilar.');
  } else if (rangeWorks && plainFails) {
    out.push('Resultado: este video EXIGE petición por rango.');
    out.push('Es lo esperado; la app pide con rango primero.');
  } else if (rangeWorks) {
    out.push('Resultado: el servidor acepta la descarga de cualquier forma.');
  } else {
    out.push('Resultado: hay URL de audio pero el servidor la rechaza siempre.');
    out.push('Revisa expire, n, pot e IP de arriba.');
  }

  return out.join('\n');
}
