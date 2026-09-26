import { encryptParams } from './secure';

export const API_BASE = 'https://iosfc-jfnhqdzdtc.cn-hangzhou.fcapp.run';
export const LIEMO_BASE = 'https://iosfc-jfnhqdzdtc.cn-hangzhou.fcapp.run/qbjlm.php';
export const API_KEY = 'cznb666';
export const QUERY_HOST = new URL(API_BASE).host;
export const LIEMO_HOST = new URL(LIEMO_BASE).host;
export const QUERY_TIMEOUT_MS = 30_000;
export const QUERY_MAX_ATTEMPTS = 3;

export type QueryResult = {
  text: string;
  raw: string;
  isJson: boolean;
  attempts: number;
  durationMs: number;
};

export type QueryErrorKind = 'timeout' | 'network' | 'http' | 'empty' | 'cancelled';

export class QueryError extends Error {
  readonly kind: QueryErrorKind;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(kind: QueryErrorKind, message: string, retryable = false, status?: number) {
    super(message);
    this.name = 'QueryError';
    this.kind = kind;
    this.retryable = retryable;
    this.status = status;
  }
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function responseOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new QueryError('cancelled', '已取消查询', false));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchOnce(
  url: string,
  host: string,
  params: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();

  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: `d=${encodeURIComponent(encryptParams(params))}`,
      signal: controller.signal,
    });

    const body = await response.text();
    return { status: response.status, body };
  } catch {
    if (signal?.aborted) {
      throw new QueryError('cancelled', '已取消查询', false);
    }
    if (timedOut) {
      throw new QueryError('timeout', `接口超时（${Math.round(timeoutMs / 1000)} 秒无响应）`, true);
    }
    throw new QueryError('network', `连接 ${host} 失败，请检查网络`, true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function runQuery(
  url: string,
  host: string,
  params: Record<string, string>,
  signal?: AbortSignal,
  onAttempt?: (attempt: number) => void,
): Promise<QueryResult> {
  const startedAt = Date.now();
  let lastError: QueryError = new QueryError('network', '查询失败，请稍后重试');

  for (let attempt = 1; attempt <= QUERY_MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new QueryError('cancelled', '已取消查询');
    onAttempt?.(attempt);

    try {
      const { status, body } = await fetchOnce(url, host, params, QUERY_TIMEOUT_MS, signal);

      if (status >= 500) {
        throw new QueryError('http', `服务端错误 (HTTP ${status})`, true, status);
      }
      if (!responseOk(status)) {
        const detail = errorText(body);
        const transient = status === 403 && /：\s*$/.test(detail);
        throw new QueryError('http', detail || `接口返回错误 (HTTP ${status})`, transient, status);
      }

      const raw = body.trim();
      if (!raw) throw new QueryError('empty', '接口返回为空', attempt < QUERY_MAX_ATTEMPTS);

      try {
        const parsed = JSON.parse(raw);
        return {
          text: formatJson(parsed),
          raw,
          isJson: true,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
      } catch {
        return {
          text: raw,
          raw,
          isJson: false,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
      }
    } catch (error) {
      if (error instanceof QueryError && error.kind === 'cancelled') throw error;
      lastError =
        error instanceof QueryError ? error : new QueryError('network', '查询失败，请稍后重试');

      if (!lastError.retryable || attempt >= QUERY_MAX_ATTEMPTS || signal?.aborted) {
        throw lastError;
      }
      await delay(500 * attempt, signal);
    }
  }

  throw lastError;
}

export async function query(
  msg: string,
  signal?: AbortSignal,
  onAttempt?: (attempt: number) => void,
): Promise<QueryResult> {
  return runQuery(API_BASE, QUERY_HOST, { cx: msg, key: API_KEY }, signal, onAttempt);
}

export async function queryLieMo(
  name: string,
  region: string,
  signal?: AbortSignal,
  onAttempt?: (attempt: number) => void,
): Promise<QueryResult> {
  return runQuery(
    LIEMO_BASE,
    LIEMO_HOST,
    { xm: name, dq: region, key: API_KEY },
    signal,
    onAttempt,
  );
}

function errorText(body: string): string {
  const text = body.trim();
  if (!text || text.length > 120 || text.startsWith('<')) return '';
  return text;
}
