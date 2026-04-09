"""SnuggleStream Bot — Mini-game manager (drinking game voting, etc.)."""

import asyncio
import json
import random
import time
from pathlib import Path
from typing import Optional

from app.rooms import Room

# Load drinking game topics once at import time
_TOPICS_FILE = Path(__file__).parent / "drinkingGameTopics.json"
with open(_TOPICS_FILE, "r", encoding="utf-8") as _f:
    DRINKING_GAME_TOPICS: list[str] = json.load(_f)

BOT_NAME = "SnuggleStream Bot"

# Cooldown: at least 10 minutes between bot-initiated games per room
GAME_COOLDOWN_SECONDS = 600

# Cooldown after host stops a game before a new one can start
HOST_RESTART_COOLDOWN_SECONDS = 30

# Voting durations
OPT_IN_VOTE_SECONDS = 30   # "Do you want to play?"
TOPIC_VOTE_SECONDS = 30     # "Pick a drinking game"
TOPIC_CHOICES = 3           # How many random topics to offer


class MiniGameState:
    """Tracks the current mini-game voting state for a single room."""

    def __init__(self):
        self.phase: str = "idle"  # "idle" | "opt_in" | "topic_vote" | "active"
        self.opt_in_votes: dict[str, bool] = {}   # user_id -> True/False
        self.topic_votes: dict[str, int] = {}      # user_id -> topic index
        self.topic_choices: list[str] = []
        self.active_topic: str = ""
        self.phase_end: float = 0.0
        self.last_game_time: float = 0.0
        self._timeout_task: Optional[asyncio.Task] = None

    def reset(self):
        self.phase = "idle"
        self.opt_in_votes = {}
        self.topic_votes = {}
        self.topic_choices = []
        self.active_topic = ""
        self.phase_end = 0.0
        if self._timeout_task and not self._timeout_task.done():
            self._timeout_task.cancel()
        self._timeout_task = None


# Room code -> MiniGameState
_game_states: dict[str, MiniGameState] = {}


def get_game_state(room_code: str) -> MiniGameState:
    if room_code not in _game_states:
        _game_states[room_code] = MiniGameState()
    return _game_states[room_code]


def cleanup_game_state(room_code: str):
    state = _game_states.pop(room_code, None)
    if state:
        state.reset()


def _bot_chat_msg(text: str) -> dict:
    """Create a chat message dict that looks like it comes from the bot."""
    return {
        "type": "chat",
        "text": text,
        "nickname": BOT_NAME,
        "user_id": "__bot__",
    }


def _bot_minigame_msg(subtype: str, **kwargs) -> dict:
    """Create a minigame-specific message."""
    return {
        "type": "minigame",
        "subtype": subtype,
        "bot_name": BOT_NAME,
        **kwargs,
    }


async def _broadcast(room, room_code: str, msg: dict):
    """Broadcast to all connections in a room."""
    dead = []
    for uid, ws in room.connections.items():
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(uid)
    for uid in dead:
        room.connections.pop(uid, None)


async def start_opt_in_vote(room: Room, room_code: str, host_ws=None):
    """Phase 1: Bot asks 'Wanna play a drinking game?' with Yes/No vote."""
    state = get_game_state(room_code)

    if state.phase != "idle":
        return  # already running

    remaining = HOST_RESTART_COOLDOWN_SECONDS - (time.time() - state.last_game_time)
    if remaining > 0:
        if host_ws:
            try:
                await host_ws.send_json({
                    "type": "error",
                    "message": f"Please wait {int(remaining)}s before starting a new game",
                })
            except Exception:
                pass
        return  # cooldown

    state.phase = "opt_in"
    state.opt_in_votes = {}
    state.phase_end = time.time() + OPT_IN_VOTE_SECONDS

    # Send bot chat message + structured vote prompt
    await _broadcast(room, room_code, _bot_chat_msg(
        "🎲 Hey everyone! Who's up for a Drinking Game? Vote below!"
    ))
    await _broadcast(room, room_code, _bot_minigame_msg(
        "opt_in_vote",
        timeout=OPT_IN_VOTE_SECONDS,
    ))

    # Schedule timeout
    state._timeout_task = asyncio.create_task(
        _opt_in_timeout(room, room_code)
    )


async def _opt_in_timeout(room: Room, room_code: str):
    """Wait for the opt-in vote to expire, then tally."""
    try:
        await asyncio.sleep(OPT_IN_VOTE_SECONDS)
        await tally_opt_in(room, room_code)
    except asyncio.CancelledError:
        pass


