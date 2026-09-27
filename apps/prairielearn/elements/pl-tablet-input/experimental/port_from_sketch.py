"""Experimental: port pl-sketch canvases in a question to pl-tablet-input.

Writes a new question and leaves the source untouched. Each portable
`<pl-sketch>` becomes a `<pl-tablet-input>` with:

- an SVG background of the same axes, grid, and fixed drawings, and
- a reference drawing generated from its `<pl-sketch-solution>` tags,

using only existing pl-tablet-input attributes. Canvases that can't be ported
faithfully stay as `<pl-sketch>`, and README.md explains why. Randomization
(`server.py`, `{{params}}`) is not carried over.

Usage (with PrairieLearn's Python environment):

    python port_from_sketch.py SOURCE_QUESTION_DIR DEST_QUESTION_DIR [--title TITLE]
"""

import argparse
import json
import math
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

import lxml.html
import numpy as np
from sketchresponse.utils import parse_function_string

MARGIN = 10  # pl-sketch pads the graph with 10 px on each side
TOLERANCE_DEFAULT = 15  # pl-sketch's default for `match` and `match-function`
SUPPORTED_GRADERS = {"match", "count", "match-function"}
CURVE_TOOLS = {"free-draw", "spline", "polyline"}
SKETCH_PATTERN = re.compile(r"<pl-sketch(?=[\s>])[\s\S]*?</pl-sketch>")

Range = tuple[float | None, float | None]


def _required(tag: lxml.html.HtmlElement, name: str) -> str:
    value = tag.get(name)
    if value is None:
        raise ValueError(f'<{tag.tag}> is missing the "{name}" attribute')
    return value


def parse_range(value: str) -> Range:
    start, end = (part.strip() for part in value.split(","))
    return (float(start) if start else None, float(end) if end else None)


def parse_coordinates(value: str) -> list[tuple[float, float]]:
    return [
        (float(x), float(y))
        for x, y in re.findall(r"\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)", value)
    ]


@dataclass(frozen=True)
class Canvas:
    """pl-sketch's mapping from graph coordinates to canvas pixels."""

    width: int
    height: int
    x_range: tuple[float, float]
    y_range: tuple[float, float]

    def px(self, x: float, y: float) -> tuple[float, float]:
        (x0, x1), (y0, y1) = self.x_range, self.y_range
        return (
            MARGIN + (x - x0) / (x1 - x0) * (self.width - 2 * MARGIN),
            MARGIN + (y1 - y) / (y1 - y0) * (self.height - 2 * MARGIN),
        )

    def x_at(self, px: float) -> float:
        x0, x1 = self.x_range
        return x0 + (px - MARGIN) / (self.width - 2 * MARGIN) * (x1 - x0)

    def function_lines(
        self, expression: str, x_range: Range
    ) -> list[list[tuple[float, float]]]:
        """Pixel polylines of y = f(x), split where f is undefined or leaves the canvas."""
        f = parse_function_string(expression)
        start = self.x_at(0) if x_range[0] is None else x_range[0]
        end = self.x_at(self.width) if x_range[1] is None else x_range[1]
        lines: list[list[tuple[float, float]]] = [[]]
        for x in np.linspace(start, end, self.width):
            try:
                point = self.px(float(x), f(float(x)))
            except (ArithmeticError, ValueError):
                point = (math.nan, math.nan)
            if math.isfinite(point[1]) and 0 <= point[1] <= self.height:
                lines[-1].append(point)
            elif lines[-1]:
                lines.append([])
        return [line for line in lines if len(line) > 1]


@dataclass(frozen=True)
class Tool:
    id: str
    type: str
    read_only: bool
    color: str
    hollow: bool


@dataclass
class Drawing:
    """Lines and dots in canvas pixels, from a `pl-sketch-initial` or `pl-sketch-solution` tag."""

    lines: list[list[tuple[float, float]]] = field(default_factory=list)
    dots: list[tuple[float, float]] = field(default_factory=list)


