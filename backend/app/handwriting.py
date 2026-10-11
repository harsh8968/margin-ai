"""A tiny single-stroke "handwriting" font for the demo project.

Each glyph is a few polylines in a box 1 unit tall (y grows downward). We add slant,
wobble and pressure jitter so the result looks hand-drawn, then emit real pen strokes,
the same kind the canvas records. That gives the seed project genuine ink for the
vision model to read.
"""

from __future__ import annotations

import math
import random
from typing import Any

Glyph = tuple[float, list[list[tuple[float, float]]]]  # (advance width, strokes)


def _ellipse(cx: float, cy: float, rx: float, ry: float, steps: int = 18) -> list[tuple[float, float]]:
    return [(cx + rx * math.sin(2 * math.pi * i / steps), cy - ry * math.cos(2 * math.pi * i / steps)) for i in range(steps + 1)]


GLYPHS: dict[str, Glyph] = {
    "A": (0.6, [[(0, 1), (0.3, 0), (0.6, 1)], [(0.12, 0.6), (0.48, 0.6)]]),
    "B": (0.55, [[(0, 0), (0, 1)], [(0, 0), (0.4, 0), (0.5, 0.1), (0.5, 0.38), (0.4, 0.48), (0, 0.48)],
                 [(0.4, 0.48), (0.55, 0.6), (0.55, 0.88), (0.42, 1), (0, 1)]]),
    "C": (0.55, [[(0.55, 0.15), (0.42, 0.02), (0.25, 0), (0.1, 0.08), (0, 0.3), (0, 0.7), (0.1, 0.92), (0.25, 1), (0.42, 0.98), (0.55, 0.85)]]),
    "D": (0.58, [[(0, 0), (0, 1)], [(0, 0), (0.3, 0), (0.5, 0.15), (0.58, 0.5), (0.5, 0.85), (0.3, 1), (0, 1)]]),
    "E": (0.5, [[(0.5, 0), (0, 0), (0, 1), (0.5, 1)], [(0, 0.5), (0.4, 0.5)]]),
    "F": (0.5, [[(0.5, 0), (0, 0), (0, 1)], [(0, 0.5), (0.4, 0.5)]]),
    "G": (0.6, [[(0.55, 0.15), (0.42, 0.02), (0.25, 0), (0.1, 0.08), (0, 0.3), (0, 0.7), (0.1, 0.92), (0.25, 1), (0.45, 0.97),
                 (0.58, 0.85), (0.58, 0.55), (0.32, 0.55)]]),
    "H": (0.55, [[(0, 0), (0, 1)], [(0.55, 0), (0.55, 1)], [(0, 0.5), (0.55, 0.5)]]),
    "I": (0.3, [[(0, 0), (0.3, 0)], [(0.15, 0), (0.15, 1)], [(0, 1), (0.3, 1)]]),
    "J": (0.5, [[(0.5, 0), (0.5, 0.8), (0.4, 0.97), (0.25, 1), (0.1, 0.95), (0, 0.8)]]),
    "K": (0.55, [[(0, 0), (0, 1)], [(0.5, 0), (0, 0.55)], [(0.15, 0.42), (0.55, 1)]]),
    "L": (0.45, [[(0, 0), (0, 1), (0.45, 1)]]),
    "M": (0.66, [[(0, 1), (0, 0), (0.33, 0.6), (0.66, 0), (0.66, 1)]]),
    "N": (0.55, [[(0, 1), (0, 0), (0.55, 1), (0.55, 0)]]),
    "O": (0.6, [_ellipse(0.3, 0.5, 0.3, 0.5)]),
    "P": (0.52, [[(0, 1), (0, 0), (0.4, 0), (0.52, 0.1), (0.52, 0.4), (0.4, 0.5), (0, 0.5)]]),
    "Q": (0.62, [_ellipse(0.3, 0.5, 0.3, 0.5), [(0.35, 0.75), (0.62, 1.02)]]),
    "R": (0.55, [[(0, 1), (0, 0), (0.4, 0), (0.52, 0.1), (0.52, 0.4), (0.4, 0.5), (0, 0.5)], [(0.25, 0.5), (0.55, 1)]]),
    "S": (0.53, [[(0.52, 0.12), (0.4, 0.02), (0.2, 0), (0.05, 0.1), (0.03, 0.28), (0.15, 0.42), (0.4, 0.55), (0.53, 0.7),
                  (0.52, 0.88), (0.38, 1), (0.15, 1), (0, 0.88)]]),
    "T": (0.6, [[(0, 0), (0.6, 0)], [(0.3, 0), (0.3, 1)]]),
    "U": (0.55, [[(0, 0), (0, 0.75), (0.1, 0.95), (0.28, 1), (0.45, 0.95), (0.55, 0.75), (0.55, 0)]]),
    "V": (0.6, [[(0, 0), (0.3, 1), (0.6, 0)]]),
    "W": (0.72, [[(0, 0), (0.18, 1), (0.36, 0.35), (0.54, 1), (0.72, 0)]]),
    "X": (0.55, [[(0, 0), (0.55, 1)], [(0.55, 0), (0, 1)]]),
    "Y": (0.6, [[(0, 0), (0.3, 0.5), (0.6, 0)], [(0.3, 0.5), (0.3, 1)]]),
    "Z": (0.55, [[(0, 0), (0.55, 0), (0, 1), (0.55, 1)]]),
    "0": (0.5, [_ellipse(0.25, 0.5, 0.25, 0.5)]),
    "1": (0.35, [[(0.05, 0.2), (0.25, 0), (0.25, 1)]]),
    "2": (0.52, [[(0.02, 0.2), (0.12, 0.05), (0.3, 0), (0.45, 0.08), (0.5, 0.25), (0.42, 0.45), (0, 1), (0.52, 1)]]),
    "3": (0.53, [[(0.02, 0.1), (0.2, 0), (0.4, 0.02), (0.5, 0.15), (0.45, 0.38), (0.25, 0.48)],
                 [(0.25, 0.48), (0.48, 0.6), (0.53, 0.82), (0.4, 0.98), (0.2, 1), (0, 0.9)]]),
    "4": (0.55, [[(0.4, 1), (0.4, 0), (0, 0.7), (0.55, 0.7)]]),
    "5": (0.52, [[(0.5, 0), (0.08, 0), (0.03, 0.45), (0.25, 0.4), (0.45, 0.5), (0.52, 0.72), (0.45, 0.92), (0.25, 1), (0, 0.92)]]),
    "6": (0.52, [[(0.45, 0.05), (0.25, 0), (0.08, 0.15), (0, 0.5), (0.03, 0.85), (0.2, 1), (0.4, 0.97), (0.52, 0.8), (0.5, 0.6),
                  (0.35, 0.48), (0.15, 0.5), (0.02, 0.62)]]),
    "7": (0.55, [[(0, 0), (0.55, 0), (0.2, 1)]]),
    "8": (0.52, [[(0.27, 0.48), (0.08, 0.38), (0.05, 0.15), (0.27, 0), (0.48, 0.15), (0.45, 0.38), (0.27, 0.48), (0.05, 0.62),
                  (0.02, 0.85), (0.27, 1), (0.52, 0.85), (0.49, 0.62), (0.27, 0.48)]]),
    "9": (0.52, [[(0.5, 0.4), (0.35, 0.5), (0.12, 0.48), (0.02, 0.3), (0.08, 0.08), (0.27, 0), (0.45, 0.08), (0.52, 0.35),
                  (0.48, 0.75), (0.3, 1), (0.08, 0.95)]]),
    ".": (0.15, [[(0.04, 0.94), (0.08, 1)]]),
    ",": (0.15, [[(0.08, 0.9), (0.03, 1.12)]]),
    ":": (0.15, [[(0.04, 0.3), (0.08, 0.36)], [(0.04, 0.94), (0.08, 1)]]),
    "-": (0.35, [[(0, 0.55), (0.3, 0.55)]]),
    "+": (0.45, [[(0, 0.55), (0.4, 0.55)], [(0.2, 0.35), (0.2, 0.75)]]),
    "=": (0.45, [[(0, 0.45), (0.4, 0.45)], [(0, 0.68), (0.4, 0.68)]]),
    "(": (0.25, [[(0.22, 0), (0.06, 0.25), (0.02, 0.5), (0.06, 0.75), (0.22, 1)]]),
    ")": (0.25, [[(0.03, 0), (0.19, 0.25), (0.23, 0.5), (0.19, 0.75), (0.03, 1)]]),
    "/": (0.4, [[(0.38, 0), (0, 1)]]),
    "'": (0.12, [[(0.05, 0), (0.04, 0.25)]]),
    "?": (0.45, [[(0.02, 0.18), (0.15, 0.02), (0.32, 0), (0.45, 0.15), (0.42, 0.35), (0.22, 0.5), (0.22, 0.72)], [(0.21, 0.95), (0.24, 1)]]),
    "!": (0.15, [[(0.07, 0), (0.07, 0.72)], [(0.06, 0.95), (0.09, 1)]]),
    ">": (0.6, [[(0, 0.55), (0.58, 0.55)], [(0.42, 0.38), (0.6, 0.55), (0.42, 0.72)]]),  # drawn as an arrow
}
SPACE = 0.42
LETTER_GAP = 0.16
LINE_HEIGHT = 1.75


