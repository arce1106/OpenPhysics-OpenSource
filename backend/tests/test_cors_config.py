from app.core.config import Settings


def test_default_cors_allows_local_capacitor_webview_origin(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    settings = Settings(_env_file=None)

    origins = {origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()}

    assert "http://10.0.2.2:5173" in origins
