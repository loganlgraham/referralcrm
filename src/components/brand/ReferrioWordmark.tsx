type Props = { size?: number; color?: string; accent?: string; bg?: string; className?: string };

/**
 * Referrio wordmark. Every letter is Manrope 700 as set; the first of the
 * double r's is the one drawn element, arcing over the i and dotting it.
 * `bg` must match the surface behind the mark — it fills the ring's counter.
 */
export function ReferrioWordmark({
  size = 32,
  color = '#0F1729',
  accent = '#E2694B',
  bg = '#FFFFFF',
  className
}: Props) {
  return (
    <span
      className={className}
      style={{
        fontFamily: 'var(--font-manrope), Manrope, sans-serif',
        fontSize: size,
        fontWeight: 700,
        letterSpacing: '-0.035em',
        color,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'baseline',
        whiteSpace: 'nowrap'
      }}
    >
      Refe
      <svg
        viewBox="0 0 38 80"
        fill="none"
        aria-hidden
        style={{
          width: '0.38em',
          height: '0.8em',
          marginLeft: '-0.025em',
          marginRight: '-0.06em',
          overflow: 'visible'
        }}
      >
        <path
          d="M16 74.8V30.8A19 19 0 0 1 35 11.8H74"
          stroke={accent}
          strokeWidth={10.4}
          strokeLinecap="round"
        />
        <circle cx={82.4} cy={11.8} r={4.6} fill={bg} stroke={accent} strokeWidth={4.8} />
        <circle cx={16} cy={74.8} r={5.6} fill={color} />
      </svg>
      {'r\u0131o'}
    </span>
  );
}
