/**
 * Skeleton primitives.
 *
 * Used instead of spinners for anything that resolves past ~300ms: a
 * skeleton preserves the final layout, so content doesn't shift in when it
 * arrives (CLS) and the wait reads as "loading this specific thing" rather
 * than "the app is busy".
 */

export function Skeleton({
  className = '',
  radius = 'var(--radius-sm)',
}: { className?: string; radius?: string }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/** Mirrors the StatCard footprint so the swap is a straight substitution. */
export function StatCardSkeleton() {
  return (
    <div
      className="surface p-5 rounded-2xl bordered elev-2 flex flex-col gap-3"
      aria-hidden="true"
    >
      <Skeleton className="w-11 h-11" radius="var(--radius-md)" />
      <Skeleton className="w-20 h-3" />
      <Skeleton className="w-14 h-7" />
    </div>
  );
}

export function TableRowSkeleton({ cols = 6 }: { cols?: number }) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <Skeleton className={i === 2 ? 'h-3 w-48' : 'h-3 w-20'} />
        </td>
      ))}
    </tr>
  );
}

/** Announces loading state once, rather than per skeleton element. */
export function SkeletonRegion({
  label,
  children,
}: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-label={label}>
      {children}
    </div>
  );
}
