// Node.js 迁移版 router：保留现有加密、鉴权、限流、缓存逻辑
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const url = require('node:url');
const fs = require('node:fs');
const path = require('node:path');

function envInt(name, def) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}
function envStr(name, def) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return def;
  return v;
}

// 与 PHP 版同值：App 端必须一致，否则解密失败。
const PAYLOAD_SECRET = envStr('FC_PAYLOAD_SECRET', 'e8d4ad47cc59c6e116a9d364ff5f33478a44148896d1f7f311e08b3e06af3d93');
const PAYLOAD_MAX_AGE = envInt('FC_PAYLOAD_MAX_AGE', 300);

const WEIYAN_API = envStr('WEIYAN_API', 'https://wy.llua.cn/api');
const WEIYAN_APPID = envStr('WEIYAN_APPID', '85105');
// RC4 密钥与 appkey 从环境变量读取；留作兜底仅为兼容旧部署。
const WEIYAN_APPKEY = envStr('WEIYAN_APPKEY', '4cB8ac8040tCdFfd');
const WEIYAN_RC4KEY = envStr('WEIYAN_RC4KEY', '3V7QRqC8oIm85105');
const WEIYAN_OK_CODE = envInt('WEIYAN_OK_CODE', 200);
const WEIYAN_VERIFY_CHECK = envInt('WEIYAN_VERIFY_CHECK', 1) === 1;
const WEIYAN_VERIFY_TTL = envInt('WEIYAN_VERIFY_TTL', 60);
const WEIYAN_ALLOW_HTTP_FALLBACK = envInt('WEIYAN_ALLOW_HTTP_FALLBACK', 0) === 1;

const UPSTREAM_TIMEOUT_MS = envInt('FC_UPSTREAM_TIMEOUT_MS', 15000);
const UPSTREAM_CONNECT_TIMEOUT_MS = envInt('FC_UPSTREAM_CONNECT_TIMEOUT_MS', 6000);

const FC_RATE_MAX = envInt('FC_RATE_MAX', 60);
const FC_RATE_DISTINCT = envInt('FC_RATE_DISTINCT', 10);
const FC_CACHE_DIR = envStr('FC_CACHE_DIR', '/tmp/fc_guard');

const ENC_KEY = crypto.createHash('sha256').update(`${PAYLOAD_SECRET}|enc`).digest();
const MAC_KEY = crypto.createHash('sha256').update(`${PAYLOAD_SECRET}|mac`).digest();

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

// 定长比较，避免 timing 侧信道（对应 PHP hash_equals）。
function hashEquals(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function rc4(data, key) {
  const keyLen = key.length;
  if (keyLen === 0) return data;
  const box = new Uint8Array(256);
  for (let i = 0; i < 256; i++) box[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + box[i] + key.charCodeAt(i % keyLen)) & 0xff;
    const tmp = box[i];
    box[i] = box[j];
    box[j] = tmp;
  }
  const out = Buffer.allocUnsafe(data.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    x = (x + 1) & 0xff;
    y = (y + box[x]) & 0xff;
    const tmp = box[x];
    box[x] = box[y];
    box[y] = tmp;
    out[i] = data[i] ^ box[(box[x] + box[y]) & 0xff];
  }
  return out;
}

function rc4Hex(data, key) {
  return rc4(Buffer.from(data, 'utf8'), key).toString('hex');
}

function rc4Unhex(hex, key) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    return null;
  }
  return rc4(Buffer.from(hex, 'hex'), key);
}

// Node 内置 TextDecoder 支持 gbk/gb18030（full-icu），无需引入 iconv 依赖。
let gbkDecoder = null;
try {
  gbkDecoder = new TextDecoder('gbk');
} catch {
  gbkDecoder = null;
}

// 微验 msg 是 GBK 字节而非 UTF-8。只有解码后出现替换字符 U+FFFD 才按 GBK 再解一次，
// 避免误伤本来就正常的 UTF-8 文本。
function toUtf8(buf) {
  const text = buf.toString('utf8');
  if (!text.includes('\ufffd')) return text;
  if (gbkDecoder) {
    try {
      return gbkDecoder.decode(buf);
    } catch {
      /* 落到原始文本 */
    }
  }
  return text;
}

