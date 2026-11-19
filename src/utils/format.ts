/**
 * Pure, locale-clean pluralization and count-formatting helpers for UI microcopy.
 */

export function pluralWord(
  count: number,
  singular: string,
  plural?: string
): string {
  const safeCount = Number.isFinite(count) ? count : 0;
  if (Math.abs(safeCount) === 1) {
    return singular;
  }
  return plural ?? `${singular}s`;
}

export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  const safeCount = Number.isFinite(count) ? count : 0;
  return `${safeCount} ${pluralWord(safeCount, singular, plural)}`;
}

export function formatCountSummary(
  parts: ReadonlyArray<{ count: number; singular: string; plural?: string }>,
  separator = ' · '
): string {
  return parts
    .map((p) => pluralize(p.count, p.singular, p.plural))
    .join(separator);
}
