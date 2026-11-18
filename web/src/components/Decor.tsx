// Декор: бархатные ёлочные игрушки (векторные заглушки в палитре; готовые 3D-рендеры
// можно положить в public/objects и подставить через <img>), снег, качание и парение.
import { memo, useId, type CSSProperties } from "react";

const PALETTE = {
  red: ["#e04150", "#c21f2b", "#6e0a14"],
  green: ["#2f7a5a", "#145a40", "#06221a"],
  cream: ["#fffaf0", "#f7e9cc", "#b89c66"],
} as const;

type Tone = keyof typeof PALETTE;

/** Бархатная фактура: мелкий шум + мягкий свет сверху слева, без глянца. */
function Velvet({ id, tone }: { id: string; tone: Tone }) {
  const [hi, mid, lo] = PALETTE[tone];
  return (
    <defs>
      <radialGradient id={`${id}g`} cx="35%" cy="30%" r="75%">
        <stop offset="0" stopColor={hi} />
        <stop offset="0.55" stopColor={mid} />
        <stop offset="1" stopColor={lo} />
      </radialGradient>
      <filter id={`${id}v`} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="3" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.22 0" result="na" />
        <feComposite in="na" in2="SourceGraphic" operator="in" result="nm" />
        <feBlend in="SourceGraphic" in2="nm" mode="multiply" />
      </filter>
      <radialGradient id={`${id}s`} cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="#000" stopOpacity="0.35" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

export const Ornament = memo(function Ornament({
  tone = "red",
  size = 84,
  thread = 90,
  style,
  dur = 5.5,
}: {
  tone?: Tone;
  size?: number;
  thread?: number;
  style?: CSSProperties;
  dur?: number;
}) {
  const id = useId().replace(/:/g, "");
  const h = thread + size + 10;
  return (
    <div className="decor swing" style={{ ...style, ["--dur" as string]: `${dur}s` }} aria-hidden>
      <svg width={size} height={h} viewBox={`0 0 100 ${(h / size) * 100}`}>
        <Velvet id={id} tone={tone} />
        <line x1="50" y1="0" x2="50" y2={(thread / size) * 100} stroke="#E3B85A" strokeWidth="1.6" />
        <g transform={`translate(0 ${(thread / size) * 100})`}>
          <rect x="40" y="0" width="20" height="12" rx="3" fill="#E3B85A" />
          <rect x="40" y="9" width="20" height="3" fill="#b08a3a" />
          <ellipse cx="54" cy="104" rx="34" ry="6" fill={`url(#${id}s)`} />
          <circle cx="50" cy="56" r="44" fill={`url(#${id}g)`} filter={`url(#${id}v)`} />
          <path d="M10 52 q40 16 80 0" fill="none" stroke="#E3B85A" strokeWidth="2.2" opacity="0.8" />
          <path d="M14 66 q36 12 72 0" fill="none" stroke="#E3B85A" strokeWidth="1.4" opacity="0.55" strokeDasharray="2 4" />
        </g>
      </svg>
    </div>
  );
});

export const GiftBox = memo(function GiftBox({ size = 96, style, dur = 6.5 }: { size?: number; style?: CSSProperties; dur?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className="decor float" style={{ ...style, ["--dur" as string]: `${dur}s` }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <Velvet id={id} tone="green" />
        <ellipse cx="50" cy="94" rx="36" ry="5" fill={`url(#${id}s)`} />
        <rect x="14" y="40" width="72" height="52" rx="8" fill={`url(#${id}g)`} filter={`url(#${id}v)`} />
        <rect x="8" y="30" width="84" height="18" rx="7" fill={`url(#${id}g)`} filter={`url(#${id}v)`} />
        <rect x="44" y="30" width="12" height="62" fill="#C21F2B" />
        <path d="M50 30 C36 10 18 18 30 28 Z M50 30 C64 10 82 18 70 28 Z" fill="#C21F2B" stroke="#8e0f1a" strokeWidth="1.5" />
        <circle cx="50" cy="29" r="5" fill="#E3B85A" />
      </svg>
    </div>
  );
});

export const Star = memo(function Star({ size = 56, style, dur = 7 }: { size?: number; style?: CSSProperties; dur?: number }) {
  return (
    <div className="decor float" style={{ ...style, ["--dur" as string]: `${dur}s` }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <defs>
          <radialGradient id="stg" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="#f6dc9a" />
            <stop offset="0.6" stopColor="#E3B85A" />
            <stop offset="1" stopColor="#8f6a24" />
          </radialGradient>
        </defs>
        <path d="M50 6l12.5 27 29.5 3.5-22 20 6 29L50 71 23.9 85.5l6-29-22-20L37.5 33z" fill="url(#stg)" stroke="#b08a3a" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

export const Bells = memo(function Bells({ size = 80, style, dur = 5.2 }: { size?: number; style?: CSSProperties; dur?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className="decor swing" style={{ ...style, ["--dur" as string]: `${dur}s` }} aria-hidden>
      <svg width={size} height={size * 1.4} viewBox="0 0 100 140">
        <Velvet id={id} tone="cream" />
        <line x1="50" y1="0" x2="50" y2="34" stroke="#E3B85A" strokeWidth="1.6" />
        <path d="M30 108 C30 70 34 50 50 46 C66 50 70 70 70 108 Z" fill={`url(#${id}g)`} filter={`url(#${id}v)`} transform="rotate(-14 50 46)" />
        <path d="M30 108 C30 70 34 50 50 46 C66 50 70 70 70 108 Z" fill={`url(#${id}g)`} filter={`url(#${id}v)`} transform="rotate(14 50 46)" />
        <path d="M34 40 C42 32 58 32 66 40 C58 48 42 48 34 40Z" fill="#C21F2B" />
        <circle cx="50" cy="40" r="5" fill="#E3B85A" />
      </svg>
    </div>
  );
});

/** Редкий снег: 6 точек, 9–14 с на проход, линейно. */
export const Snow = memo(function Snow() {
  const flakes = [
    { l: 8, s: 4, d: 11, delay: -2, drift: 18 },
    { l: 24, s: 3, d: 13.5, delay: -8, drift: -14 },
    { l: 43, s: 5, d: 9.5, delay: -5, drift: 22 },
    { l: 61, s: 3, d: 12.5, delay: -11, drift: -20 },
    { l: 78, s: 4, d: 10.5, delay: -1, drift: 16 },
    { l: 92, s: 3, d: 14, delay: -7, drift: -12 },
  ];
  return (
    <div className="snow" aria-hidden>
      {flakes.map((f, i) => (
        <i
          key={i}
          style={{
            left: `${f.l}%`,
            width: f.s,
            height: f.s,
            animationDuration: `${f.d}s`,
            animationDelay: `${f.delay}s`,
            ["--drift" as string]: `${f.drift}px`,
          }}
        />
      ))}
    </div>
  );
});
