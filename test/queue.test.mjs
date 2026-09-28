import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildOrder,
  findPlayable,
  removeFromOrder,
  shuffled,
  step,
  toggleShuffleOrder,
} from '../src/player/queue.ts';

/** Generador determinista para que el aleatorio sea reproducible. */
function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

const all = () => true;

describe('shuffled', () => {
  test('conserva los elementos y no toca el original', () => {
    const input = [0, 1, 2, 3, 4, 5, 6, 7];
    const out = shuffled(input, seeded());
    assert.deepEqual([...out].sort((a, b) => a - b), input);
    assert.deepEqual(input, [0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('buildOrder', () => {
  test('en orden empieza en la elegida', () => {
    assert.deepEqual(buildOrder(4, 2, false), { order: [0, 1, 2, 3], pos: 2 });
  });

  test('en aleatorio la elegida suena primero', () => {
    const { order, pos } = buildOrder(6, 3, true, seeded());
    assert.equal(pos, 0);
    assert.equal(order[0], 3);
    assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  });
});

describe('findPlayable', () => {
  test('salta las que no están en disco', () => {
    const missing = new Set([0, 1]);
    assert.equal(findPlayable(4, 0, 1, (p) => !missing.has(p)), 2);
  });

  test('null si no queda ninguna', () => {
    assert.equal(findPlayable(3, 1, 1, () => false), null);
  });
});

describe('step', () => {
  test('avanza y retrocede', () => {
    assert.equal(step(5, 2, 1, false, all), 3);
    assert.equal(step(5, 2, -1, false, all), 1);
  });

  test('sin vuelta, null al final y al principio', () => {
    assert.equal(step(5, 4, 1, false, all), null);
    assert.equal(step(5, 0, -1, false, all), null);
  });

  test('con vuelta, del final al principio y viceversa', () => {
    assert.equal(step(5, 4, 1, true, all), 0);
    assert.equal(step(5, 0, -1, true, all), 4);
  });

  test('repetir todo con una sola canción vuelve a ella misma', () => {
    assert.equal(step(1, 0, 1, true, all), 0);
  });

  test('con vuelta y el resto sin archivo, vuelve a la actual', () => {
    assert.equal(step(4, 1, 1, true, (p) => p === 1), 1);
  });

  test('salta huecos en ambos sentidos', () => {
    const ok = (p) => p !== 3;
    assert.equal(step(5, 2, 1, false, ok), 4);
    assert.equal(step(5, 4, -1, false, ok), 2);
  });

  test('cola vacía', () => {
    assert.equal(step(0, 0, 1, true, all), null);
  });
});

describe('toggleShuffleOrder', () => {
  test('al activarlo la actual pasa a ser la primera', () => {
    const { order, pos } = toggleShuffleOrder([0, 1, 2, 3, 4], 3, true, seeded());
    assert.equal(pos, 0);
    assert.equal(order[0], 3);
    assert.equal(order.length, 5);
  });

  test('al desactivarlo vuelve al orden natural sin perder la actual', () => {
    const { order, pos } = toggleShuffleOrder([4, 1, 3, 0, 2], 2, false);
    assert.deepEqual(order, [0, 1, 2, 3, 4]);
    assert.equal(order[pos], 3);
  });
});

describe('removeFromOrder', () => {
  test('reindexa y conserva la actual si se quita otra', () => {
    // Suena el índice 3 (en pos 1); se borra el índice 1.
    const { order, pos } = removeFromOrder([0, 3, 1, 2], 1, 1);
    assert.deepEqual(order, [0, 2, 1]);
    assert.equal(order[pos], 2); // el antiguo 3, ahora 2
  });

  test('si se quita la que suena, pasa a la siguiente', () => {
    const { order, pos } = removeFromOrder([0, 1, 2], 1, 1);
    assert.deepEqual(order, [0, 1]);
    assert.equal(pos, 1);
  });

  test('si se quita la última y sonaba, se queda en la nueva última', () => {
    const { order, pos } = removeFromOrder([0, 1, 2], 2, 2);
    assert.deepEqual(order, [0, 1]);
    assert.equal(pos, 1);
  });
});
