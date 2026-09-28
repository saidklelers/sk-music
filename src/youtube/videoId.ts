/**
 * Extracción del ID de video.
 *
 * Vive aparte de resolve.ts porque no depende de nada nativo ni de youtubei.js:
 * así la pueden usar el gestor de descargas y los tests sin arrastrar la
 * librería entera.
 */

const ID_PATTERN = /^[\w-]{11}$/;

/** true si la cadena tiene la forma de un ID de video (11 caracteres). */
export function isVideoId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/**
 * Extrae el ID de video de cualquier forma de link de YouTube:
 * youtu.be/ID, /watch?v=ID, /shorts/ID, /embed/ID, /live/ID, music.youtube.com,
 * o directamente un ID de 11 caracteres pegado a mano.
 */
export function parseVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (isVideoId(raw)) return raw;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const isYouTube =
    host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
  if (!isYouTube) return null;

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return isVideoId(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && isVideoId(v)) return v;

  const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})(?:[/?#]|$)/);
  return m ? m[1] : null;
}
