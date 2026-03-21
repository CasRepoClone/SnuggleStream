"""WebSocket endpoint for real-time video sync."""

import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.rooms import room_manager, VOTE_TIMEOUT_SECONDS
from app.moderation import moderate_chat, chat_rate_limiter
from app.security import (
    sanitize_text,
    validate_current_time,
    validate_playback_rate,
    validate_room_code,
    validate_video_url,
)

router = APIRouter()


def _candidates_list(room):
    """Build list of {user_id, name} for voting UI."""
    return [
        {"user_id": uid, "name": room.user_names.get(uid, "Anonymous")}
        for uid in room.connections
    ]


async def _start_vote(room, code):
    """Initiate a host vote in the room."""
    if room.viewer_count == 0:
        return
    if room.viewer_count == 1:
        # Only one person left — auto-host
        new_host = next(iter(room.connections))
        room.host_id = new_host
        room.voting_active = False
        await room_manager.broadcast(code, {
            "type": "host_update",
            "host_id": new_host,
            "host_name": room.user_names.get(new_host, "Anonymous"),
        })
        return
    room.voting_active = True
    room.votes = {}
    room.vote_start_time = time.time()
    room.state.is_playing = False
    await room_manager.broadcast(code, {
        "type": "vote_start",
        "candidates": _candidates_list(room),
        "timeout": VOTE_TIMEOUT_SECONDS,
    })


async def _tally_votes(room, code):
    """Count votes (FPTP) and announce the new host."""
    # Tally
    counts: dict[str, int] = {}
    for candidate_id in room.votes.values():
        if candidate_id in room.connections:
            counts[candidate_id] = counts.get(candidate_id, 0) + 1

    if counts:
        max_votes = max(counts.values())
        # Tie-break: first in connections order (earliest joiner)
        winner = None
        for uid in room.connections:
            if counts.get(uid, 0) == max_votes:
                winner = uid
                break
        if not winner:
            winner = next(iter(room.connections))
    else:
        winner = next(iter(room.connections))

    room.host_id = winner
    room.voting_active = False
    room.votes = {}
    await room_manager.broadcast(code, {
        "type": "vote_result",
        "host_id": winner,
        "host_name": room.user_names.get(winner, "Anonymous"),
    })
    await room_manager.broadcast(code, {
        "type": "host_update",
        "host_id": winner,
        "host_name": room.user_names.get(winner, "Anonymous"),
    })


async def _check_vote_timeout(room, code):
    """If voting has timed out, tally whatever votes exist."""
    if room.voting_active and (time.time() - room.vote_start_time) >= VOTE_TIMEOUT_SECONDS:
        await _tally_votes(room, code)


