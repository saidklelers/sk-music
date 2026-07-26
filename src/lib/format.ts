/** Segundos → `m:ss` o `h:mm:ss`. Devuelve `--:--` si el dato no sirve. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--';

  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Bytes → texto corto tipo `4,2 MB`. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 MB';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  const decimals = value >= 100 || i <= 1 ? 0 : 1;

  return `${value.toFixed(decimals).replace('.', ',')} ${units[i]}`;
}

/** Fecha en formato corto en español. */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** `3 canciones` / `1 canción`, sin el `1 canciones` de rigor. */
export function pluralTracks(n: number): string {
  return n === 1 ? '1 canción' : `${n} canciones`;
}
