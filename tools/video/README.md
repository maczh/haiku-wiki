# tools/video —— 首页「视频介绍」的生成流水线

首页 Dashboard 的「视频介绍」卡片播放的资源是**随前端分发的静态文件**：

```
web/public/onboarding/haiku-wiki-guide.mp4          （约 2 分 47 秒，19 MB）
web/public/onboarding/haiku-wiki-guide-poster.jpg   （封面，播放前显示）
```

它们不是手工录屏，而是由本目录的脚本从**真实界面截图 + 中文语音合成**生成的成品：
截图保证画面与当前版本一致，旁白与字幕由脚本维护，改完界面重新跑一遍即可。

## 三步生成

```bash
# 0) 先拿到「前端已 embed」的生产形态二进制（见仓库根 Dockerfile / README 的构建说明）
#    本机可直接用构建脚本产出：bash build-embed.sh → /path/to/haiku-wiki

# 1) 采集界面截图（会把演示数据灌进一个全新实例，不碰现有数据）
BIN=/path/to/haiku-wiki bash tools/video/capture-shots.sh /tmp/shots

# 2) 合成视频：截图 + edge-tts 中文旁白 + 烧录字幕 + 缓推镜
python3 tools/video/build-guide-video.py /tmp /tmp/video-out

# 3) 把产物放进前端静态目录，重新构建
cp /tmp/video-out/haiku-wiki-guide.mp4 \
   /tmp/video-out/haiku-wiki-guide-poster.jpg web/public/onboarding/
```

`build-guide-video.py` 会打印**章节起止时间**，需要同步到
`web/src/pages/DashboardPage.tsx` 的 `INTRO_CHAPTERS` 与 `INTRO_SECONDS`
（卡片标题的「约 N 分钟」由 `INTRO_SECONDS` 推导）。

## 依赖

| 用途 | 依赖 |
| --- | --- |
| 语音合成 | `edge-tts`（Microsoft 神经网络 TTS，需联网；音色 `zh-CN-YunxiNeural`） |
| 视频合成 | `ffmpeg` / `ffprobe`（需含 `libfreetype`，`drawtext` 要能加载中文 TTF） |
| 中文字体 | `/usr/share/fonts/opentype/noto/NotoSansCJK-{Regular,Bold}.ttc` |
| 界面采集 | `agent-browser` + 无头 Chrome（环境变量见 `capture-shots.sh` 头部） |

## 脚本

- `seed-demo.py` —— 全走公开 API 灌演示数据（用户、知识库、九种文档、团队、协作者、分享链接），
  输出 `ids.json` 供采集脚本定位页面。注意**注册接口同 IP 60 秒限一次**，脚本内已做等待重试。
- `capture-shots.sh` —— 按 `build-guide-video.py` 用到的文件名逐张采集。头部注释记录了三个
  「看起来能跑其实不生效」的坑（懒加载树、右键事件目标、`data-testid` 命名规则），改动前先读。
- `build-guide-video.py` —— 每个镜头先用 edge-tts 合成旁白并量出真实时长，段落时长 = 旁白 + 0.75s，
  据此渲染静帧 + 缓推镜 + 左上角章节标签 + 底部逐句字幕，最后用 concat demuxer 无损拼接。
  加 `REUSE=1` 可复用上一轮的旁白 mp3（只重渲画面），微调字幕/编码时省时间。

## 维护提示

- 视频约 19 MB，会进入 git 与 embed 产物（Go 二进制因此增加约 20 MB）。**这是刻意的**：
  离线部署环境下没有外部 CDN 可用，视频必须随包分发。
- 若裁剪部署包去掉了 `web/public/onboarding/`，`IntroVideo` 组件会捕获 `onError` 并降级成
  一段文字说明（指向 `docs/寄海文库功能指南.md`），不会留一个黑框给用户。
