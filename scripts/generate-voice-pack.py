#!/usr/bin/env python3
"""生成中文播报语音包（默认女声 zh-CN-XiaoyiNeural）。

产物是一次性资源，已入库到 public/assets/audio/voice-female/，
日常构建和测试都不依赖本脚本。只有在增删播报条目、或想换音色时才需要重跑。

依赖 edge-tts（微软 Edge 神经语音，免密钥）与 ffmpeg。仓库本身是 Node 工程，
所以用独立 venv 装 Python 依赖，不要污染系统环境：

    python3 -m venv /tmp/ttsenv
    /tmp/ttsenv/bin/pip install edge-tts
    /tmp/ttsenv/bin/python scripts/generate-voice-pack.py

换音色重新生成（可用 `edge-tts --list-voices` 查全部音色）：

    /tmp/ttsenv/bin/python scripts/generate-voice-pack.py \
        --voice zh-CN-XiaoxiaoNeural --out public/assets/audio/voice-xiaoxiao

输出与既有的 public/assets/audio/voice/ 保持同一套 clip 键名和同样的音频参数
（单声道 44.1kHz mp3），响度归一到 -15 LUFS —— 与既有包实测均值一致，
玩家在设置里切换音色时音量不会跳。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# 键名必须与 public/assets/audio/voice/manifest.json 完全一致：src/main.js 的
# announce() 按键名取音频，任一包缺键就会静音。文案对齐屏幕上的 callout 文字。
CLIPS: dict[str, str] = {
    "countdown_3": "三",
    "countdown_2": "二",
    "countdown_1": "一",
    "go": "出发！",
    "perfect_start": "完美起步！",
    "double_boost": "双喷！",
    "chain_boost": "连喷！",
    "landing_boost": "落地喷！",
    "new_record": "新纪录！",
    "final_lap": "最后一圈！",
    "overtake": "漂亮的超越！",
    "finish_first": "冲线第一！",
    "rank_up": "晋级！",
}

DEFAULT_VOICE = "zh-CN-XiaoyiNeural"
DEFAULT_RATE = "+18%"
DEFAULT_PITCH = "+20Hz"
DEFAULT_OUT = "public/assets/audio/voice-female"

# 倒计时每秒才播一下，用整体语速念单字会短到发飘（"一"只有 0.2 秒），
# 听感上撑不住开场。这几条单独放慢，向既有包的节奏看齐。
RATE_OVERRIDES: dict[str, str] = {
    "countdown_3": "-10%",
    "countdown_2": "-10%",
    "countdown_1": "-10%",
    "go": "+5%",
}

TARGET_LUFS = -15.0
TARGET_PEAK_DB = -1.5
SAMPLE_RATE = 44100
BITRATE = "64k"

# 首尾静音一律切掉：edge-tts 会在两端各留 100ms 以上，播报要跟上比赛节奏。
TRIM = (
    "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-45dB,"
    "areverse,"
    "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-45dB,"
    "areverse"
)


def require_binary(name: str) -> None:
    if shutil.which(name) is None:
        sys.exit(f"缺少 {name}，请先安装后再运行")


async def synthesize(text: str, target: Path, voice: str, rate: str, pitch: str) -> None:
    import edge_tts  # 延迟导入，好让缺依赖时先报出更清楚的提示

    await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(str(target))


def post_process(source: Path, target: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source),
            "-af", f"{TRIM},loudnorm=I={TARGET_LUFS}:TP={TARGET_PEAK_DB}:LRA=11",
            "-ac", "1", "-ar", str(SAMPLE_RATE), "-b:a", BITRATE,
            str(target),
        ],
        check=True,
    )


def probe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return round(float(result.stdout.strip()), 2)


async def main() -> int:
    parser = argparse.ArgumentParser(description="生成中文播报语音包")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help=f"Edge 音色（默认 {DEFAULT_VOICE}）")
    parser.add_argument("--rate", default=DEFAULT_RATE, help=f"语速（默认 {DEFAULT_RATE}）")
    parser.add_argument("--pitch", default=DEFAULT_PITCH, help=f"音高（默认 {DEFAULT_PITCH}）")
    parser.add_argument("--out", default=DEFAULT_OUT, help=f"输出目录（默认 {DEFAULT_OUT}）")
    parser.add_argument("--only", nargs="*", help="只重生成指定 clip，便于单条返工")
    args = parser.parse_args()

    require_binary("ffmpeg")
    require_binary("ffprobe")

    repo_root = Path(__file__).resolve().parent.parent
    out_dir = (repo_root / args.out) if not Path(args.out).is_absolute() else Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    names = args.only or list(CLIPS)
    unknown = [name for name in names if name not in CLIPS]
    if unknown:
        sys.exit(f"未知 clip: {', '.join(unknown)}")

    manifest_path = out_dir / "manifest.json"
    # --only 返工时保留其余条目的时长，不要把整份 manifest 打回去。
    clips: dict[str, dict] = {}
    if manifest_path.exists():
        try:
            clips = json.loads(manifest_path.read_text("utf8")).get("clips", {})
        except (OSError, json.JSONDecodeError):
            clips = {}

    with tempfile.TemporaryDirectory() as tmp:
        for index, name in enumerate(names, start=1):
            text = CLIPS[name]
            rate = RATE_OVERRIDES.get(name, args.rate)
            raw = Path(tmp) / f"{name}.raw.mp3"
            final = out_dir / f"{name}.mp3"
            await synthesize(text, raw, args.voice, rate, args.pitch)
            post_process(raw, final)
            duration = probe_duration(final)
            clips[name] = {"file": f"{name}.mp3", "duration": duration}
            print(f"[{index}/{len(names)}] {name:<14} {text:<8} {rate:>5}  {duration:>5.2f}s  {final.stat().st_size:>6} B")

    ordered = {name: clips[name] for name in CLIPS if name in clips}
    manifest_path.write_text(
        json.dumps({"clips": ordered}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf8",
    )
    print(f"\n音色 {args.voice} / 语速 {args.rate} / 音高 {args.pitch}")
    print(f"共 {len(ordered)} 条 → {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
