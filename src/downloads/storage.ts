import { Directory, File, Paths } from 'expo-file-system';

/**
 * Rutas en disco.
 *
 * Regla importante: en la base de datos guardamos SÓLO el nombre del archivo,
 * nunca la ruta absoluta. En iOS el contenedor de la app cambia de ruta entre
 * instalaciones y actualizaciones, así que una URI absoluta guardada hoy apunta
 * a la nada mañana. La ruta se rearma en cada lectura con estos helpers.
 */

export const tracksDir = new Directory(Paths.document, 'tracks');
export const artworkDir = new Directory(Paths.document, 'artwork');

/** Crea los directorios si faltan. Idempotente. */
export function ensureDirs() {
  if (!tracksDir.exists) tracksDir.create({ intermediates: true });
  if (!artworkDir.exists) artworkDir.create({ intermediates: true });
}

export function trackFile(fileName: string): File {
  return new File(tracksDir, fileName);
}

export function artworkFile(fileName: string): File {
  return new File(artworkDir, fileName);
}

/** URI absoluta del audio, o null si el archivo se perdió. */
export function trackUri(fileName: string): string | null {
  const f = trackFile(fileName);
  return f.exists ? f.uri : null;
}

/** URI absoluta de la carátula, o null si no hay. */
export function artworkUri(fileName: string | null): string | null {
  if (!fileName) return null;
  const f = artworkFile(fileName);
  return f.exists ? f.uri : null;
}

/** Borra los archivos de una canción. No falla si ya no existen. */
export function deleteTrackFiles(fileName: string, artworkName: string | null) {
  try {
    const f = trackFile(fileName);
    if (f.exists) f.delete();
  } catch {
    // Un archivo que ya no está es el resultado deseado.
  }
  if (artworkName) {
    try {
      const a = artworkFile(artworkName);
      if (a.exists) a.delete();
    } catch {
      // idem
    }
  }
}

/** Espacio libre en el dispositivo, en bytes. */
export function availableSpace(): number {
  return Paths.availableDiskSpace ?? 0;
}

/**
 * Elimina audio y carátulas que ya no están referenciados en la base de datos
 * (descargas interrumpidas, borrados a medias). Devuelve los bytes liberados.
 */
export function pruneOrphans(knownTracks: string[], knownArtwork: string[]): number {
  ensureDirs();
  const keepTracks = new Set(knownTracks);
  const keepArtwork = new Set(knownArtwork);
  let freed = 0;

  const sweep = (dir: Directory, keep: Set<string>) => {
    for (const item of dir.list()) {
      if (item instanceof File && !keep.has(item.name)) {
        freed += item.size ?? 0;
        try {
          item.delete();
        } catch {
          freed -= item.size ?? 0;
        }
      }
    }
  };

  sweep(tracksDir, keepTracks);
  sweep(artworkDir, keepArtwork);
  return freed;
}
