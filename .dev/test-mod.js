// 开发用：模拟播放数据驱动模组 main 入口，验证 vendor/node-hid 布局与真机同步流程
const path = require('path');
const activate = require('../index.cjs');

const lines = [
  { startTime: 0.5, endTime: 3.5, fullText: '第一行测试歌词', renderHints: { renderEndTime: 4.0 } },
  { startTime: 4.0, endTime: 7.0, fullText: '第二行是更长的测试歌词用来触发滚动显示', renderHints: { renderEndTime: 7.5 } },
  { startTime: 7.5, endTime: 10.5, fullText: '第三行收工', renderHints: { renderEndTime: 11.0 } },
  { startTime: 11.0, endTime: 14.0, fullText: '第四行拜拜', renderHints: { renderEndTime: 14.5 } },
];

const t0 = Date.now();
let disposer = null;

const api = {
  manifest: { version: 'dev-test' },
  host: { folium: { major: 1, minor: 4 } },
  log: {
    info: (m) => console.log('[info]', m),
    warn: (m) => console.log('[warn]', m),
    error: (m) => console.log('[error]', m),
  },
  runtime: {
    getPlaybackSnapshot: () => {
      const pos = (Date.now() - t0) / 1000;
      if (pos < 16) {
        return {
          song: { title: '测试之歌', artist: 'Folia 模组', ref: 'fake-1' },
          state: 'playing',
          position: pos,
          duration: 30,
          lines,
          theme: null,
          visualizerMode: null,
        };
      }
      return null;
    },
  },
  lifecycle: { onDeactivate: (fn) => { disposer = fn; } },
};

activate(api);
console.log('模拟播放 21 秒：歌名 3 秒 + 四行歌词 + 收尾…');

setTimeout(() => {
  if (disposer) disposer();
  console.log('测试结束');
  process.exit(0);
}, 21000);
