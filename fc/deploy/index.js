// Node.js 迁移版 router：保留现有加密、鉴权、限流、缓存逻辑
// 自定义运行时 custom.debian9 自带的 Node 版本较老，不支持 'node:' 前缀
// （需 Node 14+）。因此这里使用不带前缀的内置模块名，两种运行时都能加载。
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

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

// 查询上游：词缀库。key 只存在于服务端，App 不持有也不再下发。
//
// 临时降级为明文 HTTP：czsgk.dpdns.org 的证书 CN 是 cxtx.xyz，altnames 只有
// cxtx.xyz 与 www.cxtx.xyz，不含该主机名，直接走 HTTPS 会以
// ERR_TLS_CERT_ALTNAME_INVALID 失败。等上游为该域名补好证书后，把下面默认值
// 改成 https:// 即可恢复加密，协议分支已经同时支持 http 与 https，无需再改逻辑。
// 明文期间 key 与被查关键词/姓名在链路上可见，这是当前已知的代价。
//
// 路径必须是纯 ASCII：http.request 遇到非 ASCII 路径会抛 ERR_UNESCAPED_CHARACTERS，
// 自定义 FC_CIZHUI_ROOT 时需自行百分号编码。
const CIZHUI_ROOT = envStr('FC_CIZHUI_ROOT', 'http://czsgk.dpdns.org/');
const CIZHUI_KEY = envStr('FC_CIZHUI_KEY', 'cznb666');
const CIZHUI_TIMEOUT_MS = envInt('FC_CIZHUI_TIMEOUT_MS', 25000);
const CIZHUI_MAX_REDIRECTS = envInt('FC_CIZHUI_MAX_REDIRECTS', 3);
// 上游命中记录可能很大，留 4MB 上限防止极端响应拖垮实例内存。
const CIZHUI_MAX_BODY = envInt('FC_CIZHUI_MAX_BODY', 4 * 1024 * 1024);

// 入参白名单与长度上限。cx 是综合查询的关键字，其余为猎魔的姓名/地区。
const CX_MAX_LEN = 500;
const XM_MAX_LEN = 64;
const DQ_MAX_LEN = 64;

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

// 微验 msg 是 GBK 字节，需要 gbk 解码能力。
// 全局 TextDecoder 需 Node 11+，util.TextDecoder 需 Node 8.3+，且 gbk 编码
// 依赖 full-icu。老运行时任一条件不满足时降级为不解码（仅影响错误文案可读性）。
let gbkDecoder = null;
try {
  // eslint-disable-next-line no-undef
  const TD = typeof TextDecoder !== 'undefined' ? TextDecoder : require('util').TextDecoder;
  gbkDecoder = new TD('gbk');
} catch (e) {
  gbkDecoder = null;
  console.warn('GBK decoder unavailable, 微验错误文案可能乱码:', e && e.message ? e.message : e);
}