async def handle_opt_in_vote(room: Room, room_code: str, user_id: str, vote: bool):
    """Record a user's yes/no vote for playing the drinking game."""
    state = get_game_state(room_code)
    if state.phase != "opt_in":
        return
    state.opt_in_votes[user_id] = vote

    # Check if everyone has voted
    if len(state.opt_in_votes) >= len(room.connections):
        if state._timeout_task and not state._timeout_task.done():
            state._timeout_task.cancel()
        await tally_opt_in(room, room_code)


async def tally_opt_in(room: Room, room_code: str):
    """Count opt-in votes. If majority says yes, move to topic vote."""
    state = get_game_state(room_code)
    if state.phase != "opt_in":
        return

    yes_count = sum(1 for v in state.opt_in_votes.values() if v)
    no_count = sum(1 for v in state.opt_in_votes.values() if not v)
    total_voters = len(state.opt_in_votes)

    # Broadcast result
    await _broadcast(room, room_code, _bot_minigame_msg("opt_in_result"))

    if yes_count > no_count:
        await _broadcast(room, room_code, _bot_chat_msg(
            f"✅ The vote passed! ({yes_count} yes / {no_count} no) — Now pick a game!"
        ))
        await start_topic_vote(room, room_code)
    else:
        await _broadcast(room, room_code, _bot_chat_msg(
            f"❌ Not enough votes to play. ({yes_count} yes / {no_count} no) — Maybe next time!"
        ))
        state.last_game_time = time.time()
        state.reset()
        state.phase = "idle"


async def start_topic_vote(room: Room, room_code: str):
    """Phase 2: Present random drinking game topics for users to vote on."""
    state = get_game_state(room_code)
    state.phase = "topic_vote"
    state.topic_votes = {}
    state.topic_choices = random.sample(
        DRINKING_GAME_TOPICS, min(TOPIC_CHOICES, len(DRINKING_GAME_TOPICS))
    )
    state.phase_end = time.time() + TOPIC_VOTE_SECONDS

    await _broadcast(room, room_code, _bot_minigame_msg(
        "topic_vote",
        topics=state.topic_choices,
        timeout=TOPIC_VOTE_SECONDS,
    ))

    state._timeout_task = asyncio.create_task(
        _topic_vote_timeout(room, room_code)
    )


async def _topic_vote_timeout(room: Room, room_code: str):
    try:
        await asyncio.sleep(TOPIC_VOTE_SECONDS)
        await tally_topic_vote(room, room_code)
    except asyncio.CancelledError:
        pass


async def handle_topic_vote(room: Room, room_code: str, user_id: str, choice: int):
    """Record a user's vote for a drinking game topic."""
    state = get_game_state(room_code)
    if state.phase != "topic_vote":
        return
    if choice < 0 or choice >= len(state.topic_choices):
        return
    state.topic_votes[user_id] = choice

    if len(state.topic_votes) >= len(room.connections):
        if state._timeout_task and not state._timeout_task.done():
            state._timeout_task.cancel()
        await tally_topic_vote(room, room_code)


async def tally_topic_vote(room: Room, room_code: str):
    """Pick the winning topic and activate the game."""
    state = get_game_state(room_code)
    if state.phase != "topic_vote":
        return

    # Count votes per topic
    counts = [0] * len(state.topic_choices)
    for idx in state.topic_votes.values():
        if 0 <= idx < len(counts):
            counts[idx] += 1

    # Winner = highest count (tie-break: random)
    max_votes = max(counts) if counts else 0
    winners = [i for i, c in enumerate(counts) if c == max_votes]
    winner_idx = random.choice(winners)
    winning_topic = state.topic_choices[winner_idx]

    state.phase = "active"
    state.active_topic = winning_topic
    state.last_game_time = time.time()

    await _broadcast(room, room_code, _bot_minigame_msg("topic_result"))
    await _broadcast(room, room_code, _bot_chat_msg(
        f"🍻 The drinking game is: \"{winning_topic}\" — Have fun and drink responsibly!"
    ))
    await _broadcast(room, room_code, _bot_minigame_msg(
        "game_active",
        topic=winning_topic,
    ))

    # Game stays "active" as a banner — host or anyone can end it
    # No automatic timeout for the game itself


async def stop_game(room: Room, room_code: str):
    """End the current active drinking game."""
    state = get_game_state(room_code)
    if state.phase == "idle":
        return
    state.reset()
    state.phase = "idle"
    state.last_game_time = time.time()
    await _broadcast(room, room_code, _bot_chat_msg("🛑 The drinking game has ended. GG everyone!"))
    await _broadcast(room, room_code, _bot_minigame_msg(
        "game_stopped",
        cooldown=HOST_RESTART_COOLDOWN_SECONDS,
    ))
