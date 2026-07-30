import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';

/**
 * Reads design tokens out of CSS at runtime.
 *
 * Recharts and Leaflet paint to SVG/canvas and can't resolve `var(--x)`,
 * so they need literal color strings. Rather than duplicating the palette
 * in JS (which then silently drifts from the stylesheet), this reads the
 * computed values back from :root — keeping index.css the single source
 * of truth for every colour in the product.
 *
 * Recomputed whenever the theme flips, since the same variable names
 * resolve to different values under `.dark`.
 */

const read = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

export type ThemeTokens = {
  series: string[];
  grid: string;
  axis: string;
  surface: string;
  content: string;
  priority: Record<'Critical' | 'High' | 'Medium' | 'Low', string>;
  markerUser: string;
  tooltip: React.CSSProperties;
};

export function useThemeTokens(): ThemeTokens {
  const { isDark } = useTheme();

  return useMemo(() => {
    const surface = read('--color-surface', isDark ? '#111827' : '#FFFFFF');
    const content = read('--color-content', isDark ? '#F1F5F9' : '#0F172A');
    const grid = read('--color-chart-grid', isDark ? '#1E293B' : '#E2E8F0');

    return {
      series: [
        read('--color-chart-1', '#0369A1'),
        read('--color-chart-2', '#C2410C'),
        read('--color-chart-3', '#15803D'),
        read('--color-chart-4', '#7C3AED'),
        read('--color-chart-5', '#B45309'),
      ],
      grid,
      axis: read('--color-chart-axis', isDark ? '#A3B1C2' : '#4E5A6B'),
      surface,
      content,
      priority: {
        Critical: read('--color-priority-critical', '#B91C1C'),
        High: read('--color-priority-high', '#C2410C'),
        Medium: read('--color-priority-medium', '#B45309'),
        Low: read('--color-priority-low', '#15803D'),
      },
      markerUser: read('--color-marker-user', '#0369A1'),
      tooltip: {
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${grid}`,
        background: surface,
        color: content,
        boxShadow: 'var(--shadow-3)',
      },
    };
    // isDark is the trigger: the CSS variables themselves change with it.
  }, [isDark]);
}
