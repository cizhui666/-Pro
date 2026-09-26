import { query, QueryError, type QueryResult } from './api';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';

type HistoryItem = {
  id: string;
  keyword: string;
  at: number;
};

const MAX_HISTORY = 20;

export function useQueryRunner() {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [loading]);

  const runQuery = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || loading) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setResult(null);
      setShowRaw(false);
      setAttempt(1);

      try {
        const data = await query(trimmed, controller.signal, setAttempt);
        if (controller.signal.aborted) return;
        setResult(data);
        setHistory((prev) => {
          const next = [
            { id: `${Date.now()}`, keyword: trimmed, at: Date.now() },
            ...prev.filter((item) => item.keyword !== trimmed),
          ];
          return next.slice(0, MAX_HISTORY);
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        setResult(null);
        if (e instanceof QueryError && e.kind === 'cancelled') {
          setError('已取消查询');
        } else {
          setError(e instanceof Error ? e.message : '查询失败，请稍后重试');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [loading],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setError('已取消查询');
  }, []);

  const submit = useCallback(() => {
    void runQuery(keyword);
  }, [keyword, runQuery]);

  const pick = useCallback(
    (value: string) => {
      setKeyword(value);
      void runQuery(value);
    },
    [runQuery],
  );

  const clearHistory = useCallback(() => setHistory([]), []);

  const copy = useCallback(async () => {
    if (!result) return;
    await Clipboard.setStringAsync(showRaw ? result.raw : result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [result, showRaw]);

  return {
    keyword,
    setKeyword,
    loading,
    error,
    setError,
    result,
    showRaw,
    setShowRaw,
    history,
    copied,
    attempt,
    elapsed,
    runQuery,
    submit,
    pick,
    cancel,
    clearHistory,
    copy,
  };
}
