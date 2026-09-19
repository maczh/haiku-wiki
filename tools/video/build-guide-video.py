#!/usr/bin/env python3
"""生成《寄海文库 · 新手操作演示》视频：截图 + 中文语音讲解 + 烧录字幕。

流程：
  1. 每个镜头用 edge-tts 合成中文旁白，ffprobe 量出真实时长；
  2. 段落时长 = 旁白时长 + 0.75s 尾巴，据此渲染该段的静帧 + 缓推镜（zoompan）+
     左上角章节标签 + 底部逐句字幕；
  3. 段落统一编码参数后用 concat demuxer 无损拼接，音视频天然同步；
  4. 输出章节起止时间，供前端 INTRO_CHAPTERS 对齐。

用法：python3 build-guide-video.py <素材根目录> <输出目录>
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

SHOT_ROOT = sys.argv[1]
OUT_DIR = sys.argv[2]

TTS = "/home/macro/.workbuddy/binaries/python/envs/default/bin/edge-tts"
VOICE = "zh-CN-YunxiNeural"
RATE = "+8%"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
W, H, FPS = 1600, 900, 25
TAIL = 0.75          # 每段末尾留白，避免旁白贴边
MIN_DUR = 3.4        # 段落最短时长
SUB_MAX = 21         # 单行字幕最大字数

S1 = f"{SHOT_ROOT}/video-shots-1789795800/shots"
S3 = f"{SHOT_ROOT}/video-shots3-1789796120/shots"
S4 = f"{SHOT_ROOT}/video-shots4-1789796370/shots"
S5 = f"{SHOT_ROOT}/video-shots5-1789797660/shots"
S6 = f"{SHOT_ROOT}/video-shots6-1789797874/shots"

# (截图, 章节标签（None=延续上一章）, 旁白)
SCENES = [
    (f"{S1}/01-login.png", "一 · 登录与首页",
     "打开寄海文库，用账号密码登录；新同事可以直接注册，注册后默认为普通成员。"),
    (f"{S4}/02-dashboard-hero.png", None,
     "登录后进入首页：欢迎栏一眼看到知识库、团队文库和最近更新，下面八个快捷入口让常用操作一步直达。"),
    (f"{S6}/23-dashboard-books.png", None,
     "最近更新跨知识库聚合、按时间倒序，点一下直接打开；新手向导和视频介绍都能一键收起，也可以选择不再提示。"),

    (f"{S5}/21-new-book.png", "二 · 新建知识库",
     "先建知识库。可见性分三档：公开、成员可见和私有，私有库只有自己能看到。"),
    (f"{S4}/05-book-tree.png", None,
     "左侧是文档目录树，支持多级目录、拖拽排序与跨知识库移动。"),

    (f"{S5}/22-new-doc.png", "三 · 新建与编辑文档",
     "在知识库里新建文档，先选择存放位置。"),
    (f"{S3}/06-doc-types.png", None,
     "共有九种文档类型：文档、表格、思维导图、流程图、绘图、待办、日历、甘特图和接口文档。"),
    (f"{S1}/08-editor.png", None,
     "编辑器支持 Markdown 实时渲染，还有表格、代码块和图片；每三秒自动保存，历史版本可以随时回滚。"),
    (f"{S4}/09-reader.png", None,
     "阅读态提供大纲目录、字号和宽度调节，右侧还有协作者与分享入口。"),
    (f"{S5}/07-import-dialog.png", None,
     "已有资料不必重录：可以导入 Word、Excel、PDF、图片和 CAD 图纸，也能粘贴链接抓取网页正文。"),

    (f"{S1}/10-sheet.png", "四 · 九种文档类型",
     "表格带公式与筛选，可以直接当在线 Excel 用。"),
    (f"{S1}/11-mindmap.png", None,
     "思维导图适合梳理结构与方案，节点层级自由展开。"),
    (f"{S1}/12-flowchart.png", None,
     "流程图用 Mermaid 语法描述，写几行代码就能出图。"),
    (f"{S1}/13-gantt.png", None,
     "甘特图用于排期，任务条显示进度、优先级与负责人，可以直接拖拽调整。"),
    (f"{S1}/14-todo.png", None,
     "待办清单按优先级和截止日组织，完成一条勾一条。"),
    (f"{S1}/15-calendar.png", None,
     "日历把任务落到具体日期上，周月视图随时切换。"),

    (f"{S5}/24-search.png", "五 · 搜索与分享",
     "顶部搜索框对标题和正文做全文检索，结果按你的权限自动过滤，并给出匹配的正文片段。"),
    (f"{S4}/17-share.png", None,
     "右键文档就能生成分享链接，可以设置阅读密码与有效期；关闭分享后旧链接立即失效。"),
    (f"{S1}/19-share-public.png", None,
     "对方无需登录即可打开；内部协作还能把同事加为协作者，一起编辑同一篇文档。"),

    (f"{S4}/18-export.png", "六 · 导出与总结",
     "交付时文档可导出 Markdown、Word 或 PDF，表格导出 Excel，思维导图导出 XMind，整库还能打包下载。"),
    (f"{S4}/02-dashboard-hero.png", None,
     "从建库、写文档到搜索、分享与导出，动线都能在首页一条龙完成，新同事几分钟就能上手。"),
]


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def probe_dur(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=nw=1:nk=1", path]).stdout.strip()
    return float(out)


def split_subs(text):
    """把旁白切成适合单行显示的字幕块：先按句末标点切，过长再按逗号切。"""
    parts = [p for p in re.split(r"(?<=[。！？；])", text) if p.strip()]
    chunks = []
    for p in parts:
        if len(p) <= SUB_MAX:
            chunks.append(p)
            continue
        buf = ""
        for seg in re.split(r"(?<=[，、：])", p):
            if len(buf) + len(seg) <= SUB_MAX:
                buf += seg
            else:
                if buf:
                    chunks.append(buf)
                buf = seg
        if buf:
            chunks.append(buf)
    # 合并过短的尾块，避免字幕闪一下就没
    merged = []
    for c in chunks:
        if merged and len(merged[-1]) + len(c) <= SUB_MAX + 6:
            merged[-1] += c
        else:
            merged.append(c)
    return merged


def esc(s):
    """drawtext 文本转义（滤镜串里 : ' , % 都是元字符）。"""
    for a, b in (("\\", "\\\\"), (":", "\\:"), ("'", "\\\\'"), ("%", "\\%"),
                 (",", "\\,"), ("[", "\\["), ("]", "\\]"), (";", "\\;")):
        s = s.replace(a, b)
    return s


