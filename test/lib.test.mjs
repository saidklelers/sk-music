import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatBytes, formatDuration, pluralTracks } from '../src/lib/format.ts';
import { sortTracks } from '../src/lib/sort.ts';
import { parseVideoId } from '../src/youtube/videoId.ts';

describe('parseVideoId', () => {
  const ID = 'dQw4w9WgXcQ';

  for (const input of [
    ID,
    `  ${ID}  `,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&si=abc`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=xyz`,
    `youtu.be/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}?autoplay=1`,
    `https://www.youtube.com/live/${ID}`,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ]) {
    test(`reconoce ${input.trim()}`, () => {
      assert.equal(parseVideoId(input), ID);
    });
  }

  for (const input of [
    '',
    'lo que sea',
    'bad bunny tití me preguntó',
    `https://vimeo.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    'https://www.youtube.com/watch?v=corto',
    'https://www.youtube.com/shorts/dQw4w9WgXcQextra',
    'https://www.youtube.com/playlist?list=PL123',
  ]) {
    test(`rechaza ${JSON.stringify(input)}`, () => {
      assert.equal(parseVideoId(input), null);
    });
  }
});

describe('formatDuration', () => {
  test('minutos y horas', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(61.9), '1:01');
    assert.equal(formatDuration(3600 + 5 * 60 + 7), '1:05:07');
  });

  test('datos que no sirven', () => {
    assert.equal(formatDuration(null), '--:--');
    assert.equal(formatDuration(-1), '--:--');
    assert.equal(formatDuration(Number.NaN), '--:--');
  });
});

describe('formatBytes', () => {
  test('con coma decimal', () => {
    assert.equal(formatBytes(0), '0 MB');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(4.2 * 1024 * 1024), '4,2 MB');
    assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
  });
});

test('pluralTracks', () => {
  assert.equal(pluralTracks(1), '1 canción');
  assert.equal(pluralTracks(0), '0 canciones');
  assert.equal(pluralTracks(7), '7 canciones');
});

describe('sortTracks', () => {
  const tracks = [
    { title: 'Zapato', artist: 'Álvaro', added_at: 1 },
    { title: 'árbol', artist: 'beto', added_at: 3 },
    { title: 'Canción 10', artist: 'Álvaro', added_at: 2 },
    { title: 'Canción 2', artist: 'Álvaro', added_at: 4 },
  ];

  test('recientes primero', () => {
    assert.deepEqual(
      sortTracks(tracks, 'recent').map((t) => t.added_at),
      [4, 3, 2, 1],
    );
  });

  test('por título, sin distinguir tildes ni mayúsculas y con números naturales', () => {
    assert.deepEqual(
      sortTracks(tracks, 'title').map((t) => t.title),
      ['árbol', 'Canción 2', 'Canción 10', 'Zapato'],
    );
  });

  test('por artista y luego título', () => {
    assert.deepEqual(
      sortTracks(tracks, 'artist').map((t) => `${t.artist}/${t.title}`),
      ['Álvaro/Canción 2', 'Álvaro/Canción 10', 'Álvaro/Zapato', 'beto/árbol'],
    );
  });

  test('no modifica la lista original', () => {
    const copy = [...tracks];
    sortTracks(tracks, 'title');
    assert.deepEqual(tracks, copy);
  });
});
