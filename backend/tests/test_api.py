"""Integration tests through the HTTP API with a scripted LLM."""

from app.schemas import (
    AskOutput,
    FlashcardOut,
    FlashcardsOutput,
    GeneralOutput,
    GradeOutput,
    LLMCitation,
    QuizOutput,
    QuizQuestionOut,
    RefineOutput,
    SummaryOutput,
)

from .conftest import TINY_PNG, data, stroke_el, text_el

PHOTO = "Photosynthesis converts light energy into chemical energy in the chloroplast."
RESP = "Respiration releases energy from glucose in the mitochondria."


# --------------------------------------------------------------------------- projects & pages


def test_project_lifecycle_and_page_order(client):
    project = data(client.post("/api/projects", json={"name": "  DBMS  "}))
    assert project["name"] == "DBMS" and project["page_count"] == 1
    pid = project["id"]
    first = data(client.get(f"/api/projects/{pid}/pages"))[0]
    second = data(client.post(f"/api/projects/{pid}/pages", json={"title": "Two"}))
    inserted = data(client.post(f"/api/projects/{pid}/pages", json={"title": "Between", "after_page_id": first["id"]}))
    titles = [p["title"] for p in data(client.get(f"/api/projects/{pid}/pages"))]
    assert titles == ["Page 1", "Between", "Two"]

    data(client.put(f"/api/projects/{pid}/pages/order", json={"page_ids": [second["id"], first["id"], inserted["id"]]}))
    pages = data(client.get(f"/api/projects/{pid}/pages"))
    assert [p["title"] for p in pages] == ["Two", "Page 1", "Between"]
    assert [p["number"] for p in pages] == [1, 2, 3]

    data(client.patch(f"/api/projects/{pid}", json={"name": "DBMS Unit 3"}))
    assert data(client.get(f"/api/projects/{pid}"))["project"]["name"] == "DBMS Unit 3"


def test_reorder_rejects_incomplete_list(client, make_project):
    pid, pages = make_project("a", "b")
    response = client.put(f"/api/projects/{pid}/pages/order", json={"page_ids": [pages[0]["id"]]})
    assert response.status_code == 400
    assert response.json() == {"success": False, "data": None, "error": "page_ids must list every page of the project exactly once"}


def test_soft_delete_and_restore_keeps_position(client, make_project):
    pid, pages = make_project("a", "b", "c")
    data(client.delete(f"/api/pages/{pages[1]['id']}"))
    assert [p["id"] for p in data(client.get(f"/api/projects/{pid}/pages"))] == [pages[0]["id"], pages[2]["id"]]
    restored = data(client.post(f"/api/pages/{pages[1]['id']}/restore"))
    assert restored["number"] == 2
    assert [p["id"] for p in data(client.get(f"/api/projects/{pid}/pages"))] == [p["id"] for p in pages]


def test_cannot_delete_last_page(client, make_project):
    _, pages = make_project("only")
    assert client.delete(f"/api/pages/{pages[0]['id']}").status_code == 400


def test_page_elements_round_trip_and_hash_changes(client, make_project):
    _, pages = make_project("hello")
    page_id = pages[0]["id"]
    before = data(client.get(f"/api/pages/{page_id}"))["content_hash"]
    saved = data(client.patch(f"/api/pages/{page_id}", json={"elements": [text_el("t0", "hello"), stroke_el()]}))
    assert saved["content_hash"] != before
    page = data(client.get(f"/api/pages/{page_id}"))
    assert [e["type"] for e in page["elements"]] == ["text", "stroke"]


def test_invalid_elements_are_rejected(client, make_project):
    _, pages = make_project("x")
    bad = {"elements": [{"id": "z", "type": "laser", "points": []}]}
    response = client.patch(f"/api/pages/{pages[0]['id']}", json=bad)
    assert response.status_code == 422 and response.json()["success"] is False