def tts(text, mp3):
    """合成旁白。edge-tts 走 WebSocket，偶发抖动要重试；已合成的直接复用。"""
    if os.path.exists(mp3) and os.path.getsize(mp3) > 2000:
        return
    last = ""
    for attempt in range(4):
        try:
            run([TTS, "--voice", VOICE, "--rate", RATE, "--text", text, "--write-media", mp3])
            if os.path.getsize(mp3) > 2000:
                return
            last = "输出过小"
        except subprocess.CalledProcessError as e:
            last = (e.stderr or e.stdout or "").strip()[-200:]
        print(f"    ⚠ TTS 第 {attempt + 1} 次失败（{last}），重试…", flush=True)
        time.sleep(2 + 3 * attempt)
    raise SystemExit(f"TTS 连续失败：{text[:20]}… / {last}")


def build_segment(idx, img, chapter, text, work):
    mp3 = f"{work}/a{idx:02d}.mp3"
    tts(text, mp3)
    dur = probe_dur(mp3)
    seg_dur = round(max(dur + TAIL, MIN_DUR), 3)
    frames = int(round(seg_dur * FPS))

    # ---- 滤镜链：缓推镜 → 章节标签 → 底部逐句字幕 ----
    chain = [
        f"scale={W*3//2}:{H*3//2}:flags=lanczos",
        f"zoompan=z='min(1+0.05*on/{frames},1.05)'"
        f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS}",
        "setsar=1",
        f"fade=t=in:st=0:d=0.3",
    ]
    if chapter:
        chain.append(
            "drawtext=fontfile=%s:text='%s':fontsize=27:fontcolor=white"
            ":box=1:boxcolor=0x1d39c4@0.88:boxborderw=15:x=34:y=26"
            % (FONT_BOLD, esc(chapter))
        )
    chunks = split_subs(text)
    total = sum(len(c) for c in chunks) or 1
    t = 0.15  # 字幕比画面晚一点出现
    for c in chunks:
        d = max(dur * len(c) / total, 0.9)
        chain.append(
            "drawtext=fontfile=%s:text='%s':fontsize=31:fontcolor=white"
            ":box=1:boxcolor=0x000000@0.66:boxborderw=17"
            ":x=(w-text_w)/2:y=h-124:enable='between(t,%.3f,%.3f)'"
            % (FONT_REG, esc(c), t, t + d)
        )
        t += d

    seg = f"{work}/s{idx:02d}.mp4"
    if os.path.exists(seg) and os.path.getsize(seg) > 10000:
        return seg, dur, seg_dur
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", img, "-i", mp3,
        "-filter_complex",
        f"[0:v]{','.join(chain)}[v];"
        f"[1:a]apad,atrim=0:{seg_dur},asetpts=N/SR/TB,aresample=44100,"
        f"aformat=channel_layouts=stereo[a]",
        "-map", "[v]", "-map", "[a]", "-t", str(seg_dur),
        "-c:v", "libx264", "-preset", "slower", "-crf", "23",
        "-pix_fmt", "yuv420p", "-g", "50", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        seg,
    ]
    run(cmd)
    return seg, dur, seg_dur


