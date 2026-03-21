import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"
MEDIA_DIR = BASE_DIR / "media"

# Max upload size: 15 GB
MAX_UPLOAD_SIZE = 15 * 1024 * 1024 * 1024

# Room settings
ROOM_CODE_LENGTH = 6
ROOM_EXPIRY_HOURS = int(os.getenv("ROOM_EXPIRY_HOURS", "24"))

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# Google OAuth2
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
SESSION_SECRET = os.getenv("SESSION_SECRET", "change-me-to-a-random-string")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
