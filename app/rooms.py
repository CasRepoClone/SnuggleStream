"""In-memory room management for SnuggleStream."""

import secrets
import string
import time
from dataclasses import dataclass, field
from typing import Optional

from fastapi import WebSocket

from app.config import ROOM_CODE_LENGTH, ROOM_EXPIRY_HOURS

VOTE_TIMEOUT_SECONDS = 30


@dataclass
class RoomState:
    """Current playback state for a room."""
    video_url: str = ""
    video_type: str = "url"  # "url" | "file"
    is_playing: bool = False
    current_time: float = 0.0
    last_update: float = field(default_factory=time.time)
    playback_rate: float = 1.0


@dataclass
class Room:
    code: str
    name: str
    created_at: float = field(default_factory=time.time)
    state: RoomState = field(default_factory=RoomState)
    connections: dict[str, WebSocket] = field(default_factory=dict)
    host_id: str = ""
    user_names: dict[str, str] = field(default_factory=dict)
    # Voting state
    voting_active: bool = False
    votes: dict[str, str] = field(default_factory=dict)  # voter_id -> candidate_id
    vote_start_time: float = 0.0

    @property
    def viewer_count(self) -> int:
        return len(self.connections)

    def is_expired(self) -> bool:
        return (time.time() - self.created_at) > (ROOM_EXPIRY_HOURS * 3600)


class RoomManager:
    """Manages all active rooms and their WebSocket connections."""

    def __init__(self):
        self._rooms: dict[str, Room] = {}

    def _generate_code(self) -> str:
        alphabet = string.ascii_uppercase + string.digits
        while True:
            code = "".join(secrets.choice(alphabet) for _ in range(ROOM_CODE_LENGTH))
            if code not in self._rooms:
                return code

    def create_room(self, name: str, video_url: str = "", video_type: str = "url") -> Room:
        code = self._generate_code()
        state = RoomState(video_url=video_url, video_type=video_type)
        room = Room(code=code, name=name, state=state)
        self._rooms[code] = room
        return room

    def get_room(self, code: str) -> Optional[Room]:
        room = self._rooms.get(code.upper())
        if room and room.is_expired():
            self.delete_room(code)
            return None
        return room

    def delete_room(self, code: str) -> None:
        self._rooms.pop(code.upper(), None)

    def list_rooms(self) -> list[dict]:
        self._cleanup_expired()
        return [
            {
                "code": r.code,
                "name": r.name,
                "viewers": r.viewer_count,
                "has_video": bool(r.state.video_url),
            }
            for r in self._rooms.values()
        ]

    async def connect(self, code: str, user_id: str, websocket: WebSocket) -> Optional[Room]:
        room = self.get_room(code)
        if not room:
            return None
        await websocket.accept()
        room.connections[user_id] = websocket
        return room

    def disconnect(self, code: str, user_id: str) -> bool:
        """Remove user from room. Returns True if room was deleted (0 viewers)."""
        room = self._rooms.get(code.upper())
        if room:
            room.connections.pop(user_id, None)
            if room.viewer_count == 0:
                self.delete_room(code)
                return True
        return False

    async def broadcast(self, code: str, message: dict, exclude_user: str = "") -> None:
        room = self.get_room(code)
        if not room:
            return
        dead = []
        for uid, ws in room.connections.items():
            if uid == exclude_user:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            room.connections.pop(uid, None)

    def _cleanup_expired(self) -> None:
        expired = [c for c, r in self._rooms.items() if r.is_expired()]
        for c in expired:
            del self._rooms[c]


room_manager = RoomManager()