def drawing_from_tag(tag: lxml.html.HtmlElement, tool: Tool, canvas: Canvas) -> Drawing:
    function = tag.get("function")
    if function:
        return Drawing(
            lines=canvas.function_lines(function, parse_range(tag.get("x-range", ",")))
        )
    value = tag.get("coordinates", "")
    if tool.type == "horizontal-line":
        y = canvas.px(0, float(value))[1]
        return Drawing(lines=[[(0, y), (canvas.width, y)]])
    if tool.type == "vertical-line":
        x = canvas.px(float(value), 0)[0]
        return Drawing(lines=[[(x, 0), (x, canvas.height)]])
    points = [canvas.px(x, y) for x, y in parse_coordinates(value)]
    if tool.type == "point":
        return Drawing(dots=points)
    if tool.type == "polygon":
        points = [*points, points[0]]
    return Drawing(lines=[points])


@dataclass
class Sketch:
    name: str
    markup: str
    attributes: dict[str, str]
    canvas: Canvas
    tools: dict[str, Tool]
    initial: list[tuple[Tool, Drawing]]
    solution: list[Drawing]
    graders: list[dict[str, str]]

    @classmethod
    def parse(cls, markup: str) -> "Sketch":
        element = lxml.html.fragment_fromstring(markup)
        width, height = int(element.get("width", 800)), int(element.get("height", 450))
        (x0, x1), (y0, y1) = (
            parse_range(element.get(name, "-5,5")) for name in ("x-range", "y-range")
        )
        if x0 is None or x1 is None or y0 is None or y1 is None:
            raise ValueError("pl-sketch canvas ranges must have both ends")
        canvas = Canvas(width, height, (x0, x1), (y0, y1))
        tools = {
            _required(tag, "id"): Tool(
                id=_required(tag, "id"),
                type=_required(tag, "type"),
                read_only=tag.get("read-only") == "true",
                color=tag.get("color", "#1f2937"),
                hollow=tag.get("hollow") == "true",
            )
            for tag in element.iter("pl-sketch-tool")
        }

        def drawings(tag_name: str) -> list[tuple[Tool, Drawing]]:
            return [
                (
                    tools[_required(tag, "tool-id")],
                    drawing_from_tag(tag, tools[_required(tag, "tool-id")], canvas),
                )
                for tag in element.iter(tag_name)
            ]

        return cls(
            name=_required(element, "answers-name"),
            markup=markup,
            attributes=dict(element.attrib),
            canvas=canvas,
            tools=tools,
            initial=drawings("pl-sketch-initial"),
            solution=[drawing for _, drawing in drawings("pl-sketch-solution")],
            graders=[dict(tag.attrib) for tag in element.iter("pl-sketch-grade")],
        )

    @property
    def drawing_tools(self) -> list[Tool]:
        return [tool for tool in self.tools.values() if not tool.read_only]

    def blockers(self) -> list[str]:
        """Reasons this canvas can't be ported faithfully; empty if it can."""
        reasons = []
        if "{{" in self.markup:
            reasons.append("uses randomized `{{params}}` values")
        if len(self.drawing_tools) != 1:
            reasons.append(
                f"has {len(self.drawing_tools)} drawing tools; freehand ink has one"
            )
        unsupported = sorted({g["type"] for g in self.graders} - SUPPORTED_GRADERS)
        if unsupported:
            reasons.append(
                f"uses criteria with no freehand equivalent: {', '.join(unsupported)}"
            )
        if any(g.get("stage") for g in self.graders):
            reasons.append("uses grading stages")
        if not any(d.lines or d.dots for d in self.solution):
            reasons.append("has no `pl-sketch-solution` to build the answer key from")
        return reasons

    def grading_mode(self) -> str:
        """Graph mode for a single curve tool graded as a function; shape mode otherwise."""
        tool = self.drawing_tools[0]
        is_function = tool.type in CURVE_TOOLS and all(
            g["type"] == "match-function" for g in self.graders
        )
        return "function" if is_function else "overlap"

    def tolerance(self) -> float:
        return max(
            (float(g.get("tolerance", TOLERANCE_DEFAULT)) for g in self.graders),
            default=TOLERANCE_DEFAULT,
        )

    def reference(self) -> dict[str, Any]:
        w, h = self.canvas.width, self.canvas.height

        def point(x: float, y: float) -> dict[str, float]:
            return {
                "x": round(min(max(x / w, 0), 1), 4),
                "y": round(min(max(y / h, 0), 1), 4),
            }

        strokes = [
            {"points": [point(*p) for p in line]}
            for d in self.solution
            for line in d.lines
        ]
        strokes += [{"points": [point(*dot)]} for d in self.solution for dot in d.dots]
        return {"version": 1, "strokes": strokes}

    def background_svg(self) -> str:
        return render_axes_svg(self.canvas, self.initial)

    def tablet_markup(self, background: str, reference: str) -> str:
        attributes = {
            "answers-name": self.name,
            "width": self.canvas.width,
            "height": self.canvas.height,
            "telemetry": "true",
            "background-image": background,
            "background-fit": "stretch",
            "reference-file": reference,
            "grading": self.grading_mode(),
            "tolerance": f"{self.tolerance():g}",
            **(
                {"allow-blank": self.attributes["allow-blank"]}
                if "allow-blank" in self.attributes
                else {}
            ),
            **(
                {"weight": self.attributes["weight"]}
                if "weight" in self.attributes
                else {}
            ),
        }
        lines = "\n".join(f'  {key}="{value}"' for key, value in attributes.items())
        return f"<pl-tablet-input\n{lines}\n></pl-tablet-input>"


