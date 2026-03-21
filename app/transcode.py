"""HLS adaptive-bitrate transcoding pipeline for SnuggleStream."""

import asyncio
import json
import logging
import shutil
from pathlib import Path
from typing import Optional, Callable, Awaitable

from app.config import MEDIA_DIR

log = logging.getLogger(__name__)

# Quality presets — only levels ≤ source resolution are encoded
QUALITY_PRESETS = [
    {"name": "360p",  "height": 360,  "vbitrate": "800k",  "abitrate": "96k",  "bandwidth": 896000},
    {"name": "480p",  "height": 480,  "vbitrate": "1400k", "abitrate": "128k", "bandwidth": 1528000},
    {"name": "720p",  "height": 720,  "vbitrate": "2800k", "abitrate": "128k", "bandwidth": 2928000},
    {"name": "1080p", "height": 1080, "vbitrate": "5000k", "abitrate": "192k", "bandwidth": 5192000},
]

# Active transcoding jobs: filename -> status dict
_jobs: dict[str, dict] = {}
# Keep task references alive so they aren't garbage-collected
_tasks: dict[str, asyncio.Task] = {}


async def _probe(path: Path) -> Optional[dict]:
    """Return {width, height, has_audio} via ffprobe, or None on failure."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams",
            str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode != 0:
            return None
        data = json.loads(stdout)
        info = {"width": 0, "height": 0, "has_audio": False}
        for s in data.get("streams", []):
            if s.get("codec_type") == "video" and info["height"] == 0:
                info["width"] = int(s.get("width", 0))
                info["height"] = int(s.get("height", 0))
            elif s.get("codec_type") == "audio":
                info["has_audio"] = True
        return info
    except FileNotFoundError:
        log.error("ffprobe not found — install FFmpeg to enable HLS transcoding")
        return None
    except Exception as e:
        log.error("ffprobe error: %s", e)
        return None


def get_job(filename: str) -> Optional[dict]:
    """Return current transcoding status for *filename*, or None."""
    return _jobs.get(filename)


def cancel_job(filename: str):
    """Cancel a running transcode task if one exists."""
    task = _tasks.pop(filename, None)
    if task and not task.done():
        task.cancel()
    _jobs.pop(filename, None)


def start_transcode(
    filename: str,
    room_code: str,
    notify: Optional[Callable[[str, str], Awaitable[None]]] = None,
):
    """Fire-and-forget HLS transcoding for *filename*.

    *notify(hls_url, room_code)* is awaited when transcoding finishes.
    """
    # Cancel any previous job for this file
    cancel_job(filename)
    task = asyncio.create_task(_transcode(filename, room_code, notify))
    _tasks[filename] = task


async def _transcode(
    filename: str,
    room_code: str,
    notify: Optional[Callable[[str, str], Awaitable[None]]],
):
    source = MEDIA_DIR / filename
    if not source.is_file():
        _jobs[filename] = {"status": "error", "error": "Source file missing"}
        return

    stem = source.stem
    hls_dir = MEDIA_DIR / f"{stem}_hls"

    _jobs[filename] = {"status": "probing", "hls_url": ""}

    # ---- probe ----
    info = await _probe(source)
    if not info or info["height"] == 0:
        _jobs[filename] = {
            "status": "error",
            "error": "Could not read video info. Is FFmpeg installed?",
        }
        return

    src_h = info["height"]
    src_w = info["width"]
    has_audio = info["has_audio"]

    # Pick quality levels that don't exceed source resolution
    qualities = [q for q in QUALITY_PRESETS if q["height"] <= src_h]
    if not qualities:
        qualities = [QUALITY_PRESETS[0]]  # at least one

    # Prepare output dir
    if hls_dir.exists():
        shutil.rmtree(hls_dir)
    hls_dir.mkdir(parents=True, exist_ok=True)

    _jobs[filename] = {"status": "transcoding", "hls_url": ""}

    # ---- build ffmpeg command ----
    cmd: list[str] = [
        "ffmpeg", "-hide_banner", "-y",
        "-i", str(source),
        "-preset", "fast",
        "-sc_threshold", "0",
        "-g", "48", "-keyint_min", "48",
    ]

    for i, q in enumerate(qualities):
        cmd += ["-map", "0:v:0"]
        if has_audio:
            cmd += ["-map", "0:a:0"]
        cmd += [
            f"-filter:v:{i}", f"scale=-2:{q['height']}",
            f"-c:v:{i}", "libx264",
            f"-b:v:{i}", q["vbitrate"],
        ]
        if has_audio:
            cmd += [f"-c:a:{i}", "aac", f"-b:a:{i}", q["abitrate"]]

    # var_stream_map with readable names
    if has_audio:
        vsm = " ".join(
            f"v:{i},a:{i},name:{q['name']}" for i, q in enumerate(qualities)
        )
    else:
        vsm = " ".join(
            f"v:{i},name:{q['name']}" for i, q in enumerate(qualities)
        )

    cmd += [
        "-f", "hls",
        "-hls_time", "6",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
        "-master_pl_name", "master.m3u8",
        "-var_stream_map", vsm,
        "-hls_segment_filename", str(hls_dir / "%v_%03d.ts"),
        str(hls_dir / "%v.m3u8"),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            err = stderr.decode(errors="replace")[-500:]
            log.error("FFmpeg failed for %s: %s", filename, err)
            _jobs[filename] = {"status": "error", "error": err}
            return
    except asyncio.CancelledError:
        _jobs.pop(filename, None)
        if hls_dir.exists():
            shutil.rmtree(hls_dir, ignore_errors=True)
        return
    except FileNotFoundError:
        _jobs[filename] = {
            "status": "error",
            "error": "FFmpeg not found. Install FFmpeg to enable adaptive streaming.",
        }
        return
    except Exception as e:
        _jobs[filename] = {"status": "error", "error": str(e)}
        return

    # ---- rewrite master playlist with RESOLUTION tags ----
    master = hls_dir / "master.m3u8"
    if master.is_file():
        lines = ["#EXTM3U"]
        for q in qualities:
            variant = hls_dir / f"{q['name']}.m3u8"
            if variant.is_file():
                # Compute target width preserving aspect ratio (even number)
                w = round(src_w * q["height"] / src_h)
                w += w % 2
                lines.append(
                    f"#EXT-X-STREAM-INF:BANDWIDTH={q['bandwidth']},"
                    f"RESOLUTION={w}x{q['height']}"
                )
                lines.append(f"{q['name']}.m3u8")
        master.write_text("\n".join(lines) + "\n")

    hls_url = f"/media/{stem}_hls/master.m3u8"
    _jobs[filename] = {"status": "complete", "hls_url": hls_url}
    log.info("HLS ready for %s → %s", filename, hls_url)

    # Clean up task reference
    _tasks.pop(filename, None)

    if notify:
        try:
            await notify(hls_url, room_code)
        except Exception as e:
            log.error("Notify callback error: %s", e)