def test_deleting_project_removes_pages(client, make_project):
    pid, pages = make_project("a")
    data(client.delete(f"/api/projects/{pid}"))
    assert client.get(f"/api/pages/{pages[0]['id']}").status_code == 404
    assert client.get(f"/api/projects/{pid}").json()["error"] == "Project not found"


# --------------------------------------------------------------------------- transcripts


def test_typed_pages_are_transcribed_without_the_llm(client, llm, make_project):
    pid, _ = make_project(PHOTO)
    statuses = data(client.get(f"/api/projects/{pid}/transcripts"))
    assert statuses[0]["transcript_md"] == PHOTO and statuses[0]["source"] == "typed" and not statuses[0]["stale"]
    assert llm.calls == []


def test_ink_page_needs_vision_and_stale_hash_is_refused(client, llm, make_project):
    pid, pages = make_project("")
    page_id = pages[0]["id"]
    saved = data(client.patch(f"/api/pages/{page_id}", json={"elements": [stroke_el(), text_el("t", "Typed title")]}))
    assert data(client.get(f"/api/projects/{pid}/transcripts"))[0]["stale"] is True

    stale = client.post(f"/api/pages/{page_id}/transcribe", json={"image": TINY_PNG, "content_hash": "old"})
    assert stale.status_code == 409

    llm.queue_text("Handwritten: mitochondria make ATP")
    out = data(client.post(f"/api/pages/{page_id}/transcribe", json={"image": TINY_PNG, "content_hash": saved["content_hash"]}))
    assert out["transcript_md"] == "Handwritten: mitochondria make ATP" and out["stale"] is False
    assert "Typed title" in llm.prompt_text()  # typed blocks are passed verbatim to the vision model


def test_student_correction_is_kept_and_fed_to_the_next_read(client, llm, make_project):
    _, pages = make_project("")
    page_id = pages[0]["id"]
    data(client.patch(f"/api/pages/{page_id}", json={"elements": [stroke_el("s1")]}))
    corrected = data(client.put(f"/api/pages/{page_id}/transcript", json={"transcript_md": "Mitochondria"}))
    assert corrected["user_corrected"] is True and corrected["stale"] is False

    saved = data(client.patch(f"/api/pages/{page_id}", json={"elements": [stroke_el("s1"), stroke_el("s2")]}))
    llm.queue_text("new reading")
    data(client.post(f"/api/pages/{page_id}/transcribe", json={"image": TINY_PNG, "content_hash": saved["content_hash"]}))
    assert "Mitochondria" in llm.prompt_text()


# --------------------------------------------------------------------------- grounded Q&A


def test_grounded_answer_keeps_verified_citations(client, llm, make_project):
    pid, pages = make_project(PHOTO, RESP)
    llm.queue(AskOutput(answer_markdown="Light energy becomes chemical energy [p.1] [p.7]",
                        citations=[LLMCitation(page=1, quote="converts light energy into chemical energy")],
                        grounding="grounded", missing_info=""))
    out = data(client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[1]["id"], "scope": "project",
                                                "question": "What does photosynthesis do?"}))
    assert out["grounding"] == "grounded"
    assert out["citations"] == [{"page": 1, "page_id": pages[0]["id"], "quote": "converts light energy into chemical energy"}]
    assert "[p.7]" not in out["answer_markdown"]
    prompt = llm.prompt_text()
    assert prompt.index('n="2"') < prompt.index('n="1"') and 'current="true"' in prompt


def test_fabricated_quote_is_dropped_and_answer_downgraded(client, llm, make_project):
    pid, pages = make_project(PHOTO)
    llm.queue(AskOutput(answer_markdown="It makes oxygen [p.1]",
                        citations=[LLMCitation(page=1, quote="releases oxygen as a by-product of splitting water")],
                        grounding="grounded", missing_info=""))
    out = data(client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[0]["id"], "question": "oxygen?"}))
    assert out["grounding"] == "partial" and out["citations"] == [] and out["dropped_citations"] == 1


