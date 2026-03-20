"""WebSocket endpoint for real-time video sync."""

import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.rooms import room_manager

router = APIRouter()


@router.websocket("/ws/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    user_id = uuid.uuid4().hex[:12]
    room = await room_manager.connect(room_code.upper(), user_id, websocket)

    if not room:
        await websocket.close(code=4004, reason="Room not found")
        return

    # Send current state to the newly connected user
    await websocket.send_json({
        "type": "sync",
        "video_url": room.state.video_url,
        "video_type": room.state.video_type,
        "is_playing": room.state.is_playing,
        "current_time": room.state.current_time,
        "playback_rate": room.state.playback_rate,
        "viewers": room.viewer_count,
        "user_id": user_id,
    })

    # Notify others
    await room_manager.broadcast(room_code.upper(), {
        "type": "viewer_update",
        "viewers": room.viewer_count,
    }, exclude_user=user_id)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "play":
                room.state.is_playing = True
                room.state.current_time = float(data.get("current_time", 0))
                room.state.last_update = time.time()
                await room_manager.broadcast(room_code.upper(), {
                    "type": "play",
                    "current_time": room.state.current_time,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "pause":
                room.state.is_playing = False
                room.state.current_time = float(data.get("current_time", 0))
                room.state.last_update = time.time()
                await room_manager.broadcast(room_code.upper(), {
                    "type": "pause",
                    "current_time": room.state.current_time,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "seek":
                room.state.current_time = float(data.get("current_time", 0))
                room.state.last_update = time.time()
                await room_manager.broadcast(room_code.upper(), {
                    "type": "seek",
                    "current_time": room.state.current_time,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "video_change":
                room.state.video_url = data.get("video_url", "")
                room.state.video_type = data.get("video_type", "url")
                room.state.is_playing = False
                room.state.current_time = 0.0
                room.state.last_update = time.time()
                await room_manager.broadcast(room_code.upper(), {
                    "type": "video_change",
                    "video_url": room.state.video_url,
                    "video_type": room.state.video_type,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "rate_change":
                room.state.playback_rate = float(data.get("rate", 1.0))
                await room_manager.broadcast(room_code.upper(), {
                    "type": "rate_change",
                    "rate": room.state.playback_rate,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "request_sync":
                await websocket.send_json({
                    "type": "sync",
                    "video_url": room.state.video_url,
                    "video_type": room.state.video_type,
                    "is_playing": room.state.is_playing,
                    "current_time": room.state.current_time,
                    "playback_rate": room.state.playback_rate,
                    "viewers": room.viewer_count,
                    "user_id": user_id,
                })

            elif msg_type == "chat":
                text = str(data.get("text", "")).strip()
                nickname = str(data.get("nickname", "Anonymous")).strip()[:30]
                if text and len(text) <= 500:
                    await room_manager.broadcast(room_code.upper(), {
                        "type": "chat",
                        "text": text,
                        "nickname": nickname,
                        "user_id": user_id,
                    })

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        room_deleted = room_manager.disconnect(room_code.upper(), user_id)
        if not room_deleted:
            await room_manager.broadcast(room_code.upper(), {
                "type": "viewer_update",
                "viewers": room.viewer_count,
            })