def _grid_steps(span: float, pixels: float, min_pixels: float) -> tuple[float, float]:
    """The smallest 1, 2, or 5 x 10^k major step at least `min_pixels` wide, and its minor step."""
    raw = span * min_pixels / pixels
    magnitude = 10 ** math.floor(math.log10(raw))
    mantissa = next(m for m in (1, 2, 5, 10) if m * magnitude >= raw)
    major = mantissa * magnitude
    return major, major / (4 if mantissa == 2 else 5)


def _ticks(start: float, end: float, step: float) -> list[float]:
    return [
        round(i * step, 10)
        for i in range(
            math.ceil(start / step - 1e-9), math.floor(end / step + 1e-9) + 1
        )
    ]


def render_axes_svg(canvas: Canvas, initial: list[tuple[Tool, Drawing]]) -> str:
    """Axes and grid in pl-sketch's style (major lines about every 80 px), plus fixed drawings."""
    w, h = canvas.width, canvas.height
    (x0, x1), (y0, y1) = canvas.x_range, canvas.y_range
    origin_x, origin_y = canvas.px(min(max(0.0, x0), x1), min(max(0.0, y0), y1))
    parts = [f'<rect width="{w}" height="{h}" fill="#fff"/>']

    def grid(start: float, end: float, pixels: float, vertical: bool) -> list[float]:
        major, minor = _grid_steps(end - start, pixels, 80)
        for value, color in ((minor, "#eeeeee"), (major, "#cccccc")):
            for tick in _ticks(start, end, value):
                if vertical:
                    x = canvas.px(tick, 0)[0]
                    parts.append(
                        f'<line x1="{x:.2f}" y1="0" x2="{x:.2f}" y2="{h}" stroke="{color}"/>'
                    )
                else:
                    y = canvas.px(0, tick)[1]
                    parts.append(
                        f'<line x1="0" y1="{y:.2f}" x2="{w}" y2="{y:.2f}" stroke="{color}"/>'
                    )
        return [tick for tick in _ticks(start, end, major) if tick != 0]

    x_labels = grid(x0, x1, w - 2 * MARGIN, vertical=True)
    y_labels = grid(y0, y1, h - 2 * MARGIN, vertical=False)
    parts.extend([
        f'<line x1="0" y1="{origin_y:.2f}" x2="{w}" y2="{origin_y:.2f}" stroke="#333" stroke-width="1.5"/>',
        f'<line x1="{origin_x:.2f}" y1="0" x2="{origin_x:.2f}" y2="{h}" stroke="#333" stroke-width="1.5"/>',
    ])
    text = 'font-family="sans-serif" font-size="13" fill="#444"'
    for tick in x_labels:
        x = canvas.px(tick, 0)[0]
        parts.append(
            f'<text x="{x:.2f}" y="{origin_y + 16:.2f}" text-anchor="middle" {text}>{tick:g}</text>'
        )
    for tick in y_labels:
        y = canvas.px(0, tick)[1]
        parts.append(
            f'<text x="{origin_x - 6:.2f}" y="{y + 4:.2f}" text-anchor="end" {text}>{tick:g}</text>'
        )
    parts.extend([
        f'<text x="{w - 6}" y="{origin_y - 6:.2f}" text-anchor="end" {text} font-style="italic">x</text>',
        f'<text x="{origin_x + 6:.2f}" y="14" {text} font-style="italic">y</text>',
    ])

    for tool, drawing in initial:
        color = escape(tool.color, {'"': "&quot;"})
        for line in drawing.lines:
            path = " ".join(f"{x:.1f},{y:.1f}" for x, y in line)
            parts.append(
                f'<polyline points="{path}" fill="none" stroke="{color}" stroke-width="2.5"/>'
            )
        for x, y in drawing.dots:
            fill = "#fff" if tool.hollow else color
            parts.append(
                f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="{fill}" stroke="{color}" stroke-width="2"/>'
            )

    body = "\n  ".join(parts)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n  {body}\n</svg>\n'


