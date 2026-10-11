"""Turning a page (ink + typed text) into text the LLM can reason over (PS6 doc §11.1).

* Typed text is exact, so we read it straight from the element list.
* Ink is just coordinates, so the browser renders the page to an image and a vision
  model transcribes it. We pass the typed blocks along so the model only has to
  interpret the handwriting.
* Each transcript is tied to the page's `content_hash`: no edit means no new LLM call.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .llm_adapter import ImagePart, LLMAdapter, TextPart
from .prompts import TRANSCRIBE_SYSTEM


def canonical_elements_json(elements: list[dict[str, Any]]) -> str:
    return json.dumps(elements, sort_keys=True, separators=(",", ":"))


def content_hash(elements: list[dict[str, Any]]) -> str:
    return hashlib.sha256(canonical_elements_json(elements).encode("utf-8")).hexdigest()[:20]


def has_ink(elements: list[dict[str, Any]]) -> bool:
    """True if reading the page needs the vision model: pen/highlighter strokes, or an
    imported image whose text layer is missing (a photo of handwriting, a scanned PDF) or
    incomplete (diagrams and tables pasted as pictures)."""
    for el in elements:
        if el.get("type") == "stroke" and len(el.get("points", [])) > 0:
            return True
        if el.get("type") == "image" and (el.get("needs_vision") or not str(el.get("text", "")).strip()):
            return True
    return False


def typed_blocks(elements: list[dict[str, Any]]) -> list[str]:
    """Typed text boxes in reading order: top-to-bottom, then left-to-right."""
    texts = [el for el in elements if el.get("type") in ("text", "image") and str(el.get("text", "")).strip()]
    texts.sort(key=lambda el: (round(float(el.get("y", 0)) / 20), float(el.get("x", 0))))
    return [str(el["text"]).strip() for el in texts]


def typed_transcript(elements: list[dict[str, Any]]) -> str:
    return "\n\n".join(typed_blocks(elements))


async def transcribe_with_vision(
    llm: LLMAdapter,
    image: ImagePart,
    *,
    title: str,
    blocks: list[str],
    previous_correction: str | None = None,
) -> str:
    prompt = [f'Page title: "{title}"']
    if blocks:
        typed = "\n".join(f"- {block}" for block in blocks)
        prompt.append(f"Typed text blocks on this page (use verbatim):\n{typed}")
    else:
        prompt.append("There are no typed text blocks on this page; everything is handwritten or drawn.")
    if previous_correction:
        prompt.append(
            "The student previously corrected the transcript of an earlier version of this page. "
            "Use it only to resolve hard-to-read words and names, not as content:\n"
            f"{previous_correction[:4000]}"
        )
    parts = [image, TextPart("\n\n".join(prompt))]
    return await llm.generate_text(system=TRANSCRIBE_SYSTEM, parts=parts, temperature=0.0)