// 微验 msg 是 GBK 字节而非 UTF-8。只有解码后出现替换字符 U+FFFD 才按 GBK 再解一次，
// 避免误伤本来就正常的 UTF-8 文本。
function toUtf8(buf) {
  const text = buf.toString('utf8');
  if (!text.includes('\ufffd')) return text;
  if (gbkDecoder) {
    try {
      return gbkDecoder.decode(buf);
    } catch (e) {
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
    } catch (e) {
      try {
        const p = JSON.parse(toUtf8(plain));
        if (p && typeof p === 'object') json = p;
      } catch (e) {
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
      // 用 exec 循环而非 matchAll：matchAll 需要 Node 12+，
      // custom.debian9 自带的 Node 版本更老。
      const collect = (re) => {
        const out = [];
        const rx = new RegExp(re.source, re.flags);
        let m = rx.exec(text);
        while (m !== null) {
          out.push(m[1]);
          m = rx.exec(text);
        }
        return out;
      };
      return {
        code,
        times: collect(/"time"\s*:\s*(\d+)/g),
        checks: collect(/"check"\s*:\s*"([0-9a-fA-F]{32})"/g).map((s) => s.toLowerCase()),
        ids: collect(/"id"\s*:\s*(\d+)/g),
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

// 全局 URL / URLSearchParams 需 Node 10+；老运行时从 url 模块取。
const urlMod = require('url');
const URLImpl = typeof URL !== 'undefined' ? URL : urlMod.URL;
const SearchParamsImpl = typeof URLSearchParams !== 'undefined' ? URLSearchParams : urlMod.URLSearchParams;

function requestUpstream(endpoint, data) {
  return new Promise((resolve) => {
    const target = new URLImpl(
      `${endpoint}?id=kmlogon&app=${encodeURIComponent(WEIYAN_APPID)}&data=${encodeURIComponent(data)}`,
    );
    const lib = target.protocol === 'http:' ? http : https;
    // 不能把 URL 实例直接传入：Node 8/9 的 http.request(url, options, cb)
    // 不支持该签名。这里展开成单个 options 对象，各版本均可接受。
    const targetOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' },
      // 证书必须校验通过；一旦失败直接报错，不降级到明文。
      rejectUnauthorized: true,
      timeout: UPSTREAM_TIMEOUT_MS,
    };
    const req = lib.request(targetOptions, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URLImpl(res.headers.location, target).toString();
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

// 上游 5xx 时把它的诊断信息透出来，否则 App 只会看到「上游返回 502」，
// 分不清是对方数据源挂了还是我方故障。只取短文本：完整响应可能很大，
// 直接回传既冗长，也会把上游内部细节泄露给终端用户。
function upstreamDiag(body, fallback) {
  const raw = String(body || '').trim();
  if (raw === '') return fallback;

  const parts = [];
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') {
      if (typeof j.message === 'string' && j.message !== '') parts.push(j.message);
      if (typeof j.error === 'string' && j.error !== '') parts.push(j.error);
    }
  } catch (e) {
    /* 不是 JSON，落到下面的纯文本截断 */
  }

  const text = (parts.length ? parts.join('｜') : raw).replace(/\s+/g, ' ').trim();
  if (text === '') return fallback;
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

// 查询串手工拼，不依赖 URLSearchParams 的编码细节，
// 这样与 PHP 版可以逐字节对拍出同一个 URL。
function buildCizhuiUrl(name, params) {
  const base = /\/$/.test(CIZHUI_ROOT) ? CIZHUI_ROOT : `${CIZHUI_ROOT}/`;
  const qs = [];
  for (const key of Object.keys(params)) {
    qs.push(`${key}=${encodeURIComponent(params[key])}`);
  }
  qs.push(`key=${encodeURIComponent(CIZHUI_KEY)}`);
  return `${base}${name}?${qs.join('&')}`;
}

// 转发查询到词缀库。每跳都重新校验协议，只允许 http/https，
// 避免上游用 302 把请求引到 file: 之类的协议或内网地址上。
function requestCizhui(target, redirectsLeft) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URLImpl(target);
    } catch (e) {
      resolve({ ok: false, status: 0, body: '', err: '上游地址无效' });
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      resolve({ ok: false, status: 0, body: '', err: '上游仅允许 http/https' });
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    // http.request 遇到非 ASCII 路径会抛 ERR_UNESCAPED_CHARACTERS，
    // 提前拦下来给出可读原因。
    if (/[^\x20-\x7e]/.test(`${parsed.pathname}${parsed.search}`)) {
      resolve({ ok: false, status: 0, body: '', err: '上游路径含未编码字符' });
      return;
    }

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'text/plain, */*',
          Referer: `${parsed.protocol}//${parsed.host}/`,
        },
        // 走 https 时证书必须校验通过；当前默认明文，此项在切回 https 后才起作用。
        rejectUnauthorized: true,
        timeout: CIZHUI_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            resolve({ ok: false, status, body: '', err: '重定向次数过多' });
            return;
          }
          let next;
          try {
            next = new URLImpl(res.headers.location, parsed).toString();
          } catch (e) {
            resolve({ ok: false, status, body: '', err: '重定向地址无效' });
            return;
          }
          resolve(requestCizhui(next, redirectsLeft - 1));
          return;
        }

        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > CIZHUI_MAX_BODY) {
            req.destroy();
            resolve({ ok: false, status, body: '', err: '上游响应过大' });
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({ ok: true, status, body: Buffer.concat(chunks).toString('utf8'), err: '' }),
        );
        res.on('error', (e) => resolve({ ok: false, status, body: '', err: e.message }));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, body: '', err: `上游超时 ${CIZHUI_TIMEOUT_MS}ms` });
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, body: '', err: e.message }));
    req.end();
  });
}

