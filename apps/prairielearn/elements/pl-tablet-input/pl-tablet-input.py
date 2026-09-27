import json

import chevron
import lxml.html
import prairielearn as pl

WIDTH_DEFAULT = 800
HEIGHT_DEFAULT = 400
MAX_POINTS_DEFAULT = 10000
TELEMETRY_DEFAULT = False


def prepare(element_html: str, data: pl.QuestionData) -> None:
    element = lxml.html.fragment_fromstring(element_html)
    pl.check_attribs(
        element,
        required_attribs=["answers-name"],
        optional_attribs=[
            "width",
            "height",
            "max-points",
            "telemetry",
            "allow-blank",
            "stroke-color",
            "stroke-width",
        ],
    )

    name = pl.get_string_attrib(element, "answers-name")
    pl.check_answers_names(data, name)
    width = pl.get_integer_attrib(element, "width", WIDTH_DEFAULT)
    height = pl.get_integer_attrib(element, "height", HEIGHT_DEFAULT)
    max_points = pl.get_integer_attrib(element, "max-points", MAX_POINTS_DEFAULT)
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be positive integers")
    if max_points <= 0:
        raise ValueError("max-points must be a positive integer")
    pl.get_boolean_attrib(element, "telemetry", TELEMETRY_DEFAULT)
    pl.get_boolean_attrib(element, "allow-blank", False)
    pl.get_float_attrib(element, "stroke-width", 2)


def render(element_html: str, data: pl.QuestionData) -> str:
    element = lxml.html.fragment_fromstring(element_html)
    answer_name = pl.get_string_attrib(element, "answers-name")
    width = pl.get_integer_attrib(element, "width", WIDTH_DEFAULT)
    height = pl.get_integer_attrib(element, "height", HEIGHT_DEFAULT)
    max_points = pl.get_integer_attrib(element, "max-points", MAX_POINTS_DEFAULT)
    telemetry = pl.get_boolean_attrib(element, "telemetry", TELEMETRY_DEFAULT)
    editable = data["editable"] and data["panel"] == "question"
    initial_answer = data["submitted_answers"].get(answer_name)
    replay = (
        not editable
        and isinstance(initial_answer, dict)
        and isinstance(initial_answer.get("strokes"), list)
    )

    params = {
        "answer_name": answer_name,
        "width": width,
        "height": height,
        "max_points": max_points,
        "telemetry": telemetry,
        "telemetry_json": json.dumps(telemetry),
        "editable": editable,
        "editable_json": json.dumps(editable),
        "stroke_color": pl.get_string_attrib(element, "stroke-color", "#111827"),
        "stroke_width": pl.get_float_attrib(element, "stroke-width", 2),
        "allow_blank": pl.get_boolean_attrib(element, "allow-blank", False),
        "initial_answer": json.dumps(initial_answer),
        "replay": json.dumps(replay),
    }
    with open("pl-tablet-input.mustache", encoding="utf-8") as file:
        return chevron.render(file, params).strip()


def parse(element_html: str, data: pl.QuestionData) -> None:
    element = lxml.html.fragment_fromstring(element_html)
    name = pl.get_string_attrib(element, "answers-name")
    allow_blank = pl.get_boolean_attrib(element, "allow-blank", False)
    raw_answer = data["submitted_answers"].get(name)
    if not raw_answer:
        if not allow_blank:
            data["format_errors"][name] = "A tablet input response is required."
        return

    try:
        answer = json.loads(raw_answer) if isinstance(raw_answer, str) else raw_answer
    except (TypeError, ValueError):
        data["format_errors"][name] = "The tablet input response is not valid JSON."
        return

    if not isinstance(answer, dict) or answer.get("version") != 1:
        data["format_errors"][name] = (
            "The tablet input response has an unsupported format."
        )
        return
    if not isinstance(answer.get("strokes"), list):
        data["format_errors"][name] = "The tablet input response must contain strokes."
        return

    max_points = pl.get_integer_attrib(element, "max-points", MAX_POINTS_DEFAULT)
    if (
        sum(
            len(stroke.get("points", []))
            for stroke in answer["strokes"]
            if isinstance(stroke, dict)
        )
        > max_points
    ):
        data["format_errors"][name] = (
            "The tablet input response contains too many points."
        )
        return
    data["submitted_answers"][name] = answer


def test(element_html: str, data: pl.ElementTestData) -> None:
    element = lxml.html.fragment_fromstring(element_html)
    name = pl.get_string_attrib(element, "answers-name")
    if data["test_type"] == "invalid":
        data["raw_submitted_answers"][name] = '{"version": 1}'
    else:
        data["raw_submitted_answers"][name] = json.dumps({
            "version": 1,
            "canvas": {"width": 800, "height": 400},
            "strokes": [],
        })
