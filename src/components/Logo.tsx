import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { brand } from '@/theme';

/**
 * Monograma SK.
 *
 * Construcción geométrica, no tipográfica: la S son dos arcos de 270° de radio
 * 14 con centros en (30,36) y (30,64); la K comparte el alto exacto (y 22→78) y
 * abre sus brazos a 45° desde el vértice (60,50). Todo lleva el mismo grosor de
 * trazo y remates redondos, que es lo que hace que lean como una sola marca.
 *
 * Los tramos rectos van con `L` explícito y no con `V`/`H`: librsvg (el que
 * rasteriza los iconos) ignora esos comandos abreviados y el asta de la K
 * desaparecía, dejando un chevron en vez de una K.
 */

const S_PATH = 'M 44 36 A 14 14 0 1 0 30 50 A 14 14 0 1 1 16 64';
const K_STEM = 'M 60 22 L 60 78';
const K_ARMS = 'M 60 50 L 88 22 M 60 50 L 88 78';

/** El monograma es más ancho que alto: 104×100 en unidades del viewBox. */
const ASPECT = 1.04;

type Props = {
  /** Alto en px; el ancho se deriva del aspecto del monograma. */
  size?: number;
  /** `gradient` para marca, `solid` para un color plano. */
  variant?: 'gradient' | 'solid';
  color?: string;
  /** Grosor del trazo en unidades del viewBox de 100. */
  weight?: number;
  opacity?: number;
};

export function Logo({
  size = 64,
  variant = 'gradient',
  color = brand.magenta,
  weight = 9,
  opacity = 1,
}: Props) {
  const stroke = variant === 'gradient' ? 'url(#skGradient)' : color;

  return (
    <Svg width={size * ASPECT} height={size} viewBox="0 0 104 100" opacity={opacity}>
      {variant === 'gradient' && (
        <Defs>
          {/*
            `userSpaceOnUse` no es opcional acá. Con el modo por defecto
            (objectBoundingBox) el degradado se calcula sobre la caja de CADA
            trazo, y la caja del asta de la K —una recta vertical— tiene ancho
            cero: por especificación SVG ese elemento no se pinta y la K queda
            convertida en un chevron. Fijando el degradado en coordenadas
            absolutas se pinta bien y, de paso, la rampa recorre el monograma
            entero en lugar de reiniciarse en cada trazo.
          */}
          <LinearGradient id="skGradient" gradientUnits="userSpaceOnUse" x1="16" y1="22" x2="88" y2="78">
            <Stop offset="0" stopColor={brand.magenta} />
            <Stop offset="1" stopColor={brand.mauve} />
          </LinearGradient>
        </Defs>
      )}
      <Path
        d={S_PATH}
        stroke={stroke}
        strokeWidth={weight}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d={K_STEM}
        stroke={stroke}
        strokeWidth={weight}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d={K_ARMS}
        stroke={stroke}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
