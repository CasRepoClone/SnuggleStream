"""Chat content moderation for SnuggleStream.

Policy: swear words are allowed, but slurs, hate speech, and URLs are blocked.
Rate limit: 1 message per 2 seconds per user.
"""

import re
import time

# --------------- URL Detection ---------------

_URL_PATTERN = re.compile(
    r"(?:https?://|www\.)\S+"           # http(s):// or www. links
    r"|[a-zA-Z0-9\-]+\.[a-z]{2,}(?:/\S*)?",  # bare domain like example.com/path
    re.IGNORECASE,
)

# --------------- Slur / Hate Speech Filter ---------------
# Lowercase word stems and slurs to block. This is NOT exhaustive —
# extend as needed. Regular profanity (fuck, shit, damn, etc.) is
# intentionally excluded so casual swearing is allowed.

_SLUR_WORDS = {
    # racial / ethnic slurs
    "nigger", "nigga", "niggers", "niggas",
    "chink", "chinks",
    "spic", "spics", "spick", "spicks",
    "wetback", "wetbacks",
    "gook", "gooks",
    "kike", "kikes",
    "beaner", "beaners",
    "coon", "coons",
    "darkie", "darkies",
    "zipperhead", "zipperheads",
    "raghead", "ragheads",
    "towelhead", "towelheads",
    "redskin", "redskins",
    "squaw",
    "chinaman",
    "jigaboo", "jigaboos",
    "sambo",
    "pickaninny",
    "porch monkey",

    # homophobic / transphobic slurs
    "faggot", "faggots", "fag", "fags",
    "dyke", "dykes",
    "tranny", "trannies",
    "shemale", "shemales",

    # disability slurs
    "retard", "retards", "retarded",
    "tard", "tards",

    # antisemitic
    "heeb", "heebs",

    # sexist slurs (extreme)
    "feminazi", "feminazis",

    # hate-adjacent phrases (lowercased)
    "white power",
    "heil hitler",
    "gas the",
    "kill all",
    "race war",
    "ethnic cleansing",
    "lynch the",
}

# Build a compiled regex that matches whole words from the slur list.
# Handles multi-word phrases too. Sorted longest-first so multi-word
# phrases match before their individual words.
_sorted_slurs = sorted(_SLUR_WORDS, key=len, reverse=True)
_SLUR_PATTERN = re.compile(
    r"\b(?:" + "|".join(re.escape(s) for s in _sorted_slurs) + r")\b",
    re.IGNORECASE,
)

# Also catch basic evasion: inserting dots, dashes, spaces, or zero-width chars
# between letters of slurs (e.g. "n.i.g.g.e.r" or "n i g g e r")
_SEPARATOR = r"[\s.\-_*|/\\0\u200b\u200c\u200d]*"
_EVASION_SLURS = [
    "nigger", "nigga", "faggot", "chink", "spic", "kike", "gook", "coon", "tranny", "retard",
]
_EVASION_PATTERNS = []
for slur in _EVASION_SLURS:
    pattern = _SEPARATOR.join(re.escape(ch) for ch in slur)
    _EVASION_PATTERNS.append(pattern)
_EVASION_PATTERN = re.compile(
    r"\b(?:" + "|".join(_EVASION_PATTERNS) + r")\b",
    re.IGNORECASE,
)


# --------------- Rate Limiting ---------------

class ChatRateLimiter:
    """Per-user rate limiter: 1 message every `interval` seconds."""

    def __init__(self, interval: float = 2.0):
        self._interval = interval
        self._last_message: dict[str, float] = {}

    def is_allowed(self, user_id: str) -> bool:
        now = time.monotonic()
        last = self._last_message.get(user_id, 0.0)
        if now - last < self._interval:
            return False
        self._last_message[user_id] = now
        return True

    def cleanup(self, user_id: str) -> None:
        """Remove user from tracker on disconnect."""
        self._last_message.pop(user_id, None)


# Singleton rate limiter
chat_rate_limiter = ChatRateLimiter(interval=2.0)


# --------------- Public API ---------------

class ModerationResult:
    __slots__ = ("allowed", "reason")

    def __init__(self, allowed: bool, reason: str = ""):
        self.allowed = allowed
        self.reason = reason


def moderate_chat(text: str, user_id: str) -> ModerationResult:
    """Check a chat message against moderation rules.

    Returns ModerationResult with allowed=True if the message passes,
    or allowed=False with a user-facing reason if blocked.
    """
    # 1. Rate limit
    if not chat_rate_limiter.is_allowed(user_id):
        return ModerationResult(False, "Slow down — you can send 1 message every 2 seconds.")

    # 2. URL check
    if _URL_PATTERN.search(text):
        return ModerationResult(False, "Links are not allowed in chat.")

    # 3. Slur / hate speech (direct match)
    if _SLUR_PATTERN.search(text):
        return ModerationResult(False, "That message contains language that isn't allowed.")

    # 4. Evasion patterns (e.g. n.i.g.g.e.r)
    if _EVASION_PATTERN.search(text):
        return ModerationResult(False, "That message contains language that isn't allowed.")

    return ModerationResult(True)
