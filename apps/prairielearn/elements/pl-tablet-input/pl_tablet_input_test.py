import importlib
import json
from pathlib import Path
from typing import Any

import pytest

pl_tablet_input = importlib.import_module("pl-tablet-input")

DIAGONAL: dict[str, Any] = {
    "version": 1,
    "strokes": [{"points": [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.9}]}],
}


def element(**attribs: str) -> str:
    extra = "".join(
        f' {key.replace("_", "-")}="{value}"' for key, value in attribs.items()
    )
    return f'<pl-tablet-input answers-name="ink"{extra}></pl-tablet-input>'


def make_question_data(
    tmp_path: Path | None = None, **overrides: Any
) -> dict[str, Any]:
    return {
        "answers_names": {},
        "correct_answers": {},
        "submitted_answers": {},
        "format_errors": {},
        "partial_scores": {},
        "options": {
            "question_path": str(tmp_path),
            "client_files_question_path": str(tmp_path),
        },
        **overrides,
    }


def test_prepare_accepts_defaults() -> None:
    pl_tablet_input.prepare(element(), make_question_data())


@pytest.mark.parametrize(
    "attribs",
    [{"width": "0"}, {"height": "0"}, {"max_points": "0"}],
)
def test_prepare_rejects_non_positive_dimensions(attribs: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="positive"):
        pl_tablet_input.prepare(element(**attribs), make_question_data())


@pytest.mark.parametrize(
    "attribs",
    [{"tolerance": "0"}, {"pass_threshold": "0"}, {"pass_threshold": "1.5"}],
)
def test_prepare_rejects_invalid_grading_settings(attribs: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="tolerance"):
        pl_tablet_input.prepare(element(**attribs), make_question_data())


def test_prepare_rejects_duplicate_answer_name() -> None:
    data = make_question_data()
    pl_tablet_input.prepare(element(), data)
    with pytest.raises(KeyError, match="Duplicate"):
        pl_tablet_input.prepare(element(), data)


def test_prepare_requires_background_image_file(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"plane\.png"):
        pl_tablet_input.prepare(
            element(background_image="plane.png"), make_question_data(tmp_path)
        )


def test_prepare_loads_compacted_reference(tmp_path: Path) -> None:
    reference = json.loads(json.dumps(DIAGONAL))
    reference["strokes"].append({
        "undone": True,
        "points": [{"x": 0.5, "y": 0.5, "dt": 3}],
    })
    (tmp_path / "reference.json").write_text(json.dumps(reference))
    data = make_question_data(tmp_path)
    pl_tablet_input.prepare(element(reference_file="reference.json"), data)
    assert data["correct_answers"]["ink"] == DIAGONAL


def test_prepare_keeps_reference_set_by_server(tmp_path: Path) -> None:
    data = make_question_data(tmp_path, correct_answers={"ink": DIAGONAL})
    pl_tablet_input.prepare(element(reference_file="missing.json"), data)
    assert data["correct_answers"]["ink"] == DIAGONAL


def test_prepare_rejects_empty_reference(tmp_path: Path) -> None:
    (tmp_path / "reference.json").write_text('{"version": 1, "strokes": []}')
    with pytest.raises(ValueError, match="no visible strokes"):
        pl_tablet_input.prepare(
            element(reference_file="reference.json"), make_question_data(tmp_path)
        )


def parse(raw: Any, **attribs: str) -> dict[str, Any]:
    data = make_question_data(submitted_answers={"ink": raw})
    pl_tablet_input.parse(element(**attribs), data)
    return data


def test_parse_accepts_strokes() -> None:
    assert parse(json.dumps(DIAGONAL))["submitted_answers"]["ink"] == DIAGONAL


