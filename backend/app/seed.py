"""The demo project "DBMS - Normalization" (doc §21): typed pages, handwritten pages and a
diagram. Handwritten pages ship with a pre-filled transcript so the demo still works if the
network is slow; "Re-read page" in the UI runs the live vision model on them.

BCNF is deliberately NOT in these notes: it's the "not in your notes" demo question.
"""

from __future__ import annotations

import math
from typing import Any

from sqlmodel import Session

from .handwriting import write
from .models import Page, Project
from .repo import set_elements, upsert_transcript

INK = "#1f2a44"
RED = "#b4332e"
BLUE = "#2456a6"
HIGHLIGHT = "#f6d32d"
LEFT = 130


def _text(eid: str, x: float, y: float, text: str, *, size: float = 28, width: float = 980, color: str = INK) -> dict[str, Any]:
    return {"id": eid, "type": "text", "x": x, "y": y, "width": width, "text": text, "font_size": size, "color": color}


def _box(eid: str, x: float, y: float, w: float, h: float, color: str = INK) -> dict[str, Any]:
    pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y + 2]]
    dense: list[list[float]] = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        for i in range(12):
            dense.append([round(x0 + (x1 - x0) * i / 12, 1), round(y0 + (y1 - y0) * i / 12, 1), 0.55])
    return {"id": eid, "type": "stroke", "tool": "pen", "points": dense, "color": color, "size": 4, "opacity": 1}


def _arrow(eid: str, x0: float, y0: float, x1: float, y1: float, color: str = INK) -> list[dict[str, Any]]:
    shaft = [[round(x0 + (x1 - x0) * i / 16, 1), round(y0 + (y1 - y0) * i / 16, 1), 0.55] for i in range(17)]
    angle = math.atan2(y1 - y0, x1 - x0)
    head = []
    for side in (-1, 1):
        a = angle + math.pi - side * 0.45
        head.append([round(x1 + 22 * math.cos(a), 1), round(y1 + 22 * math.sin(a), 1), 0.55])
    tip = [head[0], [x1, y1, 0.55], head[1]]
    return [
        {"id": f"{eid}-shaft", "type": "stroke", "tool": "pen", "points": shaft, "color": color, "size": 4, "opacity": 1},
        {"id": f"{eid}-head", "type": "stroke", "tool": "pen", "points": tip, "color": color, "size": 4, "opacity": 1},
    ]


def _highlight(eid: str, x0: float, x1: float, y: float) -> dict[str, Any]:
    pts = [[round(x0 + (x1 - x0) * i / 20, 1), y, 0.5] for i in range(21)]
    return {"id": eid, "type": "stroke", "tool": "highlighter", "points": pts, "color": HIGHLIGHT, "size": 30, "opacity": 0.35}


def _page_intro() -> tuple[list[dict[str, Any]], str | None]:
    return [
        _text("t1", LEFT, 150, "DBMS Unit 3 - Normalization", size=46, color=BLUE),
        _text("t2", LEFT, 250, "Normalization is the process of organizing a relational database to reduce redundancy "
              "and avoid update, insert and delete anomalies. We split big tables into smaller ones and link them with keys."),
        _text("t3", LEFT, 430, "Anomalies:\n- Insert anomaly: you can't add a fact without adding unrelated data.\n"
              "- Update anomaly: the same fact is stored in many rows, so one change must be made everywhere.\n"
              "- Delete anomaly: deleting a row also deletes other facts you wanted to keep."),
        _text("t4", LEFT, 760, "Normal forms covered in this unit: 1NF, 2NF and 3NF."),
    ], None


def _page_1nf_2nf() -> tuple[list[dict[str, Any]], str]:
    lines = [
        ("1NF: EVERY CELL HOLDS ONE ATOMIC VALUE", INK),
        ("NO REPEATING GROUPS", INK),
        ("2NF: IN 1NF + NO PARTIAL DEPENDENCY", RED),
        ("PARTIAL DEPENDENCY = A NON-KEY ATTRIBUTE DEPENDS ON ONLY PART OF A COMPOSITE KEY", INK),
    ]
    elements: list[dict[str, Any]] = []
    y = 170.0
    for i, (line, color) in enumerate(lines):
        strokes, y = write(line, LEFT, y, cap=34, color=color, seed=11 + i, id_prefix=f"p2l{i}")
        elements.extend(strokes)
        y += 30
    elements.append(_text("t1", LEFT, y + 40, "Tip: 2NF only matters when the primary key is composite.", size=26, color=BLUE))
    transcript = (
        "1NF: every cell holds one atomic value\n\nNo repeating groups\n\n"
        "**2NF: in 1NF + no partial dependency**\n\n"
        "Partial dependency = a non-key attribute depends on only part of a composite key\n\n"
        "Tip: 2NF only matters when the primary key is composite."
    )
    return elements, transcript