def test_not_in_notes_returns_no_answer(client, llm, make_project):
    pid, pages = make_project(PHOTO)
    llm.queue(AskOutput(answer_markdown="BCNF is ...", citations=[], grounding="not_in_notes",
                        missing_info="Your notes don't define BCNF."))
    out = data(client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[0]["id"], "question": "What is BCNF?"}))
    assert out["grounding"] == "not_in_notes" and out["answer_markdown"] == ""
    assert out["missing_info"] == "Your notes don't define BCNF."


def test_empty_page_short_circuits_without_llm(client, llm, make_project):
    pid, pages = make_project("")
    out = data(client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[0]["id"], "scope": "page", "question": "?"}))
    assert out["grounding"] == "not_in_notes" and llm.calls == []


def test_page_scope_only_sends_the_current_page(client, llm, make_project):
    pid, pages = make_project(PHOTO, RESP)
    llm.queue(AskOutput(answer_markdown="x", citations=[], grounding="partial", missing_info="m"))
    data(client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[1]["id"], "scope": "page", "question": "q"}))
    prompt = llm.prompt_text()
    assert "mitochondria" in prompt and "chloroplast" not in prompt


def test_general_knowledge_is_labelled(client, llm, make_project):
    pid, pages = make_project(PHOTO)
    llm.queue(GeneralOutput(answer_markdown="BCNF is a stricter 3NF."))
    out = data(client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[0]["id"], "question": "BCNF?",
                                                "allow_general": True}))
    assert out["grounding"] == "general" and out["citations"] == []
    history = data(client.get(f"/api/projects/{pid}/chat"))
    assert [m["role"] for m in history] == ["user", "assistant"] and history[1]["grounding"] == "general"


def test_selection_scope_sends_the_selection(client, llm, make_project):
    pid, pages = make_project(PHOTO)
    llm.queue(AskOutput(answer_markdown="x", citations=[], grounding="partial", missing_info=""))
    data(client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[0]["id"], "scope": "selection",
                                          "question": "Explain", "mode": "explain",
                                          "selection": {"image": TINY_PNG, "text_blocks": ["chloroplast"]}}))
    call = llm.calls[-1]
    assert "<selection>" in llm.prompt_text() and any(getattr(p, "mime_type", None) == "image/png" for p in call["parts"])
    assert "What your notes say" in call["system"]


def test_bad_selection_image_is_a_400(client, make_project):
    pid, pages = make_project(PHOTO)
    response = client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[0]["id"], "scope": "selection",
                                                "question": "q", "selection": {"image": "data:image/png;base64,???"}})
    assert response.status_code == 400


# --------------------------------------------------------------------------- summary & refine


def test_summary_filters_pages(client, llm, make_project):
    pid, pages = make_project(PHOTO, RESP)
    llm.queue(SummaryOutput(summary_markdown="- photo [p.1]\n- resp [p.2] [p.5]", pages_used=[1, 2, 5]))
    out = data(client.post("/api/ai/summarize", json={"project_id": pid, "page_id": pages[0]["id"], "scope": "project"}))
    assert [p["page"] for p in out["pages_used"]] == [1, 2] and "[p.5]" not in out["summary_markdown"]


def test_refine_returns_a_proposal_and_never_changes_the_page(client, llm, make_project):
    pid, pages = make_project("teh cell is basic unit")
    before = data(client.get(f"/api/pages/{pages[0]['id']}"))
    llm.queue(RefineOutput(original_reading="teh cell is basic unit", proposed_markdown="The cell is the basic unit.",
                           change_summary="Fixed spelling"))
    out = data(client.post("/api/ai/refine", json={"project_id": pid, "page_id": pages[0]["id"], "action": "grammar"}))
    assert out["proposed_markdown"] == "The cell is the basic unit."
    assert data(client.get(f"/api/pages/{pages[0]['id']}"))["content_hash"] == before["content_hash"]
    assert "Fix spelling, grammar and punctuation ONLY" in llm.prompt_text()


