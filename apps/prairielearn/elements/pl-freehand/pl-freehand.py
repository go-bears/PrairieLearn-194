import json
import os
import pathlib
from dataclasses import dataclass
from typing import Any

import chevron
import freehand_ink as ink
import lxml.html
import prairielearn as pl

SCHEMA_PATH = pathlib.Path(__file__).parent / "schemas" / "pl-freehand.json"
REFERENCE_COLOR = "#198754"


@dataclass(frozen=True)
class Settings:
    name: str
    width: int
    height: int
    max_points: int
    telemetry: bool
    allow_blank: bool
    stroke_color: str
    stroke_width: float
    background_image: str | None
    background_fit: str
    reference_file: str | None
    grading: str
    tolerance: float
    pass_threshold: float
    partial_credit: bool
    weight: int

    @classmethod
    def from_html(cls, element_html: str) -> "Settings":
        e = lxml.html.fragment_fromstring(element_html)
        return cls(
            name=pl.get_string_attrib(e, "answers-name"),
            width=pl.get_integer_attrib(e, "width", 800),
            height=pl.get_integer_attrib(e, "height", 400),
            max_points=pl.get_integer_attrib(e, "max-points", 10000),
            telemetry=pl.get_boolean_attrib(e, "telemetry", False),
            allow_blank=pl.get_boolean_attrib(e, "allow-blank", False),
            stroke_color=pl.get_string_attrib(e, "stroke-color", "#111827"),
            stroke_width=pl.get_float_attrib(e, "stroke-width", 2),
            background_image=pl.get_string_attrib(e, "background-image", None),
            background_fit=pl.get_string_attrib(e, "background-fit", "contain"),
            reference_file=pl.get_string_attrib(e, "reference-file", None),
            grading=pl.get_string_attrib(e, "grading", "overlap"),
            tolerance=pl.get_float_attrib(e, "tolerance", 12),
            pass_threshold=pl.get_float_attrib(e, "pass-threshold", 0.8),
            partial_credit=pl.get_boolean_attrib(e, "partial-credit", True),
            weight=pl.get_integer_attrib(e, "weight", 1),
        )

    def sample(self, answer: Any) -> ink.Points:
        """Evenly spaced ink samples in canvas pixels, dense enough to resolve `tolerance`."""
        return ink.resample(
            ink.polylines(answer, self.width, self.height), self.tolerance / 3
        )

    def credit(self, match: ink.Match) -> float:
        if match.f1 >= self.pass_threshold:
            return 1.0
        return match.f1 / self.pass_threshold if self.partial_credit else 0.0


def prepare(element_html: str, data: pl.QuestionData) -> None:
    pl.validate_element(lxml.html.fragment_fromstring(element_html), SCHEMA_PATH)
    s = Settings.from_html(element_html)
    pl.check_answers_names(data, s.name)
    if min(s.width, s.height, s.max_points) <= 0:
        raise ValueError("width, height, and max-points must be positive integers")
    if s.tolerance <= 0 or not 0 < s.pass_threshold <= 1:
        raise ValueError(
            "tolerance must be positive and pass-threshold must be in (0, 1]"
        )
    if s.background_image:
        _require_file(data["options"]["client_files_question_path"], s.background_image)
    if s.reference_file and s.name not in data["correct_answers"]:
        path = _require_file(data["options"]["question_path"], s.reference_file)
        data["correct_answers"][s.name] = load_reference(path)


def _require_file(directory: str, file_name: str) -> str:
    path = os.path.join(directory, file_name)
    if not os.path.isfile(path):
        raise ValueError(f'pl-freehand could not find "{file_name}" in {directory}')
    return path