def _page_3nf() -> tuple[list[dict[str, Any]], str]:
    elements: list[dict[str, Any]] = [_highlight("hl1", LEFT + 250, LEFT + 1000, 205)]
    y = 170.0
    lines = [
        "3NF: IN 2NF + NO TRANSITIVE DEPENDENCY",
        "TRANSITIVE: A > B AND B > C SO A > C",
        "FIX: MOVE B AND C INTO A NEW TABLE",
        "KEY IDEA: EVERY NON-KEY ATTRIBUTE DEPENDS ON THE KEY, THE WHOLE KEY AND NOTHING BUT THE KEY",
    ]
    for i, line in enumerate(lines):
        strokes, y = write(line, LEFT, y, cap=34, seed=31 + i, id_prefix=f"p3l{i}")
        elements.extend(strokes)
        y += 30
    transcript = (
        "3NF: in 2NF + no transitive dependency (highlighted)\n\n"
        "Transitive: A → B and B → C so A → C\n\n"
        "Fix: move B and C into a new table\n\n"
        "Key idea: every non-key attribute depends on the key, the whole key and nothing but the key"
    )
    return elements, transcript


def _page_fd() -> tuple[list[dict[str, Any]], str]:
    elements: list[dict[str, Any]] = [
        _text("t1", LEFT, 150, "Functional dependencies", size=40, color=BLUE),
        _text("t2", LEFT, 230, "A functional dependency X -> Y means the value of X decides the value of Y. "
              "If two rows have the same X, they must have the same Y."),
        _text("t3", LEFT, 380, "Example: RollNo -> Name and RollNo -> Dept"),
        _box("b1", 170, 520, 240, 110),
        _box("b2", 700, 470, 240, 100),
        _box("b3", 700, 640, 240, 100),
    ]
    elements += _arrow("a1", 410, 560, 695, 520)
    elements += _arrow("a2", 410, 595, 695, 690)
    for label, (x, y), seed in (("ROLLNO", (205, 552), 51), ("NAME", (755, 498), 52), ("DEPT", (760, 668), 53)):
        strokes, _ = write(label, x, y, cap=34, seed=seed, id_prefix=f"lbl{seed}")
        elements.extend(strokes)
    transcript = (
        "# Functional dependencies\n\n"
        "A functional dependency X -> Y means the value of X decides the value of Y. "
        "If two rows have the same X, they must have the same Y.\n\n"
        "Example: RollNo -> Name and RollNo -> Dept\n\n"
        "[Diagram: a box labelled ROLLNO with two arrows pointing to boxes labelled NAME and DEPT]"
    )
    return elements, transcript


def _page_example() -> tuple[list[dict[str, Any]], str | None]:
    return [
        _text("t1", LEFT, 150, "Worked example: Student table", size=40, color=BLUE),
        _text("t2", LEFT, 230, "Student(RollNo, CourseID, Name, CourseName, Dept, HOD)\nKey: (RollNo, CourseID)"),
        _text("t3", LEFT, 360, "- Name depends only on RollNo, which is part of the key, so this is a partial dependency "
              "and the table violates 2NF.\n- CourseName depends only on CourseID: another partial dependency.\n"
              "- HOD depends on Dept, and Dept depends on RollNo: a transitive dependency, so it violates 3NF."),
        _text("t4", LEFT, 680, "Decomposition into 3NF:\nStudent(RollNo, Name, Dept)\nCourse(CourseID, CourseName)\n"
              "Enrolment(RollNo, CourseID)\nDepartment(Dept, HOD)"),
    ], None


def _page_draft() -> tuple[list[dict[str, Any]], str | None]:
    return [
        _text("t1", LEFT, 150, "Exam answer draft", size=40, color=BLUE),
        _text("t2", LEFT, 230, "Q. what is normalisation and why its needed?"),
        _text("t3", LEFT, 300, "ans: normalisation is when we break table in to smaller table so data is not repeated. "
              "its needed becuase otherwise we get anomalys like update anomaly where same data is in many place and "
              "we forget to change one of them. also it save space and the database is more consistant."),
    ], None


PAGES = [
    ("Introduction", "ruled", _page_intro),
    ("1NF and 2NF", "ruled", _page_1nf_2nf),
    ("3NF", "ruled", _page_3nf),
    ("Functional dependencies", "grid", _page_fd),
    ("Worked example", "ruled", _page_example),
    ("Exam answer draft", "ruled", _page_draft),
]


def seed_demo_project(session: Session, name: str = "DBMS - Normalization") -> Project:
    project = Project(name=name)
    session.add(project)
    session.flush()
    for order, (title, background, build) in enumerate(PAGES):
        elements, transcript = build()
        page = Page(project_id=project.id, title=title, order=order, background=background)
        set_elements(page, elements)
        session.add(page)
        session.flush()
        if transcript is not None:
            upsert_transcript(session, page, transcript, source="seed")
    session.commit()
    session.refresh(project)
    return project
