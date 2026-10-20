type IconVariant = 'navy' | 'light' | 'coral';

type Props = { size?: number; className?: string; title?: string; variant?: IconVariant };

const GEOMETRY = [
  { max: 20, sw: 18,   end: 55, ring: null,                foot: 12.4 },
  { max: 26, sw: 16,   end: 59, ring: { r: 3.2, sw: 7.4 }, foot: 11.2 },
  { max: 40, sw: 14.5, end: 61, ring: { r: 3.6, sw: 6.8 }, foot: 10.2 },
  { max: 56, sw: 13.5, end: 63, ring: { r: 4,   sw: 6.2 }, foot: 9.6 },
  { max: Infinity, sw: 12, end: 64, ring: { r: 4.4, sw: 5.6 }, foot: 8.6 }
];

function palette(variant: IconVariant) {
  switch (variant) {
    case 'navy':
      return { tile: '#0F1729', stroke: '#E2694B', ringFill: '#0F1729', foot: '#FFFFFF' };
    case 'light':
      return { tile: '#FBFCFE', stroke: '#E2694B', ringFill: '#FBFCFE', foot: '#0F1729' };
    case 'coral':
      return { tile: '#E2694B', stroke: '#FFFFFF', ringFill: '#E2694B', foot: '#0F1729' };
    default: {
      const exhaustive: never = variant;
      return exhaustive;
    }
  }
}

/**
 * Referrio app icon / favicon. The stroke thickens and the horizontal run
 * shortens as the tile shrinks, so the arc survives to 16px; below ~22px the
 * ring closes to a solid dot.
 */
export function ReferrioIcon({ size = 32, className, title = 'Referrio', variant = 'navy' }: Props) {
  const g = GEOMETRY.find((step) => size <= step.max)!;
  const colors = palette(variant);
  return (
    <svg
      width={size}
      height={size}
      viewBox="-12.2 -18.05 124 124"
      className={className}
      role="img"
      aria-label={title}
    >
      <rect x={-12.2} y={-18.05} width={124} height={124} rx={27.9} fill={colors.tile} />
      <path
        d={`M16 74.8V30.8A19 19 0 0 1 35 11.8H${g.end}`}
        fill="none"
        stroke={colors.stroke}
        strokeWidth={g.sw}
        strokeLinecap="round"
      />
      {g.ring ? (
        <circle cx={82.4} cy={11.8} r={g.ring.r} fill={colors.ringFill} stroke={colors.stroke} strokeWidth={g.ring.sw} />
      ) : (
        <circle cx={82.4} cy={11.8} r={9} fill={colors.stroke} />
      )}
      <circle cx={16} cy={74.8} r={g.foot} fill={colors.foot} />
    </svg>
  );
}
