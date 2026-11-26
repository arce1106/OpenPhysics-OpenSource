import inspect
from app.api.student import improvement
from app.api.student.dependencies import get_current_learning_student_id


def test_improvement_entry_requires_an_active_authenticated_account():
    endpoints = [route.endpoint for route in improvement.router.routes]
    assert endpoints
    assert any(inspect.signature(endpoint).parameters.get("student_id") is not None
               and inspect.signature(endpoint).parameters["student_id"].default.dependency == get_current_learning_student_id
               for endpoint in endpoints)
