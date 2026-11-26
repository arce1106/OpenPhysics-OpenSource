from fastapi.testclient import TestClient

from app.main import create_app


def test_learning_content_pane_static_route_serves_built_index():
    client = TestClient(create_app())

    response = client.get("/panes/learning-content/")

    assert response.status_code == 200
    assert "OpenPhysics Learning Content Pane" in response.text
    assert response.headers["cache-control"] == "no-cache, no-store, must-revalidate"
