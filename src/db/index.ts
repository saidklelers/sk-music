import * as SQLite from 'expo-sqlite';

export type Track = {
  id: string; // ID del video de YouTube
  title: string;
  artist: string;
  duration: number; // segundos
  file_name: string; // sólo el nombre; la ruta absoluta se arma al leer
  artwork_name: string | null;
  size: number;
  added_at: number;
};

export type Playlist = {
  id: number;
  name: string;
  created_at: number;
  track_count: number;
};

export const DB_NAME = 'skmusic.db';

/**
 * Migraciones. `user_version` marca el esquema aplicado; cada bloque sube un
 * escalón, así se puede evolucionar sin borrar la biblioteca del usuario.
 */
export async function migrate(db: SQLite.SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  if (version < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS tracks (
        id           TEXT PRIMARY KEY NOT NULL,
        title        TEXT NOT NULL,
        artist       TEXT NOT NULL DEFAULT 'Desconocido',
        duration     INTEGER NOT NULL DEFAULT 0,
        file_name    TEXT NOT NULL,
        artwork_name TEXT,
        size         INTEGER NOT NULL DEFAULT 0,
        added_at     INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id    TEXT    NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, track_id)
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_added   ON tracks(added_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pt_playlist    ON playlist_tracks(playlist_id, position);

      PRAGMA user_version = 1;
    `);
  }
}

/* ------------------------------- canciones ------------------------------- */

export function listTracks(db: SQLite.SQLiteDatabase, search = ''): Promise<Track[]> {
  const q = search.trim();
  if (!q) {
    return db.getAllAsync<Track>('SELECT * FROM tracks ORDER BY added_at DESC');
  }
  const like = `%${q}%`;
  return db.getAllAsync<Track>(
    'SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? ORDER BY added_at DESC',
    [like, like],
  );
}

export function getTrack(db: SQLite.SQLiteDatabase, id: string): Promise<Track | null> {
  return db.getFirstAsync<Track>('SELECT * FROM tracks WHERE id = ?', [id]);
}

export async function trackExists(db: SQLite.SQLiteDatabase, id: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM tracks WHERE id = ?',
    [id],
  );
  return (row?.n ?? 0) > 0;
}

export async function insertTrack(db: SQLite.SQLiteDatabase, track: Track) {
  await db.runAsync(
    `INSERT OR REPLACE INTO tracks
       (id, title, artist, duration, file_name, artwork_name, size, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      track.id,
      track.title,
      track.artist,
      track.duration,
      track.file_name,
      track.artwork_name,
      track.size,
      track.added_at,
    ],
  );
}

export async function deleteTrack(db: SQLite.SQLiteDatabase, id: string) {
  await db.runAsync('DELETE FROM tracks WHERE id = ?', [id]);
}

export async function renameTrack(
  db: SQLite.SQLiteDatabase,
  id: string,
  title: string,
  artist: string,
) {
  await db.runAsync('UPDATE tracks SET title = ?, artist = ? WHERE id = ?', [title, artist, id]);
}

export async function totalLibrarySize(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(size) AS total FROM tracks',
  );
  return row?.total ?? 0;
}

/* ------------------------------- playlists ------------------------------- */

export function listPlaylists(db: SQLite.SQLiteDatabase): Promise<Playlist[]> {
  return db.getAllAsync<Playlist>(`
    SELECT p.id, p.name, p.created_at,
           (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
    FROM playlists p
    ORDER BY p.created_at DESC
  `);
}

export async function getPlaylist(
  db: SQLite.SQLiteDatabase,
  id: number,
): Promise<Playlist | null> {
  return db.getFirstAsync<Playlist>(
    `SELECT p.id, p.name, p.created_at,
            (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
     FROM playlists p WHERE p.id = ?`,
    [id],
  );
}

export async function createPlaylist(db: SQLite.SQLiteDatabase, name: string): Promise<number> {
  const res = await db.runAsync('INSERT INTO playlists (name, created_at) VALUES (?, ?)', [
    name.trim(),
    Date.now(),
  ]);
  return res.lastInsertRowId;
}

export async function deletePlaylist(db: SQLite.SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM playlists WHERE id = ?', [id]);
}

export function playlistTracks(db: SQLite.SQLiteDatabase, playlistId: number): Promise<Track[]> {
  return db.getAllAsync<Track>(
    `SELECT t.* FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = ?
     ORDER BY pt.position ASC`,
    [playlistId],
  );
}

export async function addToPlaylist(
  db: SQLite.SQLiteDatabase,
  playlistId: number,
  trackId: string,
) {
  const row = await db.getFirstAsync<{ next: number | null }>(
    'SELECT MAX(position) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?',
    [playlistId],
  );
  await db.runAsync(
    'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
    [playlistId, trackId, row?.next ?? 0],
  );
}

export async function removeFromPlaylist(
  db: SQLite.SQLiteDatabase,
  playlistId: number,
  trackId: string,
) {
  await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [
    playlistId,
    trackId,
  ]);
}

export function playlistsContaining(
  db: SQLite.SQLiteDatabase,
  trackId: string,
): Promise<{ playlist_id: number }[]> {
  return db.getAllAsync<{ playlist_id: number }>(
    'SELECT playlist_id FROM playlist_tracks WHERE track_id = ?',
    [trackId],
  );
}