async function weiyanLogin(kami, markcode) {
  if (kami === '' || markcode === '') {
    return { code: 148, ok: true, vip: 0, ktype: '', kmtype: '', message: '卡密为空' };
  }

  const t = Math.floor(Date.now() / 1000);
  const sign = md5(`kami=${kami}&markcode=${markcode}&t=${t}&${WEIYAN_APPKEY}`);
  // randomInt 需 Node 14.2+；老运行时用无模偏置的随机字节取模。
  const value =
    typeof crypto.randomInt === 'function'
      ? crypto.randomInt(0, 2764472320)
      : crypto.randomBytes(4).readUInt32BE(0) % 2764472320;
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
    } catch (e) {
      /* 落到不可用分支 */
    }
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (e) {
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
  // 与 PHP 版 REMOTE_ADDR 的口径一致：只信平台给出的来源 IP。
  // x-forwarded-for 客户端可伪造，若采信则限流可被绕过。
  const raw = clientIp(req).split(',')[0].trim();
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
  } catch (e) {
    /* 新窗口 */
  }
  n += 1;
  try {
    fs.writeFileSync(target, JSON.stringify({ w: win, n }));
  } catch (e) {
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
  } catch (e) {
    /* 新窗口 */
  }
  // 用哈希存指纹，避免卡密明文落到 /tmp 或日志里。
  set[crypto.createHash('sha256').update(card).digest('hex').slice(0, 16)] = 1;
  const count = Object.keys(set).length;
  try {
    fs.writeFileSync(target, JSON.stringify({ w: win, s: set }));
  } catch (e) {
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
    } catch (e) {
      /* 无缓存，继续校验 */
    }
  }

  const tooMany = guardDistinctCards(req, kami);
  if (tooMany) return { error: [429, tooMany] };

  return { pending: [kami, markcode, cachePath] };
}

// /login 与查询路由共用：命中缓存就直接放行，未命中才回调威言校验一次。
async function resolveLicense(req) {
  const gate = requireLicense(req);
  if (gate.error) return { error: gate.error };
  if (!gate.pending) return { result: gate.result };

  const [kami, markcode, cachePath] = gate.pending;
  const result = await weiyanLogin(kami, markcode);
  if (!result.ok) return { error: [424, result.message] };
  if (Number(result.code) !== WEIYAN_OK_CODE) return { error: [402, result.message] };

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
    } catch (e) {
      /* 缓存失败不影响本次校验结果 */
    }
  }
  return { result };
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body)) {
        resolve(req.body.toString('utf8'));
        return;
      }
      if (typeof req.body === 'string') {
        resolve(req.body);
        return;
      }
      resolve(JSON.stringify(req.body));
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

