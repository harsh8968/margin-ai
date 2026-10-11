"""Server-side check that the AI's citations really exist in the notes (PS6 doc §11.4).

The model is asked to quote the notes. We don't trust it: every quote is fuzzy-matched
against that page's transcript. Quotes we can't find are dropped, and an answer that
claimed to be "grounded" with nothing verifiable is downgraded to "partial".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from ..schemas import LLMCitation
from .context import PageDoc

_MARKUP = re.compile(r"[*_`#>|$\\]+")
_SPACE = re.compile(r"\s+")
_PAGE_REF = re.compile(r"\[p\.?\s*(\d+)\]", re.IGNORECASE)
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})

FUZZY_THRESHOLD = 0.82
MIN_QUOTE_CHARS = 12  # "the" or "key" must never count as evidence
MIN_QUOTE_WORDS = 2
MAX_QUOTE_CHARS = 400  # bounds the cost of the fuzzy search


@dataclass(frozen=True)
class VerifiedCitation:
    page: int
    page_id: str
    quote: str
    verified: bool


def normalize(text: str) -> str:
    text = text.translate(_QUOTES).lower()
    text = _MARKUP.sub(" ", text)
    text = re.sub(r"[^\w\s'\"=+\-/().,:;%]", " ", text)
    return _SPACE.sub(" ", text).strip(" .,;:")


def quote_in_text(quote: str, page_text: str) -> bool:
    q = normalize(quote)[:MAX_QUOTE_CHARS]
    t = normalize(page_text)
    if len(q) < MIN_QUOTE_CHARS or len(q.split()) < MIN_QUOTE_WORDS or not t:
        return False
    if re.search(rf"(?<!\w){re.escape(q)}(?!\w)", t):
        return True
    if len(q.split()) < 4:
        return False  # short quotes must match exactly
    # Slide a window the size of the quote across the page and keep the best similarity.
    window = len(q)
    step = max(1, window // 4)
    best = 0.0
    for start in range(0, max(1, len(t) - window + 1), step):
        ratio = SequenceMatcher(None, q, t[start : start + window], autojunk=False).ratio()
        best = max(best, ratio)
        if best >= FUZZY_THRESHOLD:
            return True
    return False


def verify_citations(citations: list[LLMCitation], docs: list[PageDoc]) -> list[VerifiedCitation]:
    by_number = {doc.number: doc for doc in docs}
    results: list[VerifiedCitation] = []
    seen: set[tuple[int, str]] = set()
    for citation in citations:
        doc = by_number.get(citation.page)
        if doc is None:
            continue  # cited a page that wasn't in scope: drop it outright
        key = (citation.page, normalize(citation.quote))
        if key in seen:
            continue
        seen.add(key)
        results.append(
            VerifiedCitation(
                page=citation.page,
                page_id=doc.page_id,
                quote=citation.quote.strip(),
                verified=quote_in_text(citation.quote, doc.text),
            )
        )
    return results


def apply_grounding_policy(
    label: str, verified: list[VerifiedCitation], missing_info: str
) -> tuple[str, str]:
    """Return the (possibly downgraded) grounding label and missing-info text."""
    if label == "grounded" and not any(c.verified for c in verified):
        note = "I couldn't verify a supporting quote in your notes, so treat this answer with care."
        return "partial", f"{missing_info} {note}".strip()
    return label, missing_info


def clean_page_refs(markdown: str, valid_pages: set[int]) -> str:
    """Remove inline [p.N] markers that point at pages outside the scope."""

    def keep(match: re.Match[str]) -> str:
        return f"[p.{int(match.group(1))}]" if int(match.group(1)) in valid_pages else ""

    return _PAGE_REF.sub(keep, markdown)
