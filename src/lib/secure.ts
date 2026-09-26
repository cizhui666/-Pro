import * as CryptoJS from 'crypto-js';
import * as ExpoCrypto from 'expo-crypto';

export const PAYLOAD_SECRET =
  'e8d4ad47cc59c6e116a9d364ff5f33478a44148896d1f7f311e08b3e06af3d93';
export const PAYLOAD_MAX_AGE_SEC = 300;

type Wire = {
  t: number;
  p: Record<string, string>;
};

type Encoded = { toString: (encoder: unknown) => string };

type CipherOutput = Encoded & { ciphertext: Encoded };

function deriveKeys() {
  return {
    enc: CryptoJS.SHA256(`${PAYLOAD_SECRET}|enc`),
    mac: CryptoJS.SHA256(`${PAYLOAD_SECRET}|mac`),
  };
}

function randomHex(byteLength: number): string {
  const bytes = ExpoCrypto.getRandomBytes(byteLength);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function encryptParams(params: Record<string, string>): string {
  const { enc, mac } = deriveKeys();
  const iv = CryptoJS.enc.Hex.parse(randomHex(16));
  const payload: Wire = { t: Math.floor(Date.now() / 1000), p: params };

  const cipher = CryptoJS.AES.encrypt(JSON.stringify(payload), enc, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }) as CipherOutput;

  const ivB64 = iv.toString(CryptoJS.enc.Base64);
  const cipherB64 = cipher.ciphertext.toString(CryptoJS.enc.Base64);
  const tag = CryptoJS.HmacSHA256(`${ivB64}|${cipherB64}`, mac).toString();

  return `1.${ivB64}.${cipherB64}.${tag}`;
}