def main():
    work = f"{OUT_DIR}/.work"
    # REUSE=1 时保留旁白 mp3（避免重复联网合成），但段落视频一律重渲，
    # 这样改了编码参数/字幕样式都能立刻生效。
    if os.path.isdir(work) and os.environ.get("REUSE") != "1":
        shutil.rmtree(work)
    os.makedirs(work, exist_ok=True)
    for f in os.listdir(work):
        if f.endswith(".mp4"):
            os.remove(os.path.join(work, f))

    missing = [s[0] for s in SCENES if not os.path.exists(s[0])]
    if missing:
        raise SystemExit("缺失截图：\n  " + "\n  ".join(missing))

    current_chapter = None
    chapters, segs = [], []
    total = 0.0
    for i, (img, chapter, text) in enumerate(SCENES, 1):
        seg, adur, sdur = build_segment(i, img, chapter, text, work)
        segs.append(seg)
        if chapter:
            current_chapter = chapter
            chapters.append({"label": chapter.split("· ", 1)[-1], "at": round(total, 1)})
        total += sdur
        print(f"  [{i:02d}] {os.path.basename(img):28s} 旁白 {adur:5.2f}s → 段落 {sdur:5.2f}s"
              f"  累计 {total:6.2f}s", flush=True)

    with open(f"{work}/list.txt", "w", encoding="utf-8") as f:
        for s in segs:
            f.write(f"file '{s}'\n")

    out = f"{OUT_DIR}/haiku-wiki-guide.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", f"{work}/list.txt", "-c", "copy", "-movflags", "+faststart", out])

    # 封面：拿首页整屏做底，压深后叠标题与时长——比视频首帧更像「一张海报」
    mins, secs = divmod(int(round(total)), 60)
    label = f"{mins} 分 {secs} 秒" if mins else f"{secs} 秒"
    poster = f"{OUT_DIR}/haiku-wiki-guide-poster.jpg"
    poster_filters = ",".join([
        f"scale={W}:{H}:flags=lanczos",
        "drawbox=x=0:y=0:w=iw:h=ih:color=0x081538@0.82:t=fill",
        "drawbox=x=0:y=290:w=iw:h=320:color=0x12308f@0.30:t=fill",
        f"drawtext=fontfile={FONT_BOLD}:text='寄海文库 · 新手操作演示':fontsize=74"
        ":fontcolor=white:x=(w-text_w)/2:y=325",
        f"drawtext=fontfile={FONT_REG}:text='{label} · 中文语音讲解 + 字幕 · 六个章节可跳转'"
        ":fontsize=30:fontcolor=0xdfe6ff:x=(w-text_w)/2:y=438",
        f"drawtext=fontfile={FONT_REG}:text='知识库 · 九种文档类型 · 全文搜索 · 分享协作 · 多格式导出'"
        ":fontsize=26:fontcolor=0xa9bcf0:x=(w-text_w)/2:y=490",
        "drawbox=x=700:y=575:w=200:h=200:color=0x2f54eb@0.95:t=fill",
        f"drawtext=fontfile={FONT_REG}:text='▶':fontsize=96:fontcolor=white:x=(w-text_w)/2:y=625",
    ])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", SCENES[1][0],
         "-filter_complex", poster_filters, "-frames:v", "1", "-q:v", "3", poster])

    print("\n章节时间轴：")
    print(json.dumps(chapters, ensure_ascii=False, indent=2))
    print(f"\n总时长 {total:.2f}s  输出 {out} ({os.path.getsize(out)/1048576:.2f} MB)")
    print("VIDEO_OK")


if __name__ == "__main__":
    main()