# --------------------------------------------------------------------------- quiz


def _questions():
    return QuizOutput(questions=[
        QuizQuestionOut(type="mcq", question="Where?", options=["Chloroplast", "Nucleus", "Ribosome", "Wall"], answer="A",
                        explanation="p.1", source_page=1, topic="Photosynthesis", difficulty=1),
        QuizQuestionOut(type="tf", question="It makes chemical energy", options=[], answer="true",
                        explanation="p.1", source_page=9, topic="Photosynthesis", difficulty=1),
        QuizQuestionOut(type="mcq", question="Broken", options=["a", "b", "c", "d"], answer="z",
                        explanation="", source_page=1, topic="x", difficulty=1),
        QuizQuestionOut(type="short", question="Explain photosynthesis", options=["junk"], answer=PHOTO,
                        explanation="p.1", source_page=1, topic="Photosynthesis", difficulty=2),
    ])


def test_quiz_generation_repairs_and_filters_questions(client, llm, make_project):
    pid, pages = make_project(PHOTO)
    llm.queue(_questions())
    quiz = data(client.post("/api/ai/quiz", json={"project_id": pid, "page_id": pages[0]["id"], "count": 5}))
    questions = quiz["questions"]
    assert [q["type"] for q in questions] == ["mcq", "tf", "short"]  # the broken mcq was dropped
    assert questions[1]["options"] == ["True", "False"] and questions[1]["source_page"] == 1
    assert questions[2]["options"] == []
    assert "answer" not in questions[0]  # answers stay on the server


def test_answering_records_attempts_and_feeds_insights(client, llm, make_project):
    pid, pages = make_project(PHOTO)
    llm.queue(_questions())
    quiz = data(client.post("/api/ai/quiz", json={"project_id": pid, "page_id": pages[0]["id"]}))
    qid = quiz["quiz_id"]
    right = data(client.post(f"/api/ai/quiz/{qid}/answer", json={"question_index": 0, "user_answer": "chloroplast"}))
    assert right["correct"] is True and right["correct_answer"] == "Chloroplast"
    wrong = data(client.post(f"/api/ai/quiz/{qid}/answer", json={"question_index": 1, "user_answer": "False"}))
    assert wrong["correct"] is False and wrong["score"] == 0

    llm.queue(GradeOutput(score=0.5, verdict="partial", feedback="Good start", missing_points=["chemical energy"]))
    short = data(client.post(f"/api/ai/quiz/{qid}/answer", json={"question_index": 2, "user_answer": "uses light"}))
    assert short["verdict"] == "partial" and short["missing_points"] == ["chemical energy"]

    again = data(client.post(f"/api/ai/quiz/{qid}/answer", json={"question_index": 0, "user_answer": "Nucleus"}))
    assert again["correct"] is True  # first answer counts; no double recording

    stats = data(client.get(f"/api/projects/{pid}/insights"))
    assert stats["total_answers"] == 3
    assert stats["topics"][0]["topic"] == "Photosynthesis" and stats["topics"][0]["accuracy"] == 0.5
    assert stats["weak_topics"][0]["topic"] == "Photosynthesis"


def test_adaptive_quiz_steps_down_and_targets_weak_topics(client, llm, make_project):
    pid, pages = make_project(PHOTO)
    llm.queue(_questions())
    qid = data(client.post("/api/ai/quiz", json={"project_id": pid, "page_id": pages[0]["id"]}))["quiz_id"]
    data(client.post(f"/api/ai/quiz/{qid}/answer", json={"question_index": 0, "user_answer": "Nucleus"}))
    data(client.post(f"/api/ai/quiz/{qid}/answer", json={"question_index": 1, "user_answer": "False"}))

    llm.queue(_questions())
    adaptive = data(client.post("/api/ai/quiz", json={"project_id": pid, "page_id": pages[0]["id"], "difficulty": "adaptive"}))
    assert adaptive["difficulty"] == "easy" and "easing off" in adaptive["adaptive_reason"]
    assert adaptive["focus_topics"] == ["Photosynthesis"]
    assert "Weak topics" in llm.prompt_text()