@pytest.mark.parametrize(
    ("raw", "error"),
    [
        ("not json", "valid JSON"),
        ('{"version": 2, "strokes": []}', "unsupported format"),
        ('{"version": 1}', "unsupported format"),
        (
            json.dumps({"version": 1, "strokes": [{"points": [{"x": 2, "y": 0}]}]}),
            "within",
        ),
    ],
)
def test_parse_rejects_malformed_answers(raw: str, error: str) -> None:
    assert error in parse(raw)["format_errors"]["ink"]


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        json.dumps({
            "version": 1,
            "strokes": [{"undone": True, **DIAGONAL["strokes"][0]}],
        }),
    ],
)
def test_parse_rejects_blank_canvas(raw: str | None) -> None:
    assert "Draw your answer" in parse(raw)["format_errors"]["ink"]


def test_parse_allows_blank_canvas_when_enabled() -> None:
    data = parse("", allow_blank="true")
    assert data["format_errors"] == {}
    assert data["submitted_answers"]["ink"]["strokes"] == []


def test_parse_rejects_too_many_points() -> None:
    assert (
        "too many"
        in parse(json.dumps(DIAGONAL), max_points="1")["format_errors"]["ink"]
    )


def grade(answer: dict[str, Any], **attribs: str) -> dict[str, Any]:
    data = make_question_data(
        correct_answers={"ink": DIAGONAL}, submitted_answers={"ink": answer}
    )
    pl_tablet_input.grade(element(**attribs), data)
    return data["partial_scores"]["ink"]


def line(x1: float, y1: float, x2: float, y2: float) -> dict[str, Any]:
    return {
        "version": 1,
        "strokes": [{"points": [{"x": x1, "y": y1}, {"x": x2, "y": y2}]}],
    }


def test_grade_awards_full_credit_for_match() -> None:
    assert grade(DIAGONAL, weight="3") == {
        "score": 1.0,
        "weight": 3,
        "feedback": "Your drawing covers 100% of the expected answer, and 100% of your ink is on it.",
    }


def test_grade_awards_partial_credit_for_half_drawing() -> None:
    assert grade(line(0.1, 0.1, 0.5, 0.5))["score"] == pytest.approx(0.83, abs=0.05)


def test_grade_without_partial_credit_is_all_or_nothing() -> None:
    assert grade(line(0.1, 0.1, 0.5, 0.5), partial_credit="false")["score"] == 0


def test_grade_function_mode_rejects_wrong_slope() -> None:
    assert grade(line(0.1, 0.9, 0.9, 0.1), grading="function")["score"] < 0.2


def test_grade_skips_questions_without_reference() -> None:
    data = make_question_data(submitted_answers={"ink": DIAGONAL})
    pl_tablet_input.grade(element(), data)
    assert data["partial_scores"] == {}


@pytest.mark.parametrize("test_type", ["correct", "incorrect", "invalid"])
def test_generated_test_answers_grade_as_expected(test_type: str) -> None:
    data = make_question_data(
        correct_answers={"ink": DIAGONAL}, test_type=test_type, raw_submitted_answers={}
    )
    pl_tablet_input.test(element(), data)
    graded = make_question_data(
        correct_answers={"ink": DIAGONAL},
        submitted_answers={"ink": data["raw_submitted_answers"]["ink"]},
    )
    pl_tablet_input.parse(element(), graded)
    if test_type == "invalid":
        assert "ink" in graded["format_errors"]
        return
    pl_tablet_input.grade(element(), graded)
    assert (
        graded["partial_scores"]["ink"]["score"]
        == data["partial_scores"]["ink"]["score"]
    )


@pytest.mark.parametrize("test_type", ["correct", "incorrect"])
def test_generated_test_answers_without_reference_are_valid_and_ungraded(
    test_type: str,
) -> None:
    data = make_question_data(test_type=test_type, raw_submitted_answers={})
    pl_tablet_input.test(element(), data)
    assert data["partial_scores"] == {}
    parsed = make_question_data(
        submitted_answers={"ink": data["raw_submitted_answers"]["ink"]}
    )
    pl_tablet_input.parse(element(), parsed)
    assert parsed["format_errors"] == {}
