"""Pure functions behind the adaptive quiz (B2), personalised learning (B5) and
spaced-repetition flashcards (B1). No database or LLM in here, so it's easy to test."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import mean
from typing import Protocol

LEVELS = ("easy", "medium", "hard")
LEVEL_TO_NUMBER = {"easy": 1, "medium": 2, "hard": 3}

WEAK_ACCURACY = 0.6
STRONG_ACCURACY = 0.85
STEP_UP_ABOVE = 0.8
STEP_DOWN_BELOW = 0.5
RECENT_WINDOW = 6

LEITNER_INTERVAL_DAYS = {1: 0, 2: 1, 3: 3, 4: 7, 5: 14}
MAX_BOX = 5


class AttemptLike(Protocol):
    topic: str
    correct: bool
    score: float
    difficulty: int
    source_page: int | None
    answered_at: datetime


@dataclass(frozen=True)
class TopicStat:
    topic: str
    attempts: int
    correct: int
    accuracy: float
    source_pages: tuple[int, ...]


def topic_key(topic: str) -> str:
    return " ".join(topic.strip().lower().split())


def topic_stats(attempts: Iterable[AttemptLike]) -> list[TopicStat]:
    """Accuracy per topic, weakest first. Topic labels are matched case-insensitively."""
    buckets: dict[str, dict] = {}
    for attempt in attempts:
        key = topic_key(attempt.topic) or "general"
        bucket = buckets.setdefault(key, {"label": attempt.topic.strip() or "General", "n": 0, "ok": 0, "score": 0.0, "pages": set()})
        bucket["n"] += 1
        bucket["ok"] += 1 if attempt.correct else 0
        bucket["score"] += attempt.score
        if attempt.source_page:
            bucket["pages"].add(attempt.source_page)
    stats = [
        TopicStat(
            topic=b["label"],
            attempts=b["n"],
            correct=b["ok"],
            accuracy=round(b["score"] / b["n"], 3),
            source_pages=tuple(sorted(b["pages"])),
        )
        for b in buckets.values()
    ]
    return sorted(stats, key=lambda s: (s.accuracy, -s.attempts, s.topic.lower()))


def weak_topics(stats: list[TopicStat]) -> list[TopicStat]:
    return [s for s in stats if s.accuracy < WEAK_ACCURACY]


def strong_topics(stats: list[TopicStat]) -> list[TopicStat]:
    return [s for s in stats if s.accuracy >= STRONG_ACCURACY and s.attempts >= 2]


def adaptive_level(recent_scores: list[float], last_level: str | None) -> tuple[str, str]:
    """Pick the next quiz difficulty from the student's most recent answers.

    Returns (level, human-readable reason) so the UI can explain the choice.
    """
    current = last_level if last_level in LEVELS else "medium"
    if not recent_scores:
        return "medium", "No quiz history yet, so starting at medium."
    window = recent_scores[-RECENT_WINDOW:]
    avg = mean(window)
    index = LEVELS.index(current)
    if avg > STEP_UP_ABOVE and index < len(LEVELS) - 1:
        return LEVELS[index + 1], f"You scored {avg:.0%} on your last {len(window)} answers, so stepping up."
    if avg < STEP_DOWN_BELOW and index > 0:
        return LEVELS[index - 1], f"You scored {avg:.0%} on your last {len(window)} answers, so easing off."
    return current, f"You scored {avg:.0%} on your last {len(window)} answers, so staying at {current}."


def per_topic_targets(stats: list[TopicStat]) -> dict[str, int]:
    """Weak topics get easier questions, mastered topics get harder ones (doc B2)."""
    targets: dict[str, int] = {}
    for stat in stats:
        if stat.accuracy < STEP_DOWN_BELOW:
            targets[stat.topic] = 1
        elif stat.accuracy > STEP_UP_ABOVE:
            targets[stat.topic] = 3
        else:
            targets[stat.topic] = 2
    return targets


def leitner_next(box: int, result: str, now: datetime) -> tuple[int, datetime]:
    """Got it -> next box (longer gap). Missed -> back to box 1, due now."""
    new_box = min(MAX_BOX, box + 1) if result == "got_it" else 1
    return new_box, now + timedelta(days=LEITNER_INTERVAL_DAYS[new_box])
