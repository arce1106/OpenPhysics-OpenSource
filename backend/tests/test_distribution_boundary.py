"""Keep the private experimental application out of the self-hosted distribution."""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.core.config import Settings
from app.models import Base


ROOT = Path(__file__).resolve().parents[2]
PRIVATE_COMPONENT = "coach"


def test_private_component_has_no_distributed_modules_or_model_tables():
    for directory in ["backend/app", "backend/tests", "frontend", "scripts"]:
        for path in (ROOT / directory).rglob("*"):
            if any(part in {"node_modules", "dist", "__pycache__"} for part in path.parts):
                continue
            assert PRIVATE_COMPONENT not in path.name.lower(), str(path.relative_to(ROOT))
    assert not any(name.startswith(PRIVATE_COMPONENT + "_") for name in Base.metadata.tables)
    assert not any(name.startswith(PRIVATE_COMPONENT + "_") for name in Settings.model_fields)
    # The remaining application's foreign keys must all resolve after removing the private models.
    for table in Base.metadata.tables.values():
        for foreign_key in table.foreign_keys:
            assert foreign_key.column.table.name in Base.metadata.tables


def test_public_migration_graph_is_connected_without_private_application_revisions():
    config = Config()
    config.set_main_option("script_location", str(ROOT / "backend/alembic"))
    migrations = ScriptDirectory.from_config(config)
    assert len(migrations.get_heads()) == 1
    revisions = list(migrations.walk_revisions())
    assert revisions
    assert not any(PRIVATE_COMPONENT in Path(revision.path).name.lower() for revision in revisions)


def test_public_runtime_manifests_exclude_private_component():
    for relative in ["docker-compose.yml", ".env.example", ".github/workflows/checks.yml"]:
        assert PRIVATE_COMPONENT not in (ROOT / relative).read_text().lower(), relative


def test_distribution_excludes_billing_models_settings_and_implementations():
    forbidden = ("payment", "membership_entitlement", "apple_iap")
    assert not any(name.startswith(forbidden) for name in Base.metadata.tables)
    assert not any(column.name.startswith("subscription_") or column.name == "trial_used"
                   for column in Base.metadata.tables["students"].columns)
    assert not any(name.startswith(("wechat_pay_", "apple_iap_", "apple_review_"))
                   for name in Settings.model_fields)
    for relative in ["backend/app/api/payment", "backend/app/services/membership_service.py",
                     "backend/app/services/wechat_pay_service.py", "backend/app/services/apple_iap_service.py",
                     "frontend/admin/src/components/PaymentsPage.tsx",
                     "frontend/student/src/pages/MembershipPage.tsx",
                     "frontend/student/src/pages/PaymentCheckoutPage.tsx",
                     "mobile/openphysics-ios/OpenPhysicsIOS/Features/Membership/AppleMembershipStore.swift",
                     "mobile/openphysics-ios/OpenPhysicsIOS/Features/Membership/MembershipView.swift",
                     "mobile/openphysics-ios/OpenPhysicsIOS/Models/MembershipModels.swift",
                     "mobile/openphysics-android/app/src/main/java/cn/openphysics/androidapp/data/api/MembershipLinks.kt"]:
        path = ROOT / relative
        assert not path.is_file() and not list(path.glob("*.py")), relative


def test_distribution_excludes_old_question_bank_repair_payloads_and_payment_roots():
    # Original-bank correction packs remain private even though this distribution
    # now provides its own original concept examples across the taxonomy.
    assert not list((ROOT / "backend/app/services").glob("*_label_repair.json"))
    assert not list((ROOT / "backend/certs/apple").glob("*.cer"))


def test_core_distribution_deletes_operational_implementations():
    for relative in [
        'deploy', 'backend/Dockerfile', 'backend/Dockerfile.base', 'backend/entrypoint.sh',
        'backend/app/services/registration_sms.py', 'backend/app/services/registration_limiter.py',
        'backend/app/seed/teacher_papers.json', 'backend/app/seed/question_videos.json',
        'backend/alembic/versions/0026_account_security_code_owner.py',
        'mobile/openphysics-android/app/src/main/java/cn/openphysics/androidapp/update',
        'mobile/openphysics-android/release-notes.json',
    ]:
        assert not (ROOT / relative).exists(), relative
    assert 'student_registration_codes' not in Base.metadata.tables
    assert not any(name.startswith(('tencentcloud_', 'sms_')) for name in Settings.model_fields)
    requirements = (ROOT / 'backend/requirements.txt').read_text()
    assert 'tencentcloud-sdk' not in requirements
    manifest = (ROOT / 'mobile/openphysics-android/app/src/main/AndroidManifest.xml').read_text()
    assert 'REQUEST_INSTALL_PACKAGES' not in manifest
    from app.services import teacher_paper_service
    for name in ['_papers', 'find_teacher_paper', 'paper_overviews', 'import_legacy_attempt', 'unlock_videos']:
        assert not hasattr(teacher_paper_service, name)