# --------------------------------------------------------------------------- flashcards, revision, seed


def test_flashcards_dedupe_and_leitner_review(client, llm, make_project):
    pid, pages = make_project(PHOTO)
    card = FlashcardOut(front="Where does photosynthesis happen?", back="Chloroplast", source_page=1, topic="Photo")
    llm.queue(FlashcardsOutput(cards=[card, card]))
    created = data(client.post("/api/ai/flashcards", json={"project_id": pid, "page_id": pages[0]["id"]}))["created"]
    assert len(created) == 1
    llm.queue(FlashcardsOutput(cards=[card]))
    assert data(client.post("/api/ai/flashcards", json={"project_id": pid}))["created"] == []

    reviewed = data(client.post(f"/api/flashcards/{created[0]['id']}/review", json={"result": "got_it"}))
    assert reviewed["box"] == 2
    missed = data(client.post(f"/api/flashcards/{created[0]['id']}/review", json={"result": "missed"}))
    assert missed["box"] == 1
    assert len(data(client.get(f"/api/projects/{pid}/flashcards"))) == 1


def test_seed_project_has_ink_and_pretranscribed_pages(client, llm):
    project = data(client.post("/api/demo/seed"))
    assert project["page_count"] == 6
    statuses = data(client.get(f"/api/projects/{project['id']}/transcripts"))
    assert all(not s["stale"] for s in statuses)
    assert [s["has_ink"] for s in statuses] == [False, True, True, True, False, False]
    assert all("BCNF" not in (s["transcript_md"] or "") for s in statuses)
    assert llm.calls == []


def test_health_reports_the_adapter(client):
    assert data(client.get("/api/health"))["llm"] == "scripted"


def test_page_scope_ignores_history_from_other_scopes(client, llm, make_project):
    pid, pages = make_project(PHOTO, RESP)
    llm.queue(AskOutput(answer_markdown="x", citations=[], grounding="partial", missing_info=""))
    history = [
        {"role": "user", "content": "project question", "scope": "project", "page_id": pages[0]["id"]},
        {"role": "assistant", "content": "SECRET FROM PAGE ONE", "scope": "project", "page_id": pages[0]["id"]},
        {"role": "user", "content": "same page earlier", "scope": "page", "page_id": pages[1]["id"]},
    ]
    data(client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[1]["id"], "scope": "page",
                                          "question": "q", "history": history}))
    prompt = llm.prompt_text()
    assert "SECRET FROM PAGE ONE" not in prompt and "same page earlier" in prompt


def test_fresh_transcript_is_not_reread_unless_forced(client, llm, make_project):
    _, pages = make_project("")
    page_id = pages[0]["id"]
    saved = data(client.patch(f"/api/pages/{page_id}", json={"elements": [stroke_el()]}))
    llm.queue_text("first reading")
    body = {"image": TINY_PNG, "content_hash": saved["content_hash"]}
    data(client.post(f"/api/pages/{page_id}/transcribe", json=body))
    data(client.put(f"/api/pages/{page_id}/transcript", json={"transcript_md": "student fixed this"}))
    again = data(client.post(f"/api/pages/{page_id}/transcribe", json=body))  # auto-read: no LLM call
    assert again["transcript_md"] == "student fixed this"
    llm.queue_text("forced reading")
    forced = data(client.post(f"/api/pages/{page_id}/transcribe", json={**body, "force": True}))
    assert forced["transcript_md"] == "forced reading"


