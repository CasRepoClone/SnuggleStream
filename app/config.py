import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"
MEDIA_DIR = BASE_DIR / "media"

# Max upload size: 2 GB
MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024

# Room settings
ROOM_CODE_LENGTH = 6
ROOM_EXPIRY_HOURS = int(os.getenv("ROOM_EXPIRY_HOURS", "24"))

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