const KNOWN_MESSAGES = {
  100: '未绑定应用 ID',
  102: '应用已关闭',
  104: '签名为空',
  105: '数据过期，请重试',
  106: '签名错误',
  107: '数据为空',
  108: '未提交时间变量',
  112: '未提交设备码变量',
  148: '卡密为空',
  149: '卡密不存在',
  150: '卡密已被使用',
  152: '卡密已到期',
  153: '卡密已被禁用',
};

function knownMessage(code) {
  return Object.prototype.hasOwnProperty.call(KNOWN_MESSAGES, code)
    ? KNOWN_MESSAGES[code]
    : null;
}

// 不赌编码：code/time/check 一律用正则从原文提取，JSON 只在能解码时用于取展示字段。
// 200 响应的 msg 是对象且内部可能带 time，故收集全部候选逐一比对。
function parseResponse(body, rc4key) {
  let raw = String(body || '').trim();
  if (raw.startsWith('\ufffd')) raw = raw.slice(1);
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  const plains = [];
  if (raw.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(raw)) {
    const plain = rc4Unhex(raw, rc4key);
    if (plain) plains.push(['hex', plain]);
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length) plains.push(['b64', rc4(b64, rc4key)]);
  }
  plains.push(['raw', Buffer.from(raw, 'utf8')]);

  const diag = [];
  let keep = Buffer.alloc(0);
  for (const [label, plain] of plains) {
    if (keep.length === 0) keep = plain;
    const text = plain.toString('utf8');
    let json = null;
    try {
      const p = JSON.parse(text);
      if (p && typeof p === 'object') json = p;
    } catch {
      try {
        const p = JSON.parse(toUtf8(plain));
        if (p && typeof p === 'object') json = p;
      } catch {
        /* 正则兜底 */
      }
    }

    let code = null;
    if (json && json.code !== undefined) {
      code = parseInt(json.code, 10);
      if (Number.isNaN(code)) code = null;
    } else {
      const m = /"code"\s*:\s*(-?\d+)/.exec(text);
      if (m) code = parseInt(m[1], 10);
    }

    if (code !== null) {
      return {
        code,
        times: [...text.matchAll(/"time"\s*:\s*(\d+)/g)].map((m) => m[1]),
        checks: [...text.matchAll(/"check"\s*:\s*"([0-9a-fA-F]{32})"/g)].map((m) =>
          m[1].toLowerCase(),
        ),
        ids: [...text.matchAll(/"id"\s*:\s*(\d+)/g)].map((m) => m[1]),
        json,
        plain,
        diag: '',
      };
    }
    // 与 PHP json_last_error_msg() 的文案保持一致，避免迁移后用户可见文案变化。
    diag.push(`${label}:Syntax error/len${plain.length}`);
  }

  return {
    code: null,
    times: [],
    checks: [],
    ids: [],
    json: null,
    plain: keep,
    diag: diag.join(' '),
  };
}

// 防篡改 / 防重放 / 防跨卡密搬运。公式按响应分支不同，已用真实响应实测确认：
//   未识别卡密（105/149/150 等）: md5(time + appkey + value)
//   识别成功（200，msg 内含 id）: md5(time + appkey + value + code + id + sign)
// 每个候选都要过 hashEquals，不放宽校验。
function checkIntegrity(parsed, value, sign) {
  if (!WEIYAN_VERIFY_CHECK) return [true, ''];
  if (!parsed.checks.length || !parsed.times.length) {
    return [false, '响应缺少 check/time 字段'];
  }

  const code = String(parsed.code);
  for (const t of parsed.times) {
    const expects = [md5(t + WEIYAN_APPKEY + value)];
    for (const id of parsed.ids) {
      expects.push(md5(t + WEIYAN_APPKEY + value + code + id + sign));
    }
    for (const c of parsed.checks) {
      for (const expect of expects) {
        if (hashEquals(expect, c)) return [true, ''];
      }
    }
  }
  return [false, 'check 不匹配（响应被篡改或重放）'];
}

