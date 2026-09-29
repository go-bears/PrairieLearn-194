import base64
import importlib
import json
from pathlib import Path
from typing import Any

import pytest

pl_freehand = importlib.import_module("pl-freehand")

DIAGONAL: dict[str, Any] = {
    "version": 1,
    "strokes": [{"points": [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.9}]}],
}


def element(**attribs: str) -> str:
    extra = "".join(
        f' {key.replace("_", "-")}="{value}"' for key, value in attribs.items()
    )
    return f'<pl-freehand answers-name="ink"{extra}></pl-freehand>'


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
    pl_freehand.prepare(element(), make_question_data())


@pytest.mark.parametrize(
    "attribs",
    [{"width": "0"}, {"height": "0"}, {"max_points": "0"}],
)
def test_prepare_rejects_non_positive_dimensions(attribs: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="positive"):
        pl_freehand.prepare(element(**attribs), make_question_data())


@pytest.mark.parametrize(
    "attribs",
    [{"tolerance": "0"}, {"pass_threshold": "0"}, {"pass_threshold": "1.5"}],
)
def test_prepare_rejects_invalid_grading_settings(attribs: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="tolerance"):
        pl_freehand.prepare(element(**attribs), make_question_data())


def test_prepare_rejects_duplicate_answer_name() -> None:
    data = make_question_data()
    pl_freehand.prepare(element(), data)
    with pytest.raises(KeyError, match="Duplicate"):
        pl_freehand.prepare(element(), data)


