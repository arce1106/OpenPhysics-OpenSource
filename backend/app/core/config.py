from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEV_ADMIN_AUTH_SECRET = "openphysics-dev-admin-secret"
DEV_STUDENT_AUTH_SECRET = "openphysics-dev-student-secret"
DEV_TEACHER_AUTH_SECRET = "openphysics-dev-teacher-secret"
DEV_ANSWER_IMAGE_SIGNING_SECRET = "openphysics-dev-answer-image-secret"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[3] / ".env"),
        extra="ignore",
    )

    app_env: str = "development"
    database_url: str = "postgresql+asyncpg://openphysics:openphysics@localhost:5543/openphysics_selfhost"
    redis_url: str = "redis://localhost:6389/0"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    # One backup grader for both text and images. These budgets include reasoning.
    deepseek_grading_model: str = "deepseek-flash"
    deepseek_grading_max_tokens: int = Field(default=65536, ge=1, le=393216)
    deepseek_paper_grading_max_tokens: int = Field(default=131072, ge=1, le=393216)
    ark_api_key: str = ""
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    doubao_tutor_model: str = ""
    paper_grading_provider: str = "doubao_single_pass"
    # Which grader answers first; the other one is the backup for every grading call.
    grading_primary_provider: Literal["deepseek", "doubao"] = "deepseek"
    admin_api_token: str = ""
    admin_username: str = "admin"
    admin_password_hash: str = ""
    admin_auth_secret: str = DEV_ADMIN_AUTH_SECRET
    admin_access_token_minutes: int = 60 * 8
    student_auth_secret: str = DEV_STUDENT_AUTH_SECRET
    # Teacher login stays off in production until a real secret is configured.
    teacher_auth_secret: str = DEV_TEACHER_AUTH_SECRET
    teacher_access_token_minutes: int = 60 * 12
    # Trusted teacher Web origin, reachable from the backend's PDF renderer.
    teacher_pdf_frontend_url: str = "http://teacher-frontend:5176/"
    # AI used to read collected paper homework, metered apart from students' own quotas.
    teacher_ai_calls_per_student: int = Field(default=3, ge=1, le=20)
    teacher_ai_daily_calls_per_teacher: int = Field(default=500, ge=0)
    teacher_ai_daily_calls_total: int = Field(default=3000, ge=0)
    teacher_ai_input_cost_per_million: float = Field(default=0.0, ge=0)
    teacher_ai_output_cost_per_million: float = Field(default=0.0, ge=0)
    teacher_ai_call_timeout_seconds: float = Field(default=60, ge=5, le=120)
    # Pre-grading reads every answer area of a student in one call; real papers took 40–60 s.
    teacher_ai_grading_timeout_seconds: float = Field(default=120, ge=5, le=300)
    teacher_ai_grading_concurrency: int = Field(default=4, ge=1, le=16)
    teacher_scan_max_upload_mb: int = Field(default=80, ge=1, le=500)
    teacher_scan_retention_days: int = Field(default=180, ge=7, le=730)
    answer_image_signing_secret: str = DEV_ANSWER_IMAGE_SIGNING_SECRET
    answer_image_url_ttl_seconds: int = 10 * 60
    # Clients renew through /auth/refresh-token while in use; this bounds an idle device.
    student_access_token_minutes: int = 60 * 24 * 30
    student_web_login_ticket_minutes: int = 2
    student_ai_daily_limit: int = Field(default=500, ge=0)
    student_ai_per_minute_limit: int = 12
    student_ai_daily_limit_enabled: bool = False
    student_ai_student_concurrency: int = Field(default=3, ge=1, le=3)
    student_ai_global_concurrency: int = Field(default=12, ge=1, le=100)
    student_ai_timeout_seconds: float = Field(default=90, ge=1, le=90)
    student_ai_paper_batch_timeout_seconds: float = Field(default=300, ge=1, le=300)
    # Per provider call inside one task: short, no SDK retry, and capped by what
    # is left of student_ai_timeout_seconds so fallbacks still get their turn.
    ai_vision_call_timeout_seconds: float = Field(default=60, ge=5, le=90)
    ai_paper_batch_call_timeout_seconds: float = Field(default=120, ge=5, le=150)
    ai_text_call_timeout_seconds: float = Field(default=25, ge=5, le=90)
    # Metered usage is the number of provider calls; one task makes at most this many.
    student_ai_max_model_calls: int = Field(default=30, ge=1, le=200)
    paper_fallback_concurrency: int = Field(default=3, ge=1, le=6)
    student_ai_queue_timeout_seconds: float = Field(default=15, ge=0.1, le=20)
    student_ai_result_retention_days: int = Field(default=7, ge=1, le=30)
    auth_trusted_proxy_cidrs: str = ""
    ephemeral_auth_retention_days: int = 7
    ai_usage_retention_days: int = 90
    mastery_forgetting_enabled: bool = False
    render_rich_content: bool = True
    web_search_api_key: str = ""
    web_search_api_url: str = ""
    cors_origins: str = (
        "http://localhost:5173,http://localhost:5174,"
        "http://10.0.2.2:5173,"
        "http://localhost,https://localhost,capacitor://localhost,ionic://localhost"
    )


    @model_validator(mode="after")
    def reject_development_secrets_in_production(self):
        if self.app_env.strip().lower() != "production":
            return self
        required_secrets = {
            "ADMIN_AUTH_SECRET": (self.admin_auth_secret, DEV_ADMIN_AUTH_SECRET),
            "STUDENT_AUTH_SECRET": (self.student_auth_secret, DEV_STUDENT_AUTH_SECRET),
            "ANSWER_IMAGE_SIGNING_SECRET": (
                self.answer_image_signing_secret,
                DEV_ANSWER_IMAGE_SIGNING_SECRET,
            ),
        }
        invalid = [
            name
            for name, (value, development_default) in required_secrets.items()
            if value == development_default or len(value.strip()) < 32
        ]
        if invalid:
            raise ValueError(f"Production secrets are missing or unsafe: {', '.join(invalid)}")
        return self

    def teacher_login_configured(self) -> bool:
        if self.app_env.strip().lower() != "production":
            return True
        secret = self.teacher_auth_secret
        return secret != DEV_TEACHER_AUTH_SECRET and len(secret.strip()) >= 32


settings = Settings()
