interface SparklineProps {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  className?: string;
}

/** Tiny inline area sparkline of a short numeric series, auto-scaled to its own range. */
export function Sparkline({ values, color, width = 62, height = 24, className }: SparklineProps) {
  const pad = 2;
  if (values.length < 2) {
    return <span className={className} style={{ display: 'inline-block', width, height }} />;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const n = values.length;
  const px = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);
  const py = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);
  const line = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${px(0).toFixed(1)},${height} ${line} ${px(n - 1).toFixed(1)},${height}`;
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={area} fill={color} opacity="0.13" />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={px(n - 1)} cy={py(values[n - 1])} r="1.7" fill={color} />
    </svg>
  );
}
