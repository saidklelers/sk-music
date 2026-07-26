import Svg, { Circle, Path, Polygon } from 'react-native-svg';

import { colors } from '@/theme';

/**
 * Set de iconos propio.
 *
 * Se dibujan a mano en vez de traer una librería de iconos: son pocos, y así
 * comparten el mismo grosor de trazo (1.75) y remates redondos que el logo, que
 * es lo que mantiene la coherencia visual. Los de reproducción van rellenos
 * porque a tamaño pequeño un triángulo con trazo se ve sucio.
 */

type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
});

function Stroked({
  size = 22,
  color = colors.text,
  strokeWidth = 1.75,
  d,
}: IconProps & { d: string }) {
  return (
    <Svg {...base(size)}>
      <Path
        d={d}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export const Play = ({ size = 22, color = colors.text }: IconProps) => (
  <Svg {...base(size)}>
    <Polygon points="7,4.5 20,12 7,19.5" fill={color} />
  </Svg>
);

export const Pause = ({ size = 22, color = colors.text }: IconProps) => (
  <Svg {...base(size)}>
    <Path d="M7 4.5h3.2v15H7zM13.8 4.5H17v15h-3.2z" fill={color} />
  </Svg>
);

export const SkipNext = ({ size = 22, color = colors.text }: IconProps) => (
  <Svg {...base(size)}>
    <Polygon points="5,5 15.5,12 5,19" fill={color} />
    <Path d="M17.5 5h2v14h-2z" fill={color} />
  </Svg>
);

export const SkipPrev = ({ size = 22, color = colors.text }: IconProps) => (
  <Svg {...base(size)}>
    <Polygon points="19,5 8.5,12 19,19" fill={color} />
    <Path d="M4.5 5h2v14h-2z" fill={color} />
  </Svg>
);

export const Shuffle = (p: IconProps) => (
  <Stroked {...p} d="M16 3.5h4.5V8M20.5 3.5 13 11M16 20.5h4.5V16M20.5 20.5 3.5 3.5M3.5 20.5 8 16" />
);

export const Repeat = (p: IconProps) => (
  <Stroked
    {...p}
    d="M6.5 8.5h11a3 3 0 0 1 3 3v.5M17.5 15.5h-11a3 3 0 0 1-3-3V12M9 5.5 6 8.5l3 3M15 18.5l3-3-3-3"
  />
);

export const RepeatOne = ({ size = 22, color = colors.text, strokeWidth = 1.75 }: IconProps) => (
  <Svg {...base(size)}>
    <Path
      d="M6.5 8.5h11a3 3 0 0 1 3 3v.5M17.5 15.5h-11a3 3 0 0 1-3-3V12M9 5.5 6 8.5l3 3M15 18.5l3-3-3-3"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <Path d="M11.4 10.2 12.6 9.4v5.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Svg>
);

export const Download = (p: IconProps) => (
  <Stroked {...p} d="M12 3.5v11m0 0 4-4m-4 4-4-4M4 17.5v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
);

export const Search = ({ size = 22, color = colors.text, strokeWidth = 1.75 }: IconProps) => (
  <Svg {...base(size)}>
    <Circle cx="10.75" cy="10.75" r="6.75" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="m15.75 15.75 4.5 4.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
  </Svg>
);

export const Trash = (p: IconProps) => (
  <Stroked
    {...p}
    d="M4 6.5h16M9.5 6.5V4.75A1.25 1.25 0 0 1 10.75 3.5h2.5a1.25 1.25 0 0 1 1.25 1.25V6.5M6.5 6.5l.8 12.1a1.9 1.9 0 0 0 1.9 1.9h5.6a1.9 1.9 0 0 0 1.9-1.9l.8-12.1"
  />
);

export const Plus = (p: IconProps) => <Stroked {...p} d="M12 5v14M5 12h14" />;

export const Check = (p: IconProps) => <Stroked {...p} d="m4.5 12.5 5 5 10-11" />;

export const X = (p: IconProps) => <Stroked {...p} d="M6 6l12 12M18 6 6 18" />;

export const ChevronDown = (p: IconProps) => <Stroked {...p} d="m5.5 9 6.5 6.5L18.5 9" />;

export const ChevronRight = (p: IconProps) => <Stroked {...p} d="m9 5.5 6.5 6.5L9 18.5" />;

export const ChevronLeft = (p: IconProps) => <Stroked {...p} d="M15 5.5 8.5 12l6.5 6.5" />;

export const Library = (p: IconProps) => (
  <Stroked {...p} d="M4.5 4.5v15M9.5 4.5v15M14.2 5.2l4.6 14.2" />
);

export const Settings = ({ size = 22, color = colors.text, strokeWidth = 1.75 }: IconProps) => (
  <Svg {...base(size)}>
    <Circle cx="12" cy="12" r="3.2" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path
      d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      fill="none"
    />
  </Svg>
);

export const MoreVertical = ({ size = 22, color = colors.text }: IconProps) => (
  <Svg {...base(size)}>
    <Circle cx="12" cy="5" r="1.7" fill={color} />
    <Circle cx="12" cy="12" r="1.7" fill={color} />
    <Circle cx="12" cy="19" r="1.7" fill={color} />
  </Svg>
);

export const Link = (p: IconProps) => (
  <Stroked
    {...p}
    d="M10 13.5a3.8 3.8 0 0 0 5.7.4l2.8-2.8a3.8 3.8 0 0 0-5.4-5.4l-1.6 1.6M14 10.5a3.8 3.8 0 0 0-5.7-.4l-2.8 2.8a3.8 3.8 0 0 0 5.4 5.4l1.6-1.6"
  />
);

export const Music = ({ size = 22, color = colors.text, strokeWidth = 1.75 }: IconProps) => (
  <Svg {...base(size)}>
    <Path d="M9 18V5.5l10-2V16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Circle cx="6.5" cy="18" r="2.5" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Circle cx="16.5" cy="16" r="2.5" stroke={color} strokeWidth={strokeWidth} fill="none" />
  </Svg>
);

export const Clock = ({ size = 22, color = colors.text, strokeWidth = 1.75 }: IconProps) => (
  <Svg {...base(size)}>
    <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={strokeWidth} fill="none" />
    <Path d="M12 7v5.3l3.3 2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
  </Svg>
);
