/** Criterios de orden de la biblioteca. */
export type SortMode = 'recent' | 'title' | 'artist';

export const SORT_MODES: SortMode[] = ['recent', 'title', 'artist'];

export const SORT_LABEL: Record<SortMode, string> = {
  recent: 'Recientes',
  title: 'Título',
  artist: 'Artista',
};

type Sortable = { title: string; artist: string; added_at: number };

/**
 * Comparación "humana": sin distinguir mayúsculas ni tildes (Á = a) y con los
 * números por su valor (2 antes que 10).
 */
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Devuelve una copia ordenada; no toca la lista original. */
export function sortTracks<T extends Sortable>(tracks: readonly T[], mode: SortMode): T[] {
  const out = [...tracks];
  switch (mode) {
    case 'title':
      return out.sort((a, b) => collator.compare(a.title, b.title));
    case 'artist':
      return out.sort(
        (a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title),
      );
    default:
      return out.sort((a, b) => b.added_at - a.added_at);
  }
}