def test_prepare_requires_background_image_file(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"plane\.png"):
        pl_freehand.prepare(
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
    pl_freehand.prepare(element(reference_file="reference.json"), data)
    assert data["correct_answers"]["ink"] == DIAGONAL


def test_prepare_keeps_reference_set_by_server(tmp_path: Path) -> None:
    data = make_question_data(tmp_path, correct_answers={"ink": DIAGONAL})
    pl_freehand.prepare(element(reference_file="missing.json"), data)
    assert data["correct_answers"]["ink"] == DIAGONAL


def test_prepare_rejects_empty_reference(tmp_path: Path) -> None:
    (tmp_path / "reference.json").write_text('{"version": 1, "strokes": []}')
    with pytest.raises(ValueError, match="no visible strokes"):
        pl_freehand.prepare(
            element(reference_file="reference.json"), make_question_data(tmp_path)
        )


def parse(raw: Any, **attribs: str) -> dict[str, Any]:
    data = make_question_data(submitted_answers={"ink": raw})
    pl_freehand.parse(element(**attribs), data)
    return data


def test_parse_accepts_strokes() -> None:
    assert pl_freehand.full_answer(parse(json.dumps(DIAGONAL)), "ink") == DIAGONAL


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
    assert pl_freehand.full_answer(data, "ink")["strokes"] == []
    assert data["submitted_answers"]["ink"]["summary"]["strokes_submitted"] == 0


def test_parse_rejects_too_many_points() -> None:
    assert (
        "too many"
        in parse(json.dumps(DIAGONAL), max_points="1")["format_errors"]["ink"]
    )


def grade(answer: dict[str, Any], **attribs: str) -> dict[str, Any]:
    data = make_question_data(
        correct_answers={"ink": DIAGONAL}, submitted_answers={"ink": answer}
    )
    pl_freehand.grade(element(**attribs), data)
    return data["partial_scores"]["ink"]


def line(x1: float, y1: float, x2: float, y2: float) -> dict[str, Any]:
    return {
        "version": 1,
        "strokes": [{"points": [{"x": x1, "y": y1}, {"x": x2, "y": y2}]}],
    }


def test_grade_awards_full_credit_for_match() -> None:
    result = grade(DIAGONAL, weight="3")
    assert result["score"] == pytest.approx(1)
    assert result["weight"] == 3
    assert result["feedback"]["text"] == (
        "Your drawing covers 100% of the expected answer, and 100% of your ink is on it."
    )
    assert result["feedback"]["coverage_percent"] == 100
    assert result["feedback"]["accuracy_percent"] == 100
    assert result["feedback"]["overlapping_points"] > 0


def test_grade_awards_partial_credit_for_half_drawing() -> None:
    assert grade(line(0.1, 0.1, 0.5, 0.5))["score"] == pytest.approx(0.83, abs=0.05)


def test_grade_without_partial_credit_is_all_or_nothing() -> None:
    assert grade(line(0.1, 0.1, 0.5, 0.5), partial_credit="false")["score"] == 0


def test_grade_function_mode_rejects_wrong_slope() -> None:
    assert grade(line(0.1, 0.9, 0.9, 0.1), grading="function")["score"] < 0.2


def test_grade_skips_questions_without_reference() -> None:
    data = make_question_data(submitted_answers={"ink": DIAGONAL})
    pl_freehand.grade(element(), data)
    assert data["partial_scores"] == {}


@pytest.mark.parametrize("test_type", ["correct", "incorrect", "invalid"])
def test_generated_test_answers_grade_as_expected(test_type: str) -> None:
    data = make_question_data(
        correct_answers={"ink": DIAGONAL}, test_type=test_type, raw_submitted_answers={}
    )
    pl_freehand.test(element(), data)
    graded = make_question_data(
        correct_answers={"ink": DIAGONAL},
        submitted_answers={"ink": data["raw_submitted_answers"]["ink"]},
    )
    pl_freehand.parse(element(), graded)
    if test_type == "invalid":
        assert "ink" in graded["format_errors"]
        return
    pl_freehand.grade(element(), graded)
    assert (
        graded["partial_scores"]["ink"]["score"]
        == data["partial_scores"]["ink"]["score"]
    )


@pytest.mark.parametrize("test_type", ["correct", "incorrect"])
def test_generated_test_answers_without_reference_are_valid_and_ungraded(
    test_type: str,
) -> None:
    data = make_question_data(test_type=test_type, raw_submitted_answers={})
    pl_freehand.test(element(), data)
    assert data["partial_scores"] == {}
    parsed = make_question_data(
        submitted_answers={"ink": data["raw_submitted_answers"]["ink"]}
    )
    pl_freehand.parse(element(), parsed)
    assert parsed["format_errors"] == {}


TELEMETRY_ANSWER: dict[str, Any] = {
    "version": 1,
    "canvas": {"width": 800, "height": 400},
    "responseDuration": 900,
    "events": [{"type": "stroke-start", "at": 100, "strokeIndex": 0}],
    "strokes": [
        {
            "startedAt": 100,
            "points": [
                {"x": 0.1, "y": 0.1, "dt": 100, "p": 0.4, "pointerType": "pen"},
                {"x": 0.9, "y": 0.9, "dt": 180, "p": 0.6, "pointerType": "pen"},
            ],
        },
        {"undone": True, "points": [{"x": 0.5, "y": 0.5, "dt": 300}]},
    ],
}


def test_parse_stores_the_recording_in_a_file_and_a_summary_in_the_answer() -> None:
    data = parse(json.dumps(TELEMETRY_ANSWER), telemetry="true")
    answer = data["submitted_answers"]["ink"]
    assert answer["element"] == "pl-freehand"
    assert answer["canvas"] == {"width": 800, "height": 400}
    assert answer["summary"]["strokes_submitted"] == 1
    assert "strokes" not in answer
    [file] = data["submitted_answers"]["_files"]
    assert file["name"] == "ink-strokes.json"
    assert file["mimetype"] == pl_freehand.STROKES_MIMETYPE
    assert json.loads(base64.b64decode(file["contents"])) == TELEMETRY_ANSWER


def test_full_answer_reads_the_file_and_falls_back_to_older_answers() -> None:
    data = parse(json.dumps(TELEMETRY_ANSWER), telemetry="true")
    assert pl_freehand.full_answer(data, "ink") == TELEMETRY_ANSWER
    inline = make_question_data(submitted_answers={"ink": TELEMETRY_ANSWER})
    assert pl_freehand.full_answer(inline, "ink") == TELEMETRY_ANSWER
    contents = base64.b64encode(json.dumps(TELEMETRY_ANSWER).encode()).decode()
    telemetry_file = make_question_data(
        submitted_answers={
            "ink": DIAGONAL,
            "_files": [{"name": "ink-telemetry.json", "contents": contents}],
        }
    )
    assert pl_freehand.full_answer(telemetry_file, "ink") == TELEMETRY_ANSWER


def test_grading_reads_the_strokes_file() -> None:
    data = parse(json.dumps(TELEMETRY_ANSWER), telemetry="true")
    graded = make_question_data(
        correct_answers={"ink": DIAGONAL}, submitted_answers=data["submitted_answers"]
    )
    pl_freehand.grade(element(telemetry="true"), graded)
    assert graded["partial_scores"]["ink"]["score"] == 1
    assert graded["partial_scores"]["ink"]["feedback"]["coverage_percent"] == 100
