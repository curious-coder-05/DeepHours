import React, { useEffect, useRef, useState } from 'react';

export interface CountUpProps {
  value: number;
  durationMs?: number;
  formatter?: (val: number) => string;
  className?: string;
  style?: React.CSSProperties;
}

export const CountUp: React.FC<CountUpProps> = ({
  value,
  durationMs = 460,
  formatter = (v) => String(Math.round(v)),
  className,
  style,
}) => {
  const [display, setDisplay] = useState<number>(value);
  const fromRef = useRef<number>(value);

  useEffect(() => {
    const startVal = fromRef.current;
    const targetVal = Number.isFinite(value) ? value : 0;
    if (startVal === targetVal) {
      setDisplay(targetVal);
      return;
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion || durationMs <= 0) {
      fromRef.current = targetVal;
      setDisplay(targetVal);
      return;
    }

    let rafId = 0;
    const startTs = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTs) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = startVal + (targetVal - startVal) * eased;
      setDisplay(next);
      if (t < 1) {
        rafId = window.requestAnimationFrame(step);
      } else {
        fromRef.current = targetVal;
        setDisplay(targetVal);
      }
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(rafId);
      fromRef.current = targetVal;
    };
  }, [value, durationMs]);

  return (
    <span className={className} style={style}>
      {formatter(display)}
    </span>
  );
};
