import json
from pathlib import Path

import pytest
from port_from_sketch import Canvas, Sketch, port_question

POINTS = """
<pl-sketch answers-name="pts" x-range="-3,3" y-range="-1,6" allow-blank="true">
  <pl-sketch-tool id="f" type="spline" read-only="true" color="#1a3a8f"></pl-sketch-tool>
  <pl-sketch-tool id="pt" type="point"></pl-sketch-tool>
  <pl-sketch-initial tool-id="f" function="x**2" x-range="-2,2"></pl-sketch-initial>
  <pl-sketch-grade type="match" tool-id="pt" x="-1" y="1" tolerance="20"></pl-sketch-grade>
  <pl-sketch-grade type="count" tool-id="pt" count="1"></pl-sketch-grade>
  <pl-sketch-solution tool-id="pt" coordinates="(-1,1)"></pl-sketch-solution>
</pl-sketch>
"""


def sketch(markup: str) -> Sketch:
    return Sketch.parse(markup.strip())


def test_canvas_matches_pl_sketch_margins() -> None:
    canvas = Canvas(800, 450, (-5, 5), (-5, 5))
    assert canvas.px(-5, 5) == (10, 10)
    assert canvas.px(5, -5) == (790, 440)
    assert canvas.x_at(10) == -5


def test_function_lines_split_where_undefined() -> None:
    lines = Canvas(800, 450, (-5, 5), (-5, 5)).function_lines("1/x", (None, None))
    assert len(lines) == 2
    assert all(0 <= y <= 450 for line in lines for _, y in line)


def test_points_canvas_ports_with_a_dot_reference() -> None:
    parsed = sketch(POINTS)
    assert parsed.blockers() == []
    assert parsed.grading_mode() == "overlap"
    assert parsed.tolerance() == 20
    [stroke] = parsed.reference()["strokes"]
    x, y = parsed.canvas.px(-1, 1)
    assert stroke == {"points": [{"x": round(x / 800, 4), "y": round(y / 450, 4)}]}


def test_background_draws_fixed_drawings_but_not_the_solution() -> None:
    svg = sketch(POINTS).background_svg()
    assert svg.count("<polyline") == 1
    assert "<circle" not in svg


@pytest.mark.parametrize(
    ("markup", "reason"),
    [
        (
            POINTS.replace('type="spline" read-only="true"', 'type="spline"'),
            "2 drawing tools",
        ),
        (POINTS.replace('type="count"', 'type="monot-increasing"'), "monot-increasing"),
        (POINTS.replace('x="-1"', 'x="{{params.x}}"'), "randomized"),
        (
            POINTS.replace(
                '<pl-sketch-solution tool-id="pt" coordinates="(-1,1)"></pl-sketch-solution>',
                "",
            ),
            "no `pl-sketch-solution`",
        ),
    ],
)
def test_unportable_canvases_report_why(markup: str, reason: str) -> None:
    assert any(reason in blocker for blocker in sketch(markup).blockers())


def test_single_curve_matched_to_a_function_uses_graph_mode() -> None:
    parsed = sketch("""
      <pl-sketch answers-name="sin" x-range="-1,7" y-range="-2,2">
        <pl-sketch-tool id="fd" type="free-draw"></pl-sketch-tool>
        <pl-sketch-grade type="match-function" tool-id="fd" function="sin(x)" x-range="0,6.28"></pl-sketch-grade>
        <pl-sketch-solution tool-id="fd" function="sin(x)" x-range="0,6.28"></pl-sketch-solution>
      </pl-sketch>""")
    assert parsed.grading_mode() == "function"
    assert 'grading="function"' in parsed.tablet_markup("bg.svg", "ref.json")


def test_port_question_writes_a_new_question_and_keeps_unportable_canvases(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source"
    source.mkdir()
    unportable = POINTS.replace('answers-name="pts"', 'answers-name="kept"').replace(
        'type="count"', 'type="concave-up"'
    )
    (source / "question.html").write_text(f"<p>Intro</p>\n{POINTS}\n{unportable}")
    (source / "info.json").write_text(
        json.dumps({"uuid": "x", "title": "Sketch", "topic": "T", "type": "v3"})
    )

    outcomes = port_question(source, tmp_path / "ported")

    assert [(o.name, o.ported) for o in outcomes] == [("pts", True), ("kept", False)]
    html = (tmp_path / "ported" / "question.html").read_text()
    assert html.startswith("<p>Intro</p>")
    assert 'reference-file="pts-reference.json"' in html
    assert 'answers-name="kept"' in html
    assert "<pl-sketch-tool" in html
    assert (tmp_path / "ported" / "clientFilesQuestion" / "pts-axes.svg").exists()
    assert (
        json.loads((tmp_path / "ported" / "info.json").read_text())["gradingMethod"]
        == "Internal"
    )
    assert "concave-up" in (tmp_path / "ported" / "README.md").read_text()
