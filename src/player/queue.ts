/**
 * Lógica pura de la cola de reproducción.
 *
 * Aparte del proveedor para poder probarla sin React ni audio nativo. Trabaja
 * sobre `order`, la lista de índices en el orden en que van a sonar, y sobre
 * `pos`, la posición actual dentro de `order`.
 */

/** Fisher–Yates sobre una copia. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Orden de reproducción para una cola de `length` canciones empezando por
 * `start`. En aleatorio la elegida suena primero y el resto va revuelto detrás.
 */
export function buildOrder(
  length: number,
  start: number,
  shuffle: boolean,
  random: () => number = Math.random,
): { order: number[]; pos: number } {
  const indices = Array.from({ length }, (_, i) => i);
  if (!shuffle) return { order: indices, pos: start };
  return {
    order: [start, ...shuffled(indices.filter((i) => i !== start), random)],
    pos: 0,
  };
}

/**
 * Primera posición a partir de `from` (incluida) avanzando en `direction` que
 * sea reproducible. Sin vuelta: null si se acaba la lista.
 */
export function findPlayable(
  length: number,
  from: number,
  direction: 1 | -1,
  isPlayable: (pos: number) => boolean,
): number | null {
  for (let p = from; p >= 0 && p < length; p += direction) {
    if (isPlayable(p)) return p;
  }
  return null;
}

/**
 * Siguiente posición reproducible desde `pos` en `direction`.
 *
 * Con `wrap` da la vuelta a la lista, y puede devolver la propia `pos`: una
 * cola de una sola canción con "repetir todo" tiene que volver a sonar, no
 * quedarse callada. Devuelve null si no hay adónde ir.
 */
export function step(
  length: number,
  pos: number,
  direction: 1 | -1,
  wrap: boolean,
  isPlayable: (pos: number) => boolean,
): number | null {
  for (let i = 1; i <= length; i++) {
    let p = pos + direction * i;
    if (p < 0 || p >= length) {
      if (!wrap) return null;
      p = ((p % length) + length) % length;
    }
    if (isPlayable(p)) return p;
  }
  return null;
}

/**
 * Activa o desactiva el aleatorio sin perder la canción que suena.
 * Al activarlo, la actual pasa a ser la primera; al desactivarlo se vuelve al
 * orden natural y se sigue desde donde se iba.
 */
export function toggleShuffleOrder(
  order: readonly number[],
  pos: number,
  turningOn: boolean,
  random: () => number = Math.random,
): { order: number[]; pos: number } {
  if (!order.length) return { order: [], pos: 0 };
  const current = order[pos];
  if (turningOn) {
    return { order: [current, ...shuffled(order.filter((i) => i !== current), random)], pos: 0 };
  }
  const natural = [...order].sort((a, b) => a - b);
  return { order: natural, pos: Math.max(0, natural.indexOf(current)) };
}

/**
 * Quita el elemento `removed` (índice sobre la cola) del orden, reindexando
 * los que quedan por encima. Si se quita el que suena, la posición se queda
 * donde estaba, que ahora apunta al siguiente.
 */
export function removeFromOrder(
  order: readonly number[],
  pos: number,
  removed: number,
): { order: number[]; pos: number } {
  const current = order[pos];
  const next = order.filter((i) => i !== removed).map((i) => (i > removed ? i - 1 : i));

  if (current === removed) {
    return { order: next, pos: Math.min(pos, Math.max(0, next.length - 1)) };
  }
  const adjusted = current > removed ? current - 1 : current;
  return { order: next, pos: Math.max(0, next.indexOf(adjusted)) };
}
