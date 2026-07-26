import { getInnertube, resetInnertube } from './innertube';

/**
 * Video de prueba: uno público, sin restricción y que lleva años disponible.
 * Solo se le piden metadatos, nunca se descarga.
 */
const PROBE_ID = 'dQw4w9WgXcQ';

const CLIENTS = ['IOS', 'ANDROID', 'YTMUSIC_ANDROID'] as const;

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

  /* 1. Red. */
  const tNet = Date.now();
  try {
    const res = await fetch('https://www.youtube.com/generate_204');
    out.push(`Red: OK (HTTP ${res.status}, ${stamp(tNet)})`);
  } catch (err) {
    out.push(`Red: FALLA — ${err instanceof Error ? err.message : 'error'}`);
    out.push('\nNo hay salida a internet. Lo demás no se puede probar.');
    return out.join('\n');
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
