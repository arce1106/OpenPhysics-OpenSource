from app.services.physics_models import (
    infer_model_ids_from_kp,
    model_name,
    related_model_ids,
)


def test_infer_model_ids_from_kp_name_and_chapter():
    inferred = infer_model_ids_from_kp(
        kp_name="自由落体运动规律",
        chapter="匀变速直线运动",
        section="自由落体运动",
    )

    assert "free_fall" in inferred
    assert "uniform_acceleration" in inferred


def test_related_model_ids_include_prerequisites_and_transfer_targets():
    related = related_model_ids("free_fall")

    assert "uniform_acceleration" in related
    assert "projectile" in related


def test_model_name_falls_back_to_original_id():
    assert model_name("newton_second") == "牛顿第二定律模型"
    assert model_name("not_a_model") == "not_a_model"