@router.websocket("/ws/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    validated_code = validate_room_code(room_code)
    if not validated_code:
        await websocket.close(code=4004, reason="Invalid room code")
        return

    user_id = uuid.uuid4().hex[:12]
    room = await room_manager.connect(validated_code, user_id, websocket)

    if not room:
        await websocket.close(code=4004, reason="Room not found")
        return

    # First person to join becomes host
    is_first = room.viewer_count == 1
    if not room.host_id or room.host_id not in room.connections:
        room.host_id = user_id

    # Send current state to the newly connected user
    await websocket.send_json({
        "type": "sync",
        "video_url": room.state.video_url,
        "video_type": room.state.video_type,
        "hls_url": room.state.hls_url,
        "is_playing": room.state.is_playing,
        "current_time": room.state.current_time,
        "playback_rate": room.state.playback_rate,
        "viewers": room.viewer_count,
        "user_id": user_id,
        "host_id": room.host_id,
        "host_name": room.user_names.get(room.host_id, "Anonymous"),
    })

    # Notify others
    await room_manager.broadcast(validated_code, {
        "type": "viewer_update",
        "viewers": room.viewer_count,
    }, exclude_user=user_id)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = str(data.get("type", ""))

            # Check vote timeout on every message
            if room.voting_active:
                await _check_vote_timeout(room, validated_code)

            if msg_type == "set_name":
                name = sanitize_text(data.get("name", ""), 50) or "Anonymous"
                room.user_names[user_id] = name
                # Broadcast updated host name if this user is host
                if user_id == room.host_id:
                    await room_manager.broadcast(validated_code, {
                        "type": "host_update",
                        "host_id": room.host_id,
                        "host_name": name,
                    })

            elif msg_type == "play":
                if user_id != room.host_id:
                    await websocket.send_json({"type": "error", "message": "Only the host can control playback"})
                    continue
                room.state.is_playing = True
                room.state.current_time = validate_current_time(data.get("current_time", 0))
                room.state.last_update = time.time()
                await room_manager.broadcast(validated_code, {
                    "type": "play",
                    "current_time": room.state.current_time,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "pause":
                if user_id != room.host_id:
                    await websocket.send_json({"type": "error", "message": "Only the host can control playback"})
                    continue
                room.state.is_playing = False
                room.state.current_time = validate_current_time(data.get("current_time", 0))
                room.state.last_update = time.time()
                await room_manager.broadcast(validated_code, {
                    "type": "pause",
                    "current_time": room.state.current_time,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "seek":
                if user_id != room.host_id:
                    await websocket.send_json({"type": "error", "message": "Only the host can control playback"})
                    continue
                room.state.current_time = validate_current_time(data.get("current_time", 0))
                room.state.last_update = time.time()
                await room_manager.broadcast(validated_code, {
                    "type": "seek",
                    "current_time": room.state.current_time,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "video_change":
                if user_id != room.host_id:
                    await websocket.send_json({"type": "error", "message": "Only the host can change the video"})
                    continue
                video_url = sanitize_text(data.get("video_url", ""), 2048)
                video_type = str(data.get("video_type", "url"))
                if video_type not in ("url", "file"):
                    video_type = "url"

                # Validate URL safety
                if video_url:
                    if video_type == "url" and not validate_video_url(video_url):
                        await websocket.send_json({"type": "error", "message": "Invalid video URL"})
                        continue
                    if video_type == "file" and not video_url.startswith("/media/"):
                        await websocket.send_json({"type": "error", "message": "Invalid media path"})
                        continue

                room.state.video_url = video_url
                room.state.video_type = video_type
                room.state.hls_url = ""
                room.state.is_playing = False
                room.state.current_time = 0.0
                room.state.last_update = time.time()
                await room_manager.broadcast(validated_code, {
                    "type": "video_change",
                    "video_url": room.state.video_url,
                    "video_type": room.state.video_type,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "rate_change":
                if user_id != room.host_id:
                    await websocket.send_json({"type": "error", "message": "Only the host can change playback speed"})
                    continue
                room.state.playback_rate = validate_playback_rate(data.get("rate", 1.0))
                await room_manager.broadcast(validated_code, {
                    "type": "rate_change",
                    "rate": room.state.playback_rate,
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "vote":
                if not room.voting_active:
                    continue
                candidate_id = str(data.get("candidate_id", ""))
                if candidate_id not in room.connections:
                    continue
                room.votes[user_id] = candidate_id
                # Check if all connected users have voted
                if len(room.votes) >= room.viewer_count:
                    await _tally_votes(room, validated_code)

            elif msg_type == "request_sync":
                await websocket.send_json({
                    "type": "sync",
                    "video_url": room.state.video_url,
                    "video_type": room.state.video_type,
                    "hls_url": room.state.hls_url,
                    "is_playing": room.state.is_playing,
                    "current_time": room.state.current_time,
                    "playback_rate": room.state.playback_rate,
                    "viewers": room.viewer_count,
                    "user_id": user_id,
                    "host_id": room.host_id,
                    "host_name": room.user_names.get(room.host_id, "Anonymous"),
                })

            elif msg_type == "gif":
                gif_url = str(data.get("url", "")).strip()
                nickname = sanitize_text(data.get("nickname", ""), 30) or "Anonymous"
                # Only allow Giphy media URLs
                if gif_url and gif_url.startswith("https://media") and ".giphy.com/" in gif_url:
                    if not chat_rate_limiter.is_allowed(user_id):
                        continue
                    await room_manager.broadcast(validated_code, {
                        "type": "gif",
                        "url": gif_url,
                        "nickname": nickname,
                        "user_id": user_id,
                    })

            elif msg_type == "chat":
                text = sanitize_text(data.get("text", ""), 500)
                nickname = sanitize_text(data.get("nickname", ""), 30) or "Anonymous"
                if text:
                    result = moderate_chat(text, user_id)
                    if not result.allowed:
                        await websocket.send_json({
                            "type": "chat_blocked",
                            "reason": result.reason,
                        })
                        continue
                    await room_manager.broadcast(validated_code, {
                        "type": "chat",
                        "text": text,
                        "nickname": nickname,
                        "user_id": user_id,
                    })

            # ---- WebRTC screen-share signaling ----
            elif msg_type == "screen_share_start":
                if user_id != room.host_id:
                    await websocket.send_json({"type": "error", "message": "Only the host can share their screen"})
                    continue
                await room_manager.broadcast(validated_code, {
                    "type": "screen_share_start",
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "screen_share_stop":
                if user_id != room.host_id:
                    continue
                await room_manager.broadcast(validated_code, {
                    "type": "screen_share_stop",
                    "user_id": user_id,
                }, exclude_user=user_id)

            elif msg_type == "webrtc_offer":
                target = str(data.get("target", ""))
                if user_id != room.host_id or target not in room.connections:
                    continue
                await room.connections[target].send_json({
                    "type": "webrtc_offer",
                    "offer": data.get("offer"),
                    "user_id": user_id,
                })

            elif msg_type == "webrtc_answer":
                target = str(data.get("target", ""))
                if target not in room.connections:
                    continue
                await room.connections[target].send_json({
                    "type": "webrtc_answer",
                    "answer": data.get("answer"),
                    "user_id": user_id,
                })

            elif msg_type == "webrtc_ice":
                target = str(data.get("target", ""))
                if target not in room.connections:
                    continue
                await room.connections[target].send_json({
                    "type": "webrtc_ice",
                    "candidate": data.get("candidate"),
                    "user_id": user_id,
                })

            elif msg_type == "request_viewer_list":
                if user_id != room.host_id:
                    continue
                viewers = [uid for uid in room.connections if uid != user_id]
                await websocket.send_json({
                    "type": "viewer_list",
                    "viewers": viewers,
                })

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        chat_rate_limiter.cleanup(user_id)
        room.user_names.pop(user_id, None)
        # Remove vote if they were voting
        room.votes.pop(user_id, None)
        was_host = user_id == room.host_id
        room_deleted = room_manager.disconnect(validated_code, user_id)
        if not room_deleted:
            await room_manager.broadcast(validated_code, {
                "type": "viewer_update",
                "viewers": room.viewer_count,
            })
            if was_host:
                room.host_id = ""
                await _start_vote(room, validated_code)
            elif room.voting_active:
                # Recheck if all remaining users have voted
                if len(room.votes) >= room.viewer_count:
                    await _tally_votes(room, validated_code)
