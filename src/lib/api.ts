export const API_BASE = encodeURI('https://cizhui.j3.ink/社工/qbjzh.php');
export const API_KEY = 'cznb666';

export type QueryResult = {
  text: string;
  raw: string;
  isJson: boolean;
};

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function query(msg: string, signal?: AbortSignal): Promise<QueryResult> {
  const url = `${API_BASE}?cx=${encodeURIComponent(msg)}&key=${encodeURIComponent(API_KEY)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('网络请求失败，请检查网络连接');
  }

  if (!response.ok) {
    throw new Error(`接口返回错误 (HTTP ${response.status})`);
  }

  const raw = (await response.text()).trim();
  if (!raw) {
    throw new Error('接口返回为空');
  }

  try {
    return { text: formatJson(JSON.parse(raw)), raw, isJson: true };
  } catch {
    return { text: raw, raw, isJson: false };
  }
}
