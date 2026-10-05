import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelInput, PanelOp, PanelOutput } from '../../../../shared/contracts/panel';
import { errorText } from './format';
import { rpc } from './rpc';

export interface Query<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Loads one panel operation, and again whenever its input changes or `reload` is called. */
export function useQuery<K extends PanelOp>(
  op: K,
  input: PanelInput<K>,
  enabled = true,
): Query<PanelOutput<K>> {
  const [data, setData] = useState<PanelOutput<K> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(input);
  const inputRef = useRef(input);
  inputRef.current = input;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the serialized input stands in for the object
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    rpc(op, inputRef.current)
      .then((result) => {
        if (!current) return;
        setData(result);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (current) setError(errorText(failure));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [op, key, tick, enabled]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, reload };
}

export interface PagedList<T> {
  items: T[];
  error: string | null;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface PageResult<T> {
  items: T[];
  nextBefore: string | null;
}

/** A list that loads further pages on demand. The list starts over when the filters change. */
export function usePagedList<K extends PanelOp, T extends { id: string }>(
  op: K,
  filters: Omit<PanelInput<K>, 'before'>,
  enabled = true,
): PagedList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(filters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchPage = useCallback(
    (before: string | null, replace: boolean, isCurrent: () => boolean) => {
      setLoading(true);
      const input = { ...filtersRef.current, ...(before ? { before } : {}) } as PanelInput<K>;
      rpc(op, input)
        .then((result) => {
          if (!isCurrent()) return;
          const page = result as unknown as PageResult<T>;
          setItems((previous) => (replace ? page.items : [...previous, ...page.items]));
          setNext(page.nextBefore);
          setError(null);
        })
        .catch((failure: unknown) => {
          if (isCurrent()) setError(errorText(failure));
        })
        .finally(() => {
          if (isCurrent()) setLoading(false);
        });
    },
    [op],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the serialized filters stand in for the object
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let current = true;
    fetchPage(null, true, () => current);
    return () => {
      current = false;
    };
  }, [key, tick, enabled, fetchPage]);

  const loadMore = useCallback(() => {
    if (!next || loading) return;
    fetchPage(next, false, () => true);
  }, [next, loading, fetchPage]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { items, error, loading, hasMore: next !== null, loadMore, reload };
}
