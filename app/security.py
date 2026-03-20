"""Security utilities for SnuggleStream."""

import math
import re
from urllib.parse import urlparse, parse_qs

# Allowed video file extensions for upload
ALLOWED_UPLOAD_EXTENSIONS = {".mp4", ".webm", ".mkv", ".avi", ".mov"}

# Allowed video URL path extensions (whitelist approach)
ALLOWED_VIDEO_EXTENSIONS = {
    ".mp4", ".webm", ".mkv", ".avi", ".mov",
    ".m3u8", ".mpd", ".ts", ".m4s", ".ogg", ".ogv",
}

# YouTube hostnames
_YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "www.youtu.be",
}

_YT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Room code: exactly 6 uppercase alphanumeric characters
ROOM_CODE_PATTERN = re.compile(r"^[A-Z0-9]{6}$")


def sanitize_text(text, max_length: int = 500) -> str:
    """Validate text: ensure string type, strip whitespace, limit length."""
    if not isinstance(text, str):
        return ""
    return text.strip()[:max_length]


def validate_room_code(code: str) -> str | None:
    """Validate and normalize room code. Returns uppercase code or None."""
    if not isinstance(code, str):
        return None
    code = code.strip().upper()
    if ROOM_CODE_PATTERN.match(code):
        return code
    return None


def extract_youtube_id(url: str) -> str | None:
    """Extract YouTube video ID from a URL. Returns None if not a YouTube URL."""
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    try:
        parsed = urlparse(url)
    except Exception:
        return None

    if parsed.scheme not in ("http", "https"):
        return None

    host = (parsed.hostname or "").lower()
    if host not in _YOUTUBE_HOSTS:
        return None

    # youtu.be/VIDEO_ID
    if host in ("youtu.be", "www.youtu.be"):
        vid = parsed.path.lstrip("/").split("/")[0]
        if _YT_ID_PATTERN.match(vid):
            return vid
        return None

    # youtube.com/watch?v=VIDEO_ID
    if parsed.path in ("/watch", "/watch/"):
        qs = parse_qs(parsed.query)
        vid = qs.get("v", [""])[0]
        if _YT_ID_PATTERN.match(vid):
            return vid
        return None

    # youtube.com/embed/VIDEO_ID or /v/VIDEO_ID or /shorts/VIDEO_ID
    for prefix in ("/embed/", "/v/", "/shorts/"):
        if parsed.path.startswith(prefix):
            vid = parsed.path[len(prefix):].split("/")[0].split("?")[0]
            if _YT_ID_PATTERN.match(vid):
                return vid

    return None


def validate_video_url(url: str) -> bool:
    """Check that a URL points to a video resource or a YouTube video."""
    if not url or not isinstance(url, str):
        return False
    url = url.strip()

    # Allow our own uploaded media paths
    if url.startswith("/media/"):
        return True

    # Allow YouTube URLs
    if extract_youtube_id(url) is not None:
        return True

    try:
        parsed = urlparse(url)
    except Exception:
        return False

    if parsed.scheme not in ("http", "https"):
        return False

    if not parsed.hostname:
        return False

    # Strip query string / fragment — only check the path
    path_lower = parsed.path.lower().rstrip("/")

    # Must end with a recognized video extension
    if not any(path_lower.endswith(ext) for ext in ALLOWED_VIDEO_EXTENSIONS):
        return False

    return True


def validate_image_url(url: str) -> str:
    """Validate profile image URL. Returns URL if HTTPS, else empty string."""
    if not url or not isinstance(url, str):
        return ""
    url = url.strip()
    try:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname:
            return ""
        return url
    except Exception:
        return ""


def validate_magic_bytes(header: bytes, extension: str) -> bool:
    """Validate that file magic bytes match the expected video format."""
    if not header or len(header) < 12:
        return False

    ext = extension.lower()

    if ext in (".mp4", ".mov"):
        return header[4:8] == b"ftyp"

    if ext in (".webm", ".mkv"):
        return header[:4] == b"\x1a\x45\xdf\xa3"

    if ext == ".avi":
        return header[:4] == b"RIFF" and header[8:12] == b"AVI "

    return False


def validate_playback_rate(rate) -> float:
    """Clamp playback rate to safe range [0.25, 4.0]."""
    try:
        rate = float(rate)
    except (TypeError, ValueError):
        return 1.0
    if math.isnan(rate) or math.isinf(rate):
        return 1.0
    return max(0.25, min(4.0, rate))


def validate_current_time(t) -> float:
    """Ensure current_time is a non-negative finite number."""
    try:
        t = float(t)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(t) or math.isinf(t):
        return 0.0
    return max(0.0, t)
