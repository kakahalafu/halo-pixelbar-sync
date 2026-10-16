// 花再 Halo PixelBar 歌词同步 —— Folia (Folium) 模组 main 入口
// 运行在 Electron 主进程，轮询 api.runtime.getPlaybackSnapshot() 读取播放状态与歌词，
// 经 USB HID（node-hid）把当前歌词行推送到像素屏。
// HID 协议移植自 HaloLyricSync（参考 HaloPixelToolBox, https://github.com/XFEstudio/HaloPixelToolBox）。

'use strict';

const path = require('path');

// ---------------- 可调参数 ----------------
const POLL_MS = 250;                 // 快照轮询间隔
const SONG_INFO_DURATION_S = 3;      // 切歌时显示"歌名 - 歌手"的时长
const NO_LYRICS_TIMEOUT_S = 30;      // 无歌词多久后切到时钟 UI
const MAX_CHARS = 20;                // 单行最大显示宽度（CJK 记 2）
const COLOR = 0;                     // 0=白 1=红 2=绿 3=蓝 4=黄 5=青 6=品红

// ---------------- HID 协议 ----------------
const PACKET_LEN = 64;
const MAGIC_TEXT = [0x2E, 0xAA, 0xEC, 0xE8];
const MAGIC_CTRL = [0x2E, 0xAA, 0xEC, 0xEF];
const LAYOUT_HEADER = Buffer.from([...MAGIC_CTRL, 0x00, 0x09, 0x01, 0xF0, 0xB4, 0xC8, 0x00, 0x02, 0x00]);
const UI_HEADER = Buffer.from([...MAGIC_CTRL, 0x00, 0x09, 0x02, 0xF0, 0xB4, 0xC8, 0x00, 0x01]);
const CLOCK_UI = Buffer.from([0x00, 0xFF, 0xFF, 0xFB, 0x00]);
const WRITE_TEST_PKT = Buffer.concat([Buffer.from([...MAGIC_TEXT, 0x00, 0x06, 0x00, 0x04]), Buffer.alloc(PACKET_LEN - 8)]);

// 布局字节：[模式ID, 0xFF, 校验相关, 0x00]
const LAYOUT_CENTER = Buffer.from([0x01, 0xFF, 0xFD, 0x00]);
const LAYOUT_SCROLL_RTL = Buffer.from([0x01, 0xFF, 0xFE, 0x00]);

function checksum(textBytes) {
  let acc = 128;
  for (const b of textBytes) acc += b + 2;
  return acc % 256;
}

function padPacket(p) {
  if (p.length >= PACKET_LEN) return p.subarray(0, PACKET_LEN);
  return Buffer.concat([p, Buffer.alloc(PACKET_LEN - p.length)]);
}

function buildTextPacket(text, color = COLOR) {
  const t = Buffer.from(text, 'utf8');
  const p = Buffer.alloc(8 + t.length + 1);
  p[0] = MAGIC_TEXT[0]; p[1] = MAGIC_TEXT[1]; p[2] = MAGIC_TEXT[2]; p[3] = MAGIC_TEXT[3];
  p[4] = color;
  p.writeUInt16LE(1 + t.length + 1, 5); // 总长度 = 文本长度字节 + 文本 + 校验和
  p[7] = t.length;
  t.copy(p, 8);
  p[8 + t.length] = checksum(t);
  return padPacket(p);
}

function buildLayoutPacket(layoutBytes) {
  return padPacket(Buffer.concat([LAYOUT_HEADER, layoutBytes]));
}

function buildClockPacket() {
  return padPacket(Buffer.concat([UI_HEADER, CLOCK_UI]));
}

// CJK 字符按 2 列宽截断，避免中文 3 字节/字符导致 HID 超限
function displayWidth(s) {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    w += (cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd))) ? 2 : 1;
  }
  return w;
}

function truncateByWidth(text) {
  let s = text;
  while (displayWidth(s) > MAX_CHARS && s.length > 0) s = s.slice(0, -1);
  return s;
}

// ---------------- 设备 ----------------
const DEVICE_KEYWORDS = ['halo', 'pixel', '花再', 'pixelbar'];

function openDevice(HID, log) {
  let cands = [];
  try {
    cands = HID.devices().filter(d => {
      const name = String(d.product || '').toLowerCase();
      return DEVICE_KEYWORDS.some(k => name.includes(k));
    });
  } catch (e) {
    log.error('HID 枚举失败: ' + e.message);
    return null;
  }
  for (const c of cands) {
    let dev = null;
    try {
      dev = new HID.HID(c.path);
      if (dev.write(Array.from(WRITE_TEST_PKT)) >= 0) {
        log.info(`已连接 Halo PixelBar: ${c.product}`);
        return dev;
      }
    } catch (e) {
      // 该接口不可写（MI_03/Col01 会报 WriteFile 0x01），继续试下一个
    }
    try { if (dev) dev.close(); } catch (e) { /* ignore */ }
  }
  return null;
}

// ---------------- 歌词行定位 ----------------
// 取"最后一个 startTime <= position 且 position 未超过其显示结束时间"的行
function currentLine(lines, position) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  let best = null;
  for (const l of lines) {
    if (typeof l.startTime !== 'number' || l.startTime > position) break;
    best = l;
  }
  if (!best) return null;
  const end = Number.isFinite(best.renderHints && best.renderHints.renderEndTime)
    ? best.renderHints.renderEndTime : best.endTime;
  return position <= end + 0.5 ? best : null;
}

