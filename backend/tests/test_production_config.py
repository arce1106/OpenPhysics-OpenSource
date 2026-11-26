import pytest

from app.core.config import Settings


def test_production_config_rejects_development_secrets():
    with pytest.raises(ValueError, match="Production secrets"):
        Settings(
            app_env="production",
            admin_auth_secret="openphysics-dev-admin-secret",
            student_auth_secret="openphysics-dev-student-secret",
            answer_image_signing_secret="openphysics-dev-answer-image-secret",
        )


def test_production_config_accepts_independent_random_secrets():
    production_settings = Settings(
        app_env="production",
        admin_auth_secret="a" * 32,
        student_auth_secret="b" * 32,
        answer_image_signing_secret="c" * 32,
    )

    assert production_settings.app_env == "production"
