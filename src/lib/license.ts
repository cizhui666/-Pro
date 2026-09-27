import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as ExpoCrypto from 'expo-crypto';

import { encryptParams } from './secure';

const CARD_STORAGE_KEY = 'license.card.v1';
const MARKCODE_STORAGE_KEY = 'license.markcode.v1';
const LOGIN_URL = 'https://iosfc-jfnhqdzdtc.cn-hangzhou.fcapp.run/login';
const LOGIN_TIMEOUT_MS = 20_000;

export type LicenseState = {
  card: string;
  markcode: string;
  vip: number;
  ktype: string;
  kmtype: string;
};

export class LicenseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicenseError';
  }
}

let state: LicenseState | null = null;
let markcodePromise: Promise<string> | null = null;
let restored = false;

const listeners = new Set<() => void>();

export function subscribeLicense(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

export function getLicenseState(): LicenseState | null {
  return state;
}

function randomHex(byteLength: number): string {
  const bytes = ExpoCrypto.getRandomBytes(byteLength);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveMarkCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const idfv = await Application.getIosIdForVendorAsync();
      if (idfv) return idfv;
    } catch {
      // retry below
    }
    await sleep(500);
  }

  const stored = await AsyncStorage.getItem(MARKCODE_STORAGE_KEY);
  if (stored) return stored;

  const generated = randomHex(16);
  await AsyncStorage.setItem(MARKCODE_STORAGE_KEY, generated);
  return generated;
}

export function getMarkCode(): Promise<string> {
  if (!markcodePromise) {
    markcodePromise = resolveMarkCode().catch((error) => {
      markcodePromise = null;
      throw error;
    });
  }
  return markcodePromise;
}

export async function restoreLicense(): Promise<LicenseState | null> {
  if (state) return state;
  const [card, markcode] = await Promise.all([
    AsyncStorage.getItem(CARD_STORAGE_KEY),
    getMarkCode(),
  ]);
  restored = true;
  if (!card) return null;
  return { card, markcode, vip: 0, ktype: '', kmtype: '' };
}

export function hasStoredCard(): boolean {
  return restored && state !== null;
}

export async function verifyCard(card: string): Promise<LicenseState> {
  const trimmed = card.trim();
  if (!trimmed) {
    throw new LicenseError('请输入卡密');
  }

  const markcode = await getMarkCode();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: `d=${encodeURIComponent(encryptParams({ card: trimmed, markcode }))}`,
      signal: controller.signal,
    });
  } catch {
    throw new LicenseError('无法连接验证服务器，请检查网络');
  } finally {
    clearTimeout(timer);
  }

  const text = (await response.text()).trim();

  if (!response.ok) {
    const detail = text && text.length <= 300 && !text.startsWith('{') ? text : '';
    if (response.status === 424) {
      throw new LicenseError(detail || '验证服务器暂时不可用，请稍后重试');
    }
    throw new LicenseError(detail || `验证失败 (HTTP ${response.status})`);
  }

  let parsed: { ok?: boolean; vip?: number; ktype?: string; kmtype?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LicenseError('验证响应异常');
  }

  if (!parsed?.ok) {
    throw new LicenseError('验证失败');
  }

  // 持久化只是便利功能，不应因为存储失败（磁盘满、key 异常等）而拦住已通过校验的卡密。
  try {
    await AsyncStorage.setItem(CARD_STORAGE_KEY, trimmed);
  } catch {
    // 忽略：本次会话内 state 已可用
  }
  restored = true;
  state = {
    card: trimmed,
    markcode,
    vip: typeof parsed.vip === 'number' ? parsed.vip : 0,
    ktype: typeof parsed.ktype === 'string' ? parsed.ktype : '',
    kmtype: typeof parsed.kmtype === 'string' ? parsed.kmtype : '',
  };
  emit();
  return state;
}

export async function requireLicenseParams(): Promise<{ card: string; markcode: string }> {
  const current = state ?? (await restoreLicense());
  if (!current) {
    throw new LicenseError('请先输入卡密');
  }
  return { card: current.card, markcode: current.markcode };
}

export function invalidateLicense(): void {
  state = null;
  restored = true;
  void AsyncStorage.removeItem(CARD_STORAGE_KEY);
  emit();
}

export async function forgetLicense(): Promise<void> {
  invalidateLicense();
  await AsyncStorage.removeItem(CARD_STORAGE_KEY);
}