// ---------------- 入口 ----------------
module.exports = function activate(api) {
  let HID;
  try {
    // 第三方库以 vendor/ 目录随模组分发（模组市场收录时会剔除 node_modules）。
    // vendor/node-hid/nodehid.js 含一行本地补丁：裸引用 pkg-prebuilds 改为相对路径，见该文件内注释。
    HID = require(path.join(__dirname, 'vendor', 'node-hid'));
  } catch (e) {
    try {
      HID = require(path.join(__dirname, 'node_modules', 'node-hid')); // 开发布局回退
    } catch (e2) {
      api.log.error('node-hid 加载失败，模组不工作: ' + e2.message);
      return;
    }
  }

  if (!api.host || !api.host.folium || api.host.folium.major < 1 || api.host.folium.minor < 4) {
    api.log.warn(`Folium 版本过低（需要 1.4 的 runtime.playback），当前 ${api.host && api.host.folium && api.host.folium.major}.${api.host && api.host.folium && api.host.folium.minor}`);
    return;
  }

  let dev = null;
  let lastSongKey = '';
  let lastText = '';
  let transitionUntil = 0;
  let clockShown = false;
  let scrollMode = false;
  let noLyricsMs = 0;
  let reconnectAt = 0;

  const log = {
    info: (m) => api.log.info(m),
    error: (m) => api.log.error(m),
  };

  function ensureDevice() {
    if (dev) return true;
    const now = Date.now();
    if (now < reconnectAt) return false;
    reconnectAt = now + 5000; // 5 秒重试一次，避免刷屏
    dev = openDevice(HID, log);
    return Boolean(dev);
  }

  function send(packet) {
    if (!ensureDevice()) return false;
    try {
      dev.write(Array.from(packet));
      return true;
    } catch (e) {
      // 设备拔出/被占用：关闭并稍后重连
      try { dev.close(); } catch (e2) { /* ignore */ }
      dev = null;
      return false;
    }
  }

  function sendText(text) {
    if (displayWidth(text) > 15) {
      if (!scrollMode) { send(buildLayoutPacket(LAYOUT_SCROLL_RTL)); scrollMode = true; }
    } else if (scrollMode) {
      send(buildLayoutPacket(LAYOUT_CENTER));
      scrollMode = false;
    }
    send(buildTextPacket(text));
  }

  function tick() {
    let snap = null;
    try {
      snap = api.runtime.getPlaybackSnapshot();
    } catch (e) {
      if (String(e.message).startsWith('permission-denied')) {
        api.log.error('缺少 runtime.playback 权限，请在 mod.json 中声明后重新启用模组');
        clearInterval(timer);
      }
      return;
    }
    if (!snap || !snap.song) {
      if (ensureDevice()) {
        noLyricsMs += POLL_MS;
        if (!clockShown && noLyricsMs >= NO_LYRICS_TIMEOUT_S * 1000) {
          send(buildClockPacket());
          clockShown = true;
        }
      }
      return;
    }

    const songKey = snap.song.ref || `${snap.song.title}::${snap.song.artist}`;

    // 切歌：显示歌名 - 歌手，进入过渡期
    if (songKey !== lastSongKey) {
      lastSongKey = songKey;
      lastText = '';
      noLyricsMs = 0;
      clockShown = false;
      transitionUntil = Date.now() + SONG_INFO_DURATION_S * 1000;
      const info = `${snap.song.title}${snap.song.artist ? ' - ' + snap.song.artist : ''}`;
      sendText(truncateByWidth(info));
      return;
    }

    // 过渡期内不刷歌词
    if (Date.now() < transitionUntil) return;

    // 停止/暂停：暂停时快照进度冻结，保持当前显示即可
    if (snap.state === 'stopped') {
      noLyricsMs += POLL_MS;
      if (!clockShown && noLyricsMs >= NO_LYRICS_TIMEOUT_S * 1000) {
        send(buildClockPacket());
        clockShown = true;
      }
      return;
    }

    const line = currentLine(snap.lines, snap.position);
    const text = line ? String(line.fullText || '').trim() : '';
    if (!text) {
      noLyricsMs += POLL_MS;
      if (!clockShown && noLyricsMs >= NO_LYRICS_TIMEOUT_S * 1000) {
        send(buildClockPacket());
        clockShown = true;
      }
      return;
    }
    noLyricsMs = 0;
    clockShown = false;

    const shown = truncateByWidth(text);
    if (shown === lastText) return; // 去重：同文本不重复发送
    lastText = shown;
    sendText(shown);
  }

  api.log.info(`halo-pixelbar-sync ${api.manifest.version} 已启动（folium ${api.host.folium.major}.${api.host.folium.minor}）`);
  const timer = setInterval(() => {
    try { tick(); } catch (e) { api.log.error('同步循环异常: ' + e.message); }
  }, POLL_MS);

  api.lifecycle.onDeactivate(() => {
    clearInterval(timer);
    if (dev) {
      try { send(buildTextPacket(' ')); dev.close(); } catch (e) { /* ignore */ }
      dev = null;
    }
    api.log.info('halo-pixelbar-sync 已停止');
  });
};
