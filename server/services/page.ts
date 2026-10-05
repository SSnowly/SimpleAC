export interface Page<T> {
  items: T[];
  nextBefore: string | null;
}

/** Trims the extra row fetched to detect another page and returns the cursor for it. */
export function toPage<T extends { id: string }>(items: T[], limit: number): Page<T> {
  const hasMore = items.length > limit;
  const visible = hasMore ? items.slice(0, limit) : items;
  return { items: visible, nextBefore: hasMore ? (visible.at(-1)?.id ?? null) : null };
}

/** Builds a `WHERE` clause from conditions that each carry their own bound values. */
export function whereClause(parts: { sql: string; values: unknown[] }[]): {
  where: string;
  values: unknown[];
} {
  if (parts.length === 0) return { where: '', values: [] };
  return {
    where: `WHERE ${parts.map((part) => part.sql).join(' AND ')}`,
    values: parts.flatMap((part) => part.values),
  };
}