def load_reference(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as file:
        raw = json.load(file)
    ink.polylines(raw, 1, 1)
    reference = ink.compact(raw)
    if not reference["strokes"]:
        raise ValueError(f"The reference drawing {path} has no visible strokes")
    return reference


def render(element_html: str, data: pl.QuestionData) -> str:
    s = Settings.from_html(element_html)
    panel = data["panel"]
    editable = data["editable"] and panel == "question"
    answer = data["correct_answers" if panel == "answer" else "submitted_answers"].get(
        s.name
    )
    if panel == "answer" and answer is None:
        return ""

    replay = not editable and panel != "answer" and bool(ink.visible_strokes(answer))
    partial_score = data["partial_scores"].get(s.name, {})
    score = partial_score.get("score")
    options = {
        "width": s.width,
        "height": s.height,
        "maxPoints": s.max_points,
        "telemetry": s.telemetry,
        "strokeColor": REFERENCE_COLOR if panel == "answer" else s.stroke_color,
        "strokeWidth": s.stroke_width,
        "editable": editable,
        "replay": replay,
        "initialAnswer": answer if isinstance(answer, dict) else None,
    }
    params = {
        "name": s.name,
        "width": s.width,
        "height": s.height,
        "editable": editable,
        "telemetry": s.telemetry and editable,
        "replay": replay,
        "reference": panel == "answer",
        "background_url": s.background_image
        and f"{data['options']['client_files_question_url']}/{s.background_image}",
        "background_fit": "fill" if s.background_fit == "stretch" else "contain",
        "options_json": json.dumps(options),
        "submission": panel == "submission",
        "feedback": partial_score.get("feedback"),
        "format_error": data["format_errors"].get(s.name),
        **(dict([pl.determine_score_params(score)]) if score is not None else {}),
    }
    with open("pl-freehand.mustache", encoding="utf-8") as file:
        return chevron.render(file, params).strip()


def parse(element_html: str, data: pl.QuestionData) -> None:
    s = Settings.from_html(element_html)
    try:
        data["submitted_answers"][s.name] = parse_answer(
            data["submitted_answers"].get(s.name), s
        )
    except ValueError as exc:
        data["format_errors"][s.name] = str(exc)


def parse_answer(raw: Any, s: Settings) -> dict[str, Any]:
    try:
        answer = json.loads(raw) if isinstance(raw, str) and raw else raw
    except json.JSONDecodeError as exc:
        raise ValueError("The drawing is not valid JSON.") from exc
    answer: Any = answer or {"version": 1, "strokes": []}
    if (
        not isinstance(answer, dict)
        or answer.get("version") != 1
        or not isinstance(answer.get("strokes"), list)
    ):
        raise ValueError("The drawing has an unsupported format.")
    point_count = sum(
        len(stroke["points"])
        for stroke in answer["strokes"]
        if isinstance(stroke, dict) and isinstance(stroke.get("points"), list)
    )
    if point_count > s.max_points:
        raise ValueError("The drawing contains too many points.")
    if not ink.polylines(answer, 1, 1) and not s.allow_blank:
        raise ValueError("Draw your answer on the canvas before submitting.")
    return answer


def grade(element_html: str, data: pl.QuestionData) -> None:
    s = Settings.from_html(element_html)
    reference = data["correct_answers"].get(s.name)
    if reference is None:
        return
    reference_ink = s.sample(reference)

    def grade_function(answer: Any) -> tuple[float, str]:
        match = ink.match(s.sample(answer), reference_ink, s.grading, s.tolerance)
        return s.credit(match), (
            f"Your drawing covers {match.recall:.0%} of the expected answer, "
            f"and {match.precision:.0%} of your ink is on it."
        )

    pl.grade_answer_parameterized(data, s.name, grade_function, weight=s.weight)


def _stroke_answer(x: float, y: float, half_width: float) -> dict[str, Any]:
    """A single horizontal stroke centered on normalized (x, y)."""
    points = [{"x": x - half_width, "y": y}, {"x": x + half_width, "y": y}]
    return {"version": 1, "strokes": [{"points": points}]}


def test(element_html: str, data: pl.ElementTestData) -> None:
    s = Settings.from_html(element_html)
    reference = data["correct_answers"].get(s.name)
    test_type = data["test_type"]

    if test_type == "invalid":
        data["raw_submitted_answers"][s.name] = '{"version": 1}'
        data["format_errors"][s.name] = "invalid"
    elif reference is None:
        # Without a reference the element doesn't grade, so any drawing is a valid answer.
        data["raw_submitted_answers"][s.name] = json.dumps(
            _stroke_answer(0.5, 0.5, 0.1)
        )
    elif test_type == "correct":
        data["raw_submitted_answers"][s.name] = json.dumps(reference)
        data["partial_scores"][s.name] = {"score": 1, "weight": s.weight}
    else:
        x, y = ink.emptiest_point(s.sample(reference), s.width, s.height)
        answer = _stroke_answer(x, y, s.tolerance / (2 * s.width))
        data["raw_submitted_answers"][s.name] = json.dumps(answer)
        data["partial_scores"][s.name] = {"score": 0, "weight": s.weight}
