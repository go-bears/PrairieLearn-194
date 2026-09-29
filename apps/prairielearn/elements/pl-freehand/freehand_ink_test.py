from typing import Any

import freehand_ink as ink
import numpy as np
import pytest


def answer(*strokes: list[tuple[float, float]], undone: bool = False) -> dict:
    return {
        "version": 1,
        "strokes": [
            {"undone": undone, "points": [{"x": x, "y": y} for x, y in stroke]}
            for stroke in strokes
        ],
    }


DIAGONAL = [(0.1, 0.1), (0.9, 0.9)]


def sample(drawing: dict) -> ink.Points:
    return ink.resample(ink.polylines(drawing, 100, 100), 1)


def test_polylines_skip_undone_strokes_and_scale_to_pixels() -> None:
    drawing = answer(DIAGONAL)
    drawing["strokes"].append({"undone": True, "points": [{"x": 0.5, "y": 0.5}]})
    [line] = ink.polylines(drawing, 200, 100)
    np.testing.assert_allclose(line, [[20, 10], [180, 90]])


@pytest.mark.parametrize(
    "points",
    [[{"x": 0.5}], [{"x": "a", "y": 0.5}], [{"x": 1.5, "y": 0.5}], ["oops"]],
)
def test_polylines_reject_malformed_points(points: list[Any]) -> None:
    with pytest.raises(ValueError, match=r"x and y|within"):
        ink.polylines({"strokes": [{"points": points}]}, 100, 100)


def test_resample_spaces_points_evenly() -> None:
    samples = ink.resample([np.array([[0.0, 0.0], [10.0, 0.0]])], 2)
    np.testing.assert_allclose(samples[:, 0], [0, 2, 4, 6, 8, 10])


def test_resample_caps_sample_count() -> None:
    assert (
        len(ink.resample([np.array([[0.0, 0.0], [1e6, 0.0]])], 1))
        <= ink.MAX_SAMPLES + 1
    )


def test_compact_keeps_only_visible_coordinates() -> None:
    drawing = answer(DIAGONAL)
    drawing["strokes"][0]["points"][0].update(dt=5, p=0.3)
    drawing["strokes"].append({"undone": True, "points": [{"x": 0.5, "y": 0.5}]})
    assert ink.compact(drawing) == {
        "version": 1,
        "strokes": [{"points": [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.9}]}],
    }


@pytest.mark.parametrize("mode", ["overlap", "function"])
def test_identical_drawings_match_fully(mode: str) -> None:
    reference = sample(answer(DIAGONAL))
    assert ink.match(reference, reference, mode, 3).f1 == pytest.approx(1)


@pytest.mark.parametrize("mode", ["overlap", "function"])
def test_shift_within_tolerance_matches(mode: str) -> None:
    shifted = sample(answer([(0.1, 0.12), (0.9, 0.92)]))
    assert ink.match(shifted, sample(answer(DIAGONAL)), mode, 4).f1 > 0.9


@pytest.mark.parametrize("mode", ["overlap", "function"])
def test_wrong_curve_does_not_match(mode: str) -> None:
    wrong = sample(answer([(0.1, 0.9), (0.9, 0.1)]))
    assert ink.match(wrong, sample(answer(DIAGONAL)), mode, 3).f1 < 0.2


def test_partial_drawing_has_full_precision_and_partial_recall() -> None:
    half = sample(answer([(0.1, 0.1), (0.5, 0.5)]))
    result = ink.overlap_match(half, sample(answer(DIAGONAL)), 3)
    assert result.precision == pytest.approx(1)
    assert result.recall == pytest.approx(0.5, abs=0.05)


def test_empty_drawing_scores_zero() -> None:
    assert ink.overlap_match(np.empty((0, 2)), sample(answer(DIAGONAL)), 3).f1 == 0


def test_emptiest_point_is_away_from_reference() -> None:
    x, y = ink.emptiest_point(sample(answer(DIAGONAL)), 100, 100)
    assert abs(x - y) > 0.8
