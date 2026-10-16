# 花再 Halo PixelBar 歌词同步 (halo-pixelbar-sync)

Folia 桌面版（[folia-major](https://github.com/chthollyphile/folia-major)）的 Folium 模组：把你正在播放的歌曲与歌词，通过 USB HID 实时同步到**漫步者花再 Halo PixelBar** 像素屏上。

Sync the song and lyrics currently playing in Folia desktop to an **Edifier Halo PixelBar** pixel display, over USB HID, as a Folium mod.

## 功能 Features

- 切歌时显示 `歌名 - 歌手`（默认 3 秒）
- 逐行同步当前歌词，长句自动切换为滚动显示
- 30 秒无歌词（暂停界面离开/停止播放）自动切回像素屏时钟 UI
- 音箱热插拔自动重连（5 秒重试）
- 纯 `main` 入口模组，只申请 `runtime.playback` 一项权限，不读写任何其他数据

## 环境要求 Requirements

- Folia **桌面版** ≥ 0.7.17（Folium 模组平台 ≥ 1.4，「设置 → 实验室 → 模组系统」里开启总开关）
- 花再 Halo PixelBar 已用 USB 线连接电脑
- Windows 实测通过；协议走标准 HID，macOS / Linux 理论可用但未验证

## 安装 Install

方式一（推荐）：把本目录打包成 zip，直接拖进 Folia 的模组面板。

方式二：手动复制到用户模组目录：

- Windows: `%APPDATA%\Folia\mods\halo-pixelbar-sync`
- macOS: `~/Library/Application Support/Folia/mods/halo-pixelbar-sync`

然后在 Folia 中：`设置 → 实验室 → 模组系统` 开启总开关 → 命令面板（Ctrl+K）执行「模组」→ 找到本模组 → 点电源按钮启用 → 在原生确认窗口中确认。

## 配置 Configuration

打开 `index.cjs` 顶部的可调参数：

```js
const POLL_MS = 250;              // 快照轮询间隔（毫秒）
const SONG_INFO_DURATION_S = 3;   // 切歌时歌曲信息显示时长（秒）
const NO_LYRICS_TIMEOUT_S = 30;   // 无歌词多久后切到时钟 UI（秒）
const MAX_CHARS = 20;             // 单行最大显示宽度（CJK 记 2）
const COLOR = 0;                  // 0=白 1=红 2=绿 3=蓝 4=黄 5=青 6=品红
```

修改文件后模组的启用确认会失效，在模组面板里重新启用即可。

## 工作原理 How it works

模组只有一个 Electron 主进程侧的 `main` 入口：

1. 每 250ms 调用 Folium 的 `api.runtime.getPlaybackSnapshot()` 读取当前歌曲、播放进度与整首歌词（进度由宿主按墙钟外推，无需渲染端高频通信）；
2. 按歌词行的 `startTime` / `renderHints.renderEndTime` 定位当前行；
3. 用 [node-hid](https://github.com/node-hid/node-hid)（以 `vendor/` 形式随模组分发）把文本按 Halo PixelBar 的 HID 协议打包成 64 字节包写入设备。

HID 协议（64 字节包、校验和、布局/UI 模式控制包）参考 [HaloPixelToolBox](https://github.com/XFEstudio/HaloPixelToolBox)。

## 注意 Notes

- 同一时刻只能有一个程序占用音箱的 HID 接口。如果你还在用其他歌词同步工具（如 HaloLyricSync），请先退出它们。
- 模组面板中本模组显示「未验证」属正常现象（社区模组无官方签名）。

## 许可 License

MIT（本模组代码）。随附第三方组件：node-hid（BSD-3-Clause）、pkg-prebuilds（MIT），见 `vendor/` 内各自许可证文件。