@dataclass(frozen=True)
class Outcome:
    name: str
    ported: bool
    notes: list[str]


def port_question(
    source: Path, destination: Path, title: str | None = None
) -> list[Outcome]:
    html = (source / "question.html").read_text(encoding="utf-8")
    info = json.loads((source / "info.json").read_text(encoding="utf-8"))
    outcomes: list[Outcome] = []
    files: dict[str, str] = {}

    def convert(match: re.Match[str]) -> str:
        sketch = Sketch.parse(match.group(0))
        blockers = sketch.blockers()
        if blockers:
            outcomes.append(Outcome(sketch.name, ported=False, notes=blockers))
            return match.group(0)
        background = f"clientFilesQuestion/{sketch.name}-axes.svg"
        reference = f"{sketch.name}-reference.json"
        files[background] = sketch.background_svg()
        files[reference] = json.dumps(sketch.reference(), indent=2) + "\n"
        notes = [
            f"graded in {sketch.grading_mode()} mode with a {sketch.tolerance():g} px tolerance"
        ]
        if any(not tool.read_only for tool, _ in sketch.initial):
            notes.append(
                "editable starting drawings became part of the fixed background"
            )
        if any(g["type"] == "count" for g in sketch.graders):
            notes.append(
                "`count` is approximated: extra or missing marks lower the score"
            )
        if any(g.get("x-range") for g in sketch.graders):
            notes.append("ink outside the graded `x-range` now lowers the score")
        outcomes.append(Outcome(sketch.name, ported=True, notes=notes))
        return sketch.tablet_markup(Path(background).name, reference)

    ported_html = SKETCH_PATTERN.sub(convert, html)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "question.html").write_text(ported_html, encoding="utf-8")
    for name, contents in files.items():
        (destination / name).parent.mkdir(parents=True, exist_ok=True)
        (destination / name).write_text(contents, encoding="utf-8")
    ported_info = {
        "uuid": str(uuid.uuid4()),
        "title": title or f"{info['title']} (ported to pl-tablet-input)",
        "topic": info.get("topic", "Default"),
        "type": "v3",
        "gradingMethod": "Internal",
    }
    (destination / "info.json").write_text(
        json.dumps(ported_info, indent=2) + "\n", encoding="utf-8"
    )
    (destination / "README.md").write_text(report(source, outcomes), encoding="utf-8")
    return outcomes


def report(source: Path, outcomes: list[Outcome]) -> str:
    rows = "\n".join(
        f"| `{o.name}` | {'ported to `pl-tablet-input`' if o.ported else 'kept as `pl-sketch`'} | {'; '.join(o.notes)} |"
        for o in outcomes
    )
    return (
        f"Ported from `{source.name}` by the experimental `pl-tablet-input/experimental/port_from_sketch.py`.\n"
        "Randomization (`server.py`) is not carried over. Answer keys are generated from `pl-sketch-solution`, "
        "and can be redrawn in the drawing builder.\n\n"
        f"| Canvas | Result | Notes |\n| --- | --- | --- |\n{rows}\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "source", type=Path, help="question directory containing pl-sketch canvases"
    )
    parser.add_argument(
        "destination", type=Path, help="new question directory to write"
    )
    parser.add_argument("--title", help="title for the new question")
    args = parser.parse_args()
    for outcome in port_question(args.source, args.destination, args.title):
        status = "ported" if outcome.ported else "kept"
        print(f"{outcome.name}: {status} ({'; '.join(outcome.notes)})")


if __name__ == "__main__":
    main()