def _densify(points: list[tuple[float, float]], step: float) -> list[tuple[float, float]]:
    out = [points[0]]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        out.extend((x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(1, n + 1))
    return out


def text_width(text: str, cap: float) -> float:
    total = 0.0
    for ch in text.upper():
        total += (SPACE if ch == " " else GLYPHS.get(ch, (SPACE, []))[0] + LETTER_GAP) * cap
    return total


def write(
    text: str,
    x: float,
    y: float,
    *,
    cap: float = 34,
    color: str = "#1f2a44",
    size: float = 4.5,
    max_width: float = 1080,
    seed: int = 7,
    id_prefix: str = "hw",
) -> tuple[list[dict[str, Any]], float]:
    """Lay out `text` as hand-drawn strokes. Returns (stroke elements, y below the last line)."""
    rng = random.Random(seed)
    strokes: list[dict[str, Any]] = []
    lines: list[str] = []
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split(" "):
            candidate = f"{line} {word}".strip()
            if line and text_width(candidate, cap) > max_width:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)

    baseline_y = y
    for line in lines:
        cursor = x + rng.uniform(-4, 4)
        drift = rng.uniform(-0.02, 0.02)  # lines are never perfectly level
        for ch in line.upper():
            if ch == " ":
                cursor += SPACE * cap
                continue
            advance, polylines = GLYPHS.get(ch, (SPACE, []))
            scale = cap * rng.uniform(0.94, 1.06)
            lift = rng.uniform(-0.04, 0.04) * cap + drift * (cursor - x)
            for poly in polylines:
                pts = _densify(poly, 0.06)
                points = []
                for px, py in pts:
                    slant = (1 - py) * 0.13
                    wx = cursor + (px + slant) * scale + rng.uniform(-0.6, 0.6)
                    wy = baseline_y + py * scale + lift + rng.uniform(-0.6, 0.6)
                    points.append([round(wx, 1), round(wy, 1), round(rng.uniform(0.45, 0.62), 2)])
                strokes.append(
                    {"id": f"{id_prefix}-{len(strokes)}", "type": "stroke", "tool": "pen", "points": points,
                     "color": color, "size": size, "opacity": 1}
                )
            cursor += (advance + LETTER_GAP) * cap
        baseline_y += cap * LINE_HEIGHT
    return strokes, baseline_y