// 函数计算有两种运行时会共用同一个入口：
//   1) 内置 Node.js 运行时 -> resp.setStatusCode()/setHeader()/send()
//   2) 自定义运行时        -> 标准 http.ServerResponse.writeHead()/end()
// 这里同时兼容两种响应对象，避免因运行时切换而 500。
function reply(res, status, contentType, payload) {
  const body = typeof payload === 'string' ? payload : String(payload);
  if (typeof res.send === 'function') {
    res.setStatusCode(status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
    return;
  }
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

const fail = (res, code, message) => reply(res, code, 'text/plain; charset=utf-8', message);
const jsonOut = (res, code, obj) =>
  reply(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

// 内置运行时提供 request.path / request.method / request.body / request.clientIP；
// 自定义运行时提供标准 IncomingMessage。统一成一份取值逻辑。
function requestPath(req) {
  if (typeof req.path === 'string' && req.path !== '') return req.path;
  return url.parse(req.url || '/', true).pathname || '/';
}

// 函数计算把真实来源 IP 放在 clientIP（内置运行时）或 socket（自定义运行时）里。
// 不信任客户端可伪造的 x-forwarded-for。
function clientIp(req) {
  if (typeof req.clientIP === 'string' && req.clientIP !== '') return req.clientIP;
  const sock = req.socket || (req.connection || null);
  const addr = sock && sock.remoteAddress;
  return typeof addr === 'string' && addr !== '' ? addr : 'unknown';
}

async function handle(req, res) {
  const pathname = requestPath(req);

  const raw = await readBody(req);
  if (!raw) return fail(res, 400, '缺少加密参数');

  let form;
  try {
    form = new SearchParamsImpl(raw);
  } catch (e) {
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
  } catch (e) {
    return fail(res, 400, '解密失败');
  }

  let data;
  try {
    data = JSON.parse(plain.toString('utf8'));
  } catch (e) {
    return fail(res, 400, '解密失败');
  }
  // p 必须是普通对象（App 发送的是 {card, markcode}），
  // 不能是数组/null，否则后续参数取值会得到错误结果。
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail(res, 400, '解密失败');
  }
  if (!data.p || typeof data.p !== 'object' || Array.isArray(data.p)) {
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
    const lic = await resolveLicense(req);
    if (lic.error) return fail(res, lic.error[0], lic.error[1]);
    delete req.params.card;
    delete req.params.markcode;
    return jsonOut(res, 200, {
      ok: true,
      vip: lic.result.vip,
      ktype: lic.result.ktype,
      kmtype: lic.result.kmtype,
    });
  }

  // 查询路由：综合查询与猎魔。
  // App 侧调用路径仍是 /czsgk.php 与 /czlm.php，保持不变——改名会让已安装的旧版本
  // 直接 404；只有转发给上游的文件名换成了 zhcx.php / lm.php。
  // 先按白名单校验入参，再校验卡密，最后才转发；
  // 转发时只拼白名单里的字段，card/markcode 不会带给上游。
  if (pathname === '/czsgk.php' || pathname === '/czlm.php') {
    const cx = String(req.params.cx || '').trim();
    const xm = String(req.params.xm || '').trim();
    const dq = String(req.params.dq || '').trim();

    if (pathname === '/czsgk.php') {
      if (cx === '') return fail(res, 400, '缺少cx参数');
      if (cx.length > CX_MAX_LEN) return fail(res, 400, `cx长度不能超过${CX_MAX_LEN}`);
    } else {
      // dq 可空，空或省略都按「地区筛选：不限」处理。
      if (xm === '') return fail(res, 400, '缺少xm参数');
      if (xm.length > XM_MAX_LEN) return fail(res, 400, `xm长度不能超过${XM_MAX_LEN}`);
      if (dq.length > DQ_MAX_LEN) return fail(res, 400, `dq长度不能超过${DQ_MAX_LEN}`);
    }

    const lic = await resolveLicense(req);
    if (lic.error) return fail(res, lic.error[0], lic.error[1]);

    const target =
      pathname === '/czsgk.php'
        ? buildCizhuiUrl('zhcx.php', { cx })
        : buildCizhuiUrl('lm.php', { xm, dq });

    const upstream = await requestCizhui(target, CIZHUI_MAX_REDIRECTS);
    if (!upstream.ok) return fail(res, 502, `上游请求失败：${upstream.err}`);
    // 上游明确拒绝查询时原样透传，App 侧不重试；
    // 其余非 2xx 一律按网关故障处理，App 侧可重试。
    if (upstream.status === 400 || upstream.status === 403) {
      return fail(res, upstream.status, upstream.body || '上游拒绝查询');
    }
    if (upstream.status < 200 || upstream.status >= 300) {
      return fail(res, 502, `上游返回 ${upstream.status}｜${upstreamDiag(upstream.body, '无响应内容')}`);
    }
    return reply(res, 200, 'text/plain; charset=utf-8', upstream.body);
  }

  return fail(res, 404, '接口不存在');
}


// 仅在使用自定义运行时（自己起 HTTP Server）时才需要监听。
const server = http.createServer(handler);

// 函数计算 Node.js 内置运行时的入口方法名必须是 handler（配置为 index.handler）。
// 第三个参数 context 在内置运行时是运行上下文，自定义运行时不存在，均不使用。
async function handler(req, res) {
  try {
    await handle(req, res);
  } catch (e) {
    console.error('unhandled', e && e.stack ? e.stack : e);
    try {
      fail(res, 500, '服务器内部错误');
    } catch (e) {
      /* 响应已发出 */
    }
  }
}

// 其余成员供与 PHP 版做逐字节差分测试时 require 使用。
module.exports = {
  handler,
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
  buildCizhuiUrl,
  upstreamDiag,
  requestCizhui,
  ENC_KEY,
  MAC_KEY,
  PAYLOAD_SECRET,
  WEIYAN_APPKEY,
  WEIYAN_RC4KEY,
  CIZHUI_ROOT,
  CIZHUI_KEY,
};

// 仅在使用自定义运行时（自己起 HTTP Server）时生效；
// 使用内置 Node.js 运行时则由平台调用 module.exports.handler。
if (require.main === module) {
  // 自定义运行时会注入 PORT；CAPort 是控制台的监听端口配置。
  const PORT = envInt('CAPort', envInt('FC_PORT', envInt('PORT', 9000)));
  // 函数计算要求监听 0.0.0.0，写 127.0.0.1 会导致健康检查失败。
  // 超时设为 0：单次请求可能长达 15 秒（上游超时），不能被 Server 默认值截断。
  server.timeout = 0;
  server.keepAliveTimeout = 0;
  server.headersTimeout = 0;
  server.requestTimeout = 0;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`listening on ${PORT}`);
  });
}
