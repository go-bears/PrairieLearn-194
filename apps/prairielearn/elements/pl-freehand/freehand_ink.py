"""Ink geometry for pl-freehand: parsing strokes and comparing a drawing to a reference.

All geometry is in logical canvas pixels, so tolerances are independent of the
normalized [0, 1] coordinates stored in answers.
"""

import math
from typing import Any, NamedTuple

import numpy as np
import numpy.typing as npt

Points = npt.NDArray[np.float64]

# Caps the pairwise distance matrix in `overlap_match` at MAX_SAMPLES² entries.
MAX_SAMPLES = 1500


class Match(NamedTuple):
    precision: float
    """Share of the student's ink that lies near the reference."""
    recall: float
    """Share of the reference that the student's ink covers."""

    @property
    def f1(self) -> float:
        total = self.precision + self.recall
        return 2 * self.precision * self.recall / total if total else 0.0


def visible_strokes(answer: Any) -> list[list[dict[str, Any]]]:
    """Point lists of strokes still shown on the canvas (not undone or cleared)."""
    strokes = answer.get("strokes", []) if isinstance(answer, dict) else []
    return [
        stroke["points"]
        for stroke in strokes
        if isinstance(stroke, dict)
        and not stroke.get("undone")
        and isinstance(stroke.get("points"), list)
        and stroke["points"]
    ]


def polylines(answer: Any, width: float, height: float) -> list[Points]:
    """Visible strokes in canvas pixels. Raises ValueError on malformed points."""
    lines = []
    for points in visible_strokes(answer):
        try:
            coords = [(p["x"], p["y"]) for p in points]
        except (TypeError, KeyError) as exc:
            raise ValueError("Stroke points must have numeric x and y.") from exc
        if not all(isinstance(v, int | float) for xy in coords for v in xy):
            raise ValueError("Stroke points must have numeric x and y.")
        line = np.array(coords, dtype=float)
        if not np.all(np.isfinite(line)) or line.min() < 0 or line.max() > 1:
            raise ValueError("Stroke coordinates must be within [0, 1].")
        lines.append(line * (width, height))
    return lines


def compact(answer: Any) -> dict[str, Any]:
    """Visible strokes only, reduced to rounded coordinates: a reference, or an answer without telemetry."""
    return {
        "version": 1,
        "strokes": [
            {"points": [{"x": round(p["x"], 4), "y": round(p["y"], 4)} for p in points]}
            for points in visible_strokes(answer)
        ],
    }


def _dicts(value: Any) -> list[dict[str, Any]]:
    return (
        [item for item in value if isinstance(item, dict)]
        if isinstance(value, list)
        else []
    )


def _number(value: Any) -> float | None:
    return (
        value
        if isinstance(value, int | float) and not isinstance(value, bool)
        else None
    )


def summarize(answer: Any, width: float, height: float) -> dict[str, Any]:
    """An overview of how a drawing was made, for instructors' exports.

    Returns:
        Stroke, undo, clear, and cancellation counts; times in elapsed milliseconds
        since the question was opened; and `start_stroke`/`end_stroke`, the first and
        last points of the submitted drawing in canvas pixels.
    """
    strokes = _dicts(answer.get("strokes"))
    events = _dicts(answer.get("events"))
    lines = polylines(answer, width, height)
    started = [t for s in strokes if (t := _number(s.get("startedAt"))) is not None]
    ended = [t for s in strokes if (t := _number(s.get("endedAt"))) is not None]
    return {
        "strokes_submitted": len(lines),
        "undo_count": sum(event.get("type") == "undo" for event in events),
        # A clear logs one event per hidden stroke, all at the same time.
        "clear_count": len({
            event.get("at") for event in events if event.get("type") == "clear"
        }),
        "cancelled_strokes": sum(bool(stroke.get("cancelled")) for stroke in strokes),
        "first_stroke_started_ms": min(started, default=None),
        "last_stroke_ended_ms": max(ended, default=None),
        "response_duration_ms": _number(answer.get("responseDuration")),
        "start_stroke": [round(float(v)) for v in lines[0][0]] if lines else None,
        "end_stroke": [round(float(v)) for v in lines[-1][-1]] if lines else None,
    }


def resample(lines: list[Points], spacing: float) -> Points:
    """Evenly spaced samples (at most ~MAX_SAMPLES) so pen speed does not affect weight."""
    total_length = sum(_arc_lengths(line)[-1] for line in lines)
    spacing = max(spacing, total_length / MAX_SAMPLES)
    samples = [_resample_line(line, spacing) for line in lines]
    return np.concatenate(samples) if samples else np.empty((0, 2))


def _arc_lengths(line: Points) -> npt.NDArray[np.float64]:
    steps = np.linalg.norm(np.diff(line, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(steps)])


def _resample_line(line: Points, spacing: float) -> Points:
    arc = _arc_lengths(line)
    if arc[-1] == 0:
        return line[:1]
    at = np.linspace(0, arc[-1], math.ceil(arc[-1] / spacing) + 1)
    return np.column_stack([
        np.interp(at, arc, line[:, 0]),
        np.interp(at, arc, line[:, 1]),
    ])


def overlap_match(student: Points, reference: Points, tolerance: float) -> Match:
    """Compare ink as shapes: each sample counts if it is within `tolerance` of the other drawing."""
    if len(student) == 0 or len(reference) == 0:
        return Match(0.0, 0.0)
    distances = np.linalg.norm(student[:, None, :] - reference[None, :, :], axis=2)
    near = distances <= tolerance
    return Match(float(near.any(axis=1).mean()), float(near.any(axis=0).mean()))


def function_match(student: Points, reference: Points, tolerance: float) -> Match:
    """Compare ink as graphs y = f(x), one `tolerance`-wide column at a time."""
    student_cols, reference_cols = (
        _columns(student, tolerance),
        _columns(reference, tolerance),
    )
    if not student_cols or not reference_cols:
        return Match(0.0, 0.0)
    matched = sum(
        abs(student_cols[col] - reference_cols[col]) <= tolerance
        for col in student_cols.keys() & reference_cols.keys()
    )
    return Match(matched / len(student_cols), matched / len(reference_cols))


def _columns(points: Points, width: float) -> dict[int, float]:
    """Median y of the points in each x-column."""
    cols = np.floor(points[:, 0] / width).astype(int)
    return {
        int(col): float(np.median(points[cols == col, 1])) for col in np.unique(cols)
    }


MATCHERS = {"overlap": overlap_match, "function": function_match}


def match(student: Points, reference: Points, mode: str, tolerance: float) -> Match:
    return MATCHERS[mode](student, reference, tolerance)


def emptiest_point(
    reference: Points, width: float, height: float
) -> tuple[float, float]:
    """Normalized grid point farthest from the reference ink, for generating wrong answers."""
    xs, ys = np.meshgrid(np.linspace(0.05, 0.95, 19), np.linspace(0.05, 0.95, 19))
    grid = np.column_stack([xs.ravel(), ys.ravel()])
    distances = np.linalg.norm(
        (grid * (width, height))[:, None, :] - reference[None, :, :], axis=2
    ).min(axis=1)
    x, y = grid[distances.argmax()]
    return float(x), float(y)