function normalize(parsed, httpCode) {
  if (parsed.code === null) {
    const safe = parsed.plain
      .toString('utf8')
      .replace(/"(token|sign|check)"\s*:\s*"[^"]*"/g, '"$1":"<hidden>"');
    const tail = safe.replace(/\s+/g, ' ').slice(-100);
    return {
      code: -3,
      ok: false,
      vip: 0,
      ktype: '',
      kmtype: '',
      message: `验证响应解析失败｜HTTP=${httpCode}｜${parsed.diag}｜tail=${tail}`,
    };
  }

  const code = parsed.code;
  const json = parsed.json;
  const nested =
    json && typeof json.msg === 'object' && json.msg !== null ? json.msg : {};

  const pick = (key, def) => {
    if (json && json[key] !== undefined && json[key] !== '') return json[key];
    if (nested[key] !== undefined && nested[key] !== '') return nested[key];
    return def;
  };

  const apiMsg = json && typeof json.msg === 'string' ? json.msg : '';
  const known = knownMessage(code);
  let message;
  if (known !== null) {
    message = known;
  } else if (apiMsg && !apiMsg.includes('\ufffd')) {
    message = apiMsg;
  } else {
    message = `验证失败（错误码 ${code}）`;
  }

  return {
    code,
    ok: true,
    vip: parseInt(pick('vip', 0), 10) || 0,
    ktype: String(pick('ktype', '')),
    kmtype: String(pick('kmtype', '')),
    message,
  };
}

function requestUpstream(endpoint, data) {
  return new Promise((resolve) => {
    const target = new URL(
      `${endpoint}?id=kmlogon&app=${encodeURIComponent(WEIYAN_APPID)}&data=${encodeURIComponent(data)}`,
    );
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.request(
      target,
      {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' },
        // 证书必须校验通过；一旦失败直接报错，不降级到明文。
        rejectUnauthorized: true,
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, target).toString();
          resolve(requestUpstream(next, data));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            status: res.statusCode || 0,
            err: '',
          }),
        );
        res.on('error', (e) =>
          resolve({ body: '', status: res.statusCode || 0, err: e.message }),
        );
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ body: '', status: 0, err: `timeout after ${UPSTREAM_TIMEOUT_MS}ms` });
    });
    req.on('error', (e) => resolve({ body: '', status: 0, err: e.message }));
    req.end();
  });
}

async function weiyanLogin(kami, markcode) {
  if (kami === '' || markcode === '') {
    return { code: 148, ok: true, vip: 0, ktype: '', kmtype: '', message: '卡密为空' };
  }

  const t = Math.floor(Date.now() / 1000);
  const sign = md5(`kami=${kami}&markcode=${markcode}&t=${t}&${WEIYAN_APPKEY}`);
  const value = crypto.randomInt(0, 2764472320);
  const form =
    `kami=${encodeURIComponent(kami)}` +
    `&markcode=${encodeURIComponent(markcode)}` +
    `&t=${t}&sign=${sign}&value=${value}`;
  const data = rc4Hex(form, WEIYAN_RC4KEY);

  const endpoints = [WEIYAN_API];
  if (WEIYAN_ALLOW_HTTP_FALLBACK) {
    // 仅供排查：wy.llua.cn 的 TLS 已实测正常，静默降级会把卡密暴露在链路上。
    endpoints.push(WEIYAN_API.replace(/^https:\/\//, 'http://'));
  }

  let body = '';
  let httpCode = 0;
  let err = '';
  let used = '';
  for (const endpoint of endpoints) {
    const r = await requestUpstream(endpoint, data);
    body = r.body;
    httpCode = r.status;
    err = r.err;
    used = endpoint;
    if (body.trim() !== '') break;
  }

  const trimmed = body.trim();
  if (trimmed === '') {
    // 卡密不写入日志；此处只记录端点与传输层故障。
    console.error(
      `weiyan_login transport failure endpoint=${used} http=${httpCode} curl=${err} fallback_allowed=${WEIYAN_ALLOW_HTTP_FALLBACK ? 'yes' : 'no'}`,
    );
    return {
      code: -2,
      ok: false,
      vip: 0,
      ktype: '',
      kmtype: '',
      message: `验证服务器无响应（${used} HTTP ${httpCode} curl=${err}）`,
    };
  }

  const parsed = parseResponse(trimmed, WEIYAN_RC4KEY);

  // 解析失败时交给 normalize 输出原有诊断，不在此处掩盖。
  if (parsed.code !== null) {
    const [checkOk, checkErr] = checkIntegrity(parsed, String(value), sign);
    if (!checkOk) {
      const dump = parsed.plain
        .toString('utf8')
        .replace(/"kami"\s*:\s*"[^"]*"/g, '"kami":"*"')
        .replace(/\s+/g, ' ');
      console.error(
        `weiyan integrity failure code=${parsed.code} err=${checkErr} payload=${dump.slice(0, 160)}`,
      );
      return {
        code: -1,
        ok: false,
        vip: 0,
        ktype: '',
        kmtype: '',
        message: `卡密响应校验失败：${checkErr}（code=${parsed.code} p=${dump.slice(0, 120)}）`,
      };
    }
  }

  return normalize(parsed, httpCode);
}

function guardSlots() {
  let dir = FC_CACHE_DIR;
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    } catch {
      /* 落到不可用分支 */
    }
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    // 缓存不可用时退化为不缓存/不限流，不影响功能正确性。
    // 但限流属于安全控制，不能无声消失：必须留痕。
    console.error(
      `GUARD DISABLED: cache dir unavailable dir=${dir} -- rate limit and license cache are both OFF`,
    );
    return '';
  }
  return dir;
}