def test_oversized_images_are_rejected_before_decoding(client, make_project):
    pid, pages = make_project(PHOTO)
    huge = "data:image/png;base64," + "A" * 9_000_001
    response = client.post("/api/ai/ask", json={"project_id": pid, "page_id": pages[0]["id"], "scope": "selection",
                                                "question": "q", "selection": {"image": huge}})
    assert response.status_code == 422


# --------------------------------------------------------------------------- importing notes


def image_el(src: str, text: str = "") -> dict:
    return {"id": "img1", "type": "image", "x": 0, "y": 0, "width": 1240, "height": 1754, "src": src, "text": text, "name": "notes.pdf"}


def test_asset_upload_round_trip_and_project_scoping(client, make_project):
    pid, _ = make_project("x")
    asset = data(client.post(f"/api/projects/{pid}/assets", json={"data_url": TINY_PNG}))
    assert asset["url"] == f"/api/assets/{asset['id']}"
    response = client.get(asset["url"])
    assert response.status_code == 200 and response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")
    bad = client.post(f"/api/projects/{pid}/assets", json={"data_url": "data:text/html;base64,PGgxPmhpPC9oMT4gICAgICAgICAgICAgICAg"})
    assert bad.status_code == 400
    assert client.get("/api/assets/" + "0" * 32).status_code == 404


def test_image_elements_only_accept_our_own_asset_urls(client, make_project):
    _, pages = make_project("x")
    evil = client.patch(f"/api/pages/{pages[0]['id']}", json={"elements": [image_el("https://evil.example/track.png")]})
    assert evil.status_code == 422


def test_pdf_text_layer_is_read_without_vision_but_photos_need_it(client, llm, make_project):
    pid, pages = make_project("")
    asset = data(client.post(f"/api/projects/{pid}/assets", json={"data_url": TINY_PNG}))
    page_id = pages[0]["id"]
    data(client.patch(f"/api/pages/{page_id}", json={"elements": [image_el(asset["url"], "Mitosis has four phases.")]}))
    status = data(client.get(f"/api/projects/{pid}/transcripts"))[0]
    assert status["has_ink"] is False and status["transcript_md"] == "Mitosis has four phases." and llm.calls == []

    data(client.patch(f"/api/pages/{page_id}", json={"elements": [image_el(asset["url"])]}))  # a photo: no text layer
    assert data(client.get(f"/api/projects/{pid}/transcripts"))[0]["has_ink"] is True


def test_pdf_page_with_pictures_is_read_by_vision_using_its_text_layer_verbatim(client, llm, make_project):
    pid, pages = make_project("")
    asset = data(client.post(f"/api/projects/{pid}/assets", json={"data_url": TINY_PNG}))
    page_id = pages[0]["id"]
    element = {**image_el(asset["url"], "Difference between ML and DL:"), "needs_vision": True}
    saved = data(client.patch(f"/api/pages/{page_id}", json={"elements": [element]}))
    assert data(client.get(f"/api/pages/{page_id}"))["elements"][0]["needs_vision"] is True

    status = data(client.get(f"/api/projects/{pid}/transcripts"))[0]
    assert status["has_ink"] is True and status["stale"] is True and llm.calls == []

    llm.queue_text("Difference between ML and DL:\n\n| ML | DL |")
    data(client.post(f"/api/pages/{page_id}/transcribe", json={"image": TINY_PNG, "content_hash": saved["content_hash"]}))
    assert "- Difference between ML and DL:" in llm.prompt_text()


def test_image_elements_without_the_vision_flag_keep_their_stored_shape(client, make_project):
    pid, pages = make_project("")
    asset = data(client.post(f"/api/projects/{pid}/assets", json={"data_url": TINY_PNG}))
    data(client.patch(f"/api/pages/{pages[0]['id']}", json={"elements": [image_el(asset["url"], "x")]}))
    stored = data(client.get(f"/api/pages/{pages[0]['id']}"))["elements"][0]
    assert "needs_vision" not in stored  # existing pages keep their content hash
