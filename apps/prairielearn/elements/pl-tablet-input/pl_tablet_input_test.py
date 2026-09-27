import importlib
from typing import Any

import pytest

pl_tablet_input = importlib.import_module("pl-tablet-input")


def make_question_data() -> dict[str, Any]:
    return {"answers_names": {}}


def test_prepare_accepts_defaults() -> None:
    pl_tablet_input.prepare(
        '<pl-tablet-input answers-name="writing"></pl-tablet-input>',
        make_question_data(),
    )


@pytest.mark.parametrize(
    "element_html",
    [
        '<pl-tablet-input answers-name="writing" width="0"></pl-tablet-input>',
        '<pl-tablet-input answers-name="writing" height="0"></pl-tablet-input>',
        '<pl-tablet-input answers-name="writing" max-points="0"></pl-tablet-input>',
    ],
)
def test_prepare_rejects_non_positive_dimensions(element_html: str) -> None:
    with pytest.raises(ValueError, match="positive"):
        pl_tablet_input.prepare(element_html, make_question_data())


def test_prepare_rejects_duplicate_answer_name() -> None:
    data = make_question_data()
    pl_tablet_input.prepare(
        '<pl-tablet-input answers-name="writing"></pl-tablet-input>', data
    )
    with pytest.raises(KeyError, match="Duplicate"):
        pl_tablet_input.prepare(
            '<pl-tablet-input answers-name="writing"></pl-tablet-input>', data
        )