function guardIp(req) {
  const raw = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
  return raw.replace(/[^0-9a-zA-Z.:_-]/g, '');
}

function bumpCounter(file, win) {
  const dir = guardSlots();
  if (dir === '') return { allowed: true, n: 0 };
  const target = path.join(dir, file);
  let n = 0;
  try {
    const row = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (row.w === win) n = row.n;
  } catch {
    /* 新窗口 */
  }
  n += 1;
  try {
    fs.writeFileSync(target, JSON.stringify({ w: win, n }));
  } catch {
    /* 写失败不阻断 */
  }
  return { allowed: true, n, target };
}

function guardRateLimit(req) {
  const dir = guardSlots();
  if (dir === '') return;
  const ip = guardIp(req);
  const win = Math.floor(Date.now() / 60000);
  const { n } = bumpCounter(`r${md5(ip)}.json`, win);
  if (n > FC_RATE_MAX) {
    console.error(`rate limit ip=${ip} n=${n}`);
    return '请求过于频繁，请稍后再试';
  }
}

function guardDistinctCards(req, card) {
  const dir = guardSlots();
  if (dir === '' || !card) return null;
  const ip = guardIp(req);
  const win = Math.floor(Date.now() / 60000);
  const target = path.join(dir, `c${md5(ip)}.json`);
  let set = {};
  try {
    const row = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (row.w === win && row.s && typeof row.s === 'object') set = row.s;
  } catch {
    /* 新窗口 */
  }
  // 用哈希存指纹，避免卡密明文落到 /tmp 或日志里。
  set[crypto.createHash('sha256').update(card).digest('hex').slice(0, 16)] = 1;
  const count = Object.keys(set).length;
  try {
    fs.writeFileSync(target, JSON.stringify({ w: win, s: set }));
  } catch {
    /* 写失败不阻断 */
  }
  if (count > FC_RATE_DISTINCT) {
    console.error(`distinct card limit ip=${ip} n=${count}`);
    return '尝试的卡密过多，请稍后再试';
  }
  return null;
}

function licenseCachePath(kami, markcode) {
  const dir = guardSlots();
  if (dir === '') return '';
  // 卡密与设备码都只以哈希形式落盘。
  return path.join(dir, `L${md5(`${markcode}|${kami}`)}.json`);
}

function requireLicense(req) {
  const kami = req.params.card || '';
  const markcode = req.params.markcode || '';
  if (kami === '' || markcode === '') {
    return { error: [402, '卡密为空'] };
  }

  const limited = guardRateLimit(req);
  if (limited) return { error: [429, limited] };

  const cachePath = WEIYAN_VERIFY_TTL > 0 ? licenseCachePath(kami, markcode) : '';
  if (cachePath !== '') {
    try {
      const row = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      // 缓存只对校验成功的结果生效，且仍在 vip 有效期内才复用。
      if (
        row.vip !== undefined &&
        row.at !== undefined &&
        Date.now() / 1000 - row.at <= WEIYAN_VERIFY_TTL &&
        row.vip > Date.now() / 1000
      ) {
        return {
          result: {
            code: WEIYAN_OK_CODE,
            ok: true,
            vip: row.vip,
            ktype: row.ktype || '',
            kmtype: row.kmtype || '',
          },
        };
      }
    } catch {
      /* 无缓存，继续校验 */
    }
  }

  const tooMany = guardDistinctCards(req, kami);
  if (tooMany) return { error: [429, tooMany] };

  return { pending: [kami, markcode, cachePath] };
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function reply(res, status, contentType, payload) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(payload);
}

