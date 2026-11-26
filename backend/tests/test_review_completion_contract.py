import inspect

from app.api.student import journey


def test_complete_review_keeps_legacy_body_optional():
    signature = inspect.signature(journey.complete_review)

    assert signature.parameters["body"].default is None
