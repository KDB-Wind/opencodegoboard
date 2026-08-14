import { useCallback, useEffect, useRef, useState } from 'react';

export function usePolling<T>(
  fetcher: (signal?: AbortSignal) => Promise<T>,
  intervalMs: number,
  enabled = true,
  deps: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const fetcherRef = useRef(fetcher);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { fetcherRef.current = fetcher; });

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await fetcherRef.current(controller.signal);
      if (requestId === requestIdRef.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (requestId === requestIdRef.current && !(e instanceof DOMException && e.name === 'AbortError')) setError(e);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    fetchData();

    intervalRef.current = setInterval(fetchData, intervalMs);

    const onVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
      } else {
        fetchData();
        intervalRef.current = setInterval(fetchData, intervalMs);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      requestIdRef.current += 1;
      abortRef.current?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled, fetchData, ...deps]);

  return { data, error, loading, refetch: fetchData };
}