const fail = (res, code, message) => reply(res, code, 'text/plain; charset=utf-8', message);
const jsonOut = (res, code, obj) =>
  reply(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

async function handle(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  const raw = await readBody(req);
  if (!raw) return fail(res, 400, '缺少加密参数');

  let form;
  try {
    form = new URLSearchParams(raw);
  } catch {
    return fail(res, 400, '参数格式错误');
  }

  const envelope = form.get('d') || '';
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== '1') {
    return fail(res, 400, '参数格式错误');
  }

  const [, ivB64, cipherB64, tag] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const cipher = Buffer.from(cipherB64, 'base64');
  if (iv.length !== 16) return fail(res, 400, '参数格式错误');

  const expected = crypto
    .createHmac('sha256', MAC_KEY)
    .update(`${ivB64}|${cipherB64}`, 'utf8')
    .digest('hex');
  if (!hashEquals(expected, tag)) return fail(res, 403, '参数校验失败');

  let plain;
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENC_KEY, iv);
    plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
  } catch {
    return fail(res, 400, '解密失败');
  }

  let data;
  try {
    data = JSON.parse(plain.toString('utf8'));
  } catch {
    return fail(res, 400, '解密失败');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.p)) {
    return fail(res, 400, '解密失败');
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(data.t)) > PAYLOAD_MAX_AGE) {
    return fail(res, 403, '参数已过期');
  }

  const params = {};
  for (const [k, v] of Object.entries(data.p)) {
    if (typeof k === 'string' && ['string', 'number', 'boolean'].includes(typeof v)) {
      params[k] = String(v);
    }
  }
  req.params = params;

  if (pathname === '/login') {
    const gate = requireLicense(req);
    if (gate.error) return fail(res, gate.error[0], gate.error[1]);
    if (!gate.pending) {
      return jsonOut(res, 200, {
        ok: true,
        vip: gate.result.vip,
        ktype: gate.result.ktype,
        kmtype: gate.result.kmtype,
      });
    }

    const [kami, markcode, cachePath] = gate.pending;
    const result = await weiyanLogin(kami, markcode);
    if (!result.ok) return fail(res, 424, result.message);
    if (Number(result.code) !== WEIYAN_OK_CODE) return fail(res, 402, result.message);

    if (cachePath !== '' && result.vip > Date.now() / 1000) {
      try {
        fs.writeFileSync(
          cachePath,
          JSON.stringify({
            vip: result.vip,
            ktype: result.ktype,
            kmtype: result.kmtype,
            at: Math.floor(Date.now() / 1000),
          }),
        );
      } catch {
        /* 缓存失败不影响本次校验结果 */
      }
    }
    delete req.params.card;
    delete req.params.markcode;
    return jsonOut(res, 200, {
      ok: true,
      vip: result.vip,
      ktype: result.ktype,
      kmtype: result.kmtype,
    });
  }

  const gate = requireLicense(req);
  if (gate.error) return fail(res, gate.error[0], gate.error[1]);
  if (!gate.pending) return null; // 命中缓存，鉴权通过

  const [kami, markcode] = gate.pending;
  const result = await weiyanLogin(kami, markcode);
  if (!result.ok) return fail(res, 424, result.message);
  if (Number(result.code) !== WEIYAN_OK_CODE) return fail(res, 402, result.message);

  // qbjzh.php 与 qbjlm.php 已删除，查询后端不再提供。
  return fail(res, 410, '查询接口已下线');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('unhandled', e && e.stack ? e.stack : e);
    try {
      fail(res, 500, '服务器内部错误');
    } catch {
      /* 响应已发出 */
    }
  });
});

// 函数计算需要监听 PORT 环境变量指定的端口。
// 仅在直接运行时监听；被 require 时只导出函数，便于与 PHP 版做逐字节差分测试。
module.exports = {
  handle,
  rc4,
  rc4Hex,
  rc4Unhex,
  parseResponse,
  checkIntegrity,
  normalize,
  md5,
  toUtf8,
  knownMessage,
  ENC_KEY,
  MAC_KEY,
  PAYLOAD_SECRET,
  WEIYAN_APPKEY,
  WEIYAN_RC4KEY,
};

if (require.main === module) {
  const PORT = envInt('FC_PORT', envInt('PORT', 9000));
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`listening on ${PORT}`);
  });
}
