from app.services.video_recommendation_service import VideoRecommendationService


def test_build_bilibili_query_includes_physics_context():
    svc = VideoRecommendationService(curated_videos={})

    query = svc.build_query(
        kp_name="有界磁场中的临界问题",
        volume="选择性必修 第二册",
        chapter="第一章 安培力与洛伦兹力",
        section="3.5 有界磁场中的临界问题",
    )

    assert "site:bilibili.com/video" in query
    assert "高中物理" in query
    assert "选择性必修二" in query
    assert "有界磁场中的临界问题" in query
    assert "安培力与洛伦兹力" in query


def test_build_bilibili_query_uses_current_volume_instead_of_fixed_elective2():
    svc = VideoRecommendationService(curated_videos={})

    query = svc.build_query(
        kp_name="平抛运动",
        volume="必修 第二册",
        chapter="第五章 抛体运动",
        section="平抛运动",
    )

    assert "必修 第二册" in query
    assert "选择性必修二" not in query


def test_curated_teacher_pick_is_the_only_recommendation_when_available():
    svc = VideoRecommendationService(curated_videos={
        "x2c1s3k05": [
            {
                "id": "tiao-lorentz-1",
                "title": "北大跳跳老师：带电粒子在有界磁场中的运动",
                "url": "https://www.bilibili.com/video/BVTEST123/",
                "uploader": "北大跳跳老师",
                "duration": "18:20",
                "play_count": "100万+",
                "category": "教师精选",
                "reason": "教师精选，高播放量，适合先看完整建模过程。",
            }
        ]
    })

    items = svc.fallback_recommendations(
        kp_id="x2c1s3k05",
        kp_name="有界磁场中的临界问题",
        volume="选择性必修 第二册",
        chapter="第一章 安培力与洛伦兹力",
        section="3.5 有界磁场中的临界问题",
    )

    assert len(items) == 1
    assert items[0]["source"] == "teacher_curated"
    assert items[0]["uploader"] == "北大跳跳老师"
    assert items[0]["category"] == "教师精选"


def test_fallback_recommendations_return_one_most_relevant_search_card():
    svc = VideoRecommendationService(curated_videos={})

    items = svc.fallback_recommendations(
        kp_id="x2c1s3k05",
        kp_name="有界磁场中的临界问题",
        volume="选择性必修 第二册",
        chapter="第一章 安培力与洛伦兹力",
        section="3.5 有界磁场中的临界问题",
    )

    assert len(items) == 1
    assert all(item["source"] == "bilibili_search" for item in items)
    assert all(item["url"].startswith("https://search.bilibili.com/all?keyword=") for item in items)
    assert "有界磁场" in items[0]["title"]
    assert items[0]["category"] == "最相关讲解"
    assert items[0]["match_focus"] == "物理讲解 高中物理 选择性必修二 有界磁场中的临界问题"
    assert "章节和知识点最贴近" not in items[0]["reason"]


def test_experiment_fallback_prefers_huayu_physics_experiment_search():
    svc = VideoRecommendationService(curated_videos={})

    items = svc.fallback_recommendations(
        kp_id="x2-experiment",
        kp_name="探究感应电流产生的条件",
        volume="选择性必修 第二册",
        chapter="第二章 电磁感应",
        section="实验：探究感应电流产生的条件",
    )

    assert len(items) == 1
    assert items[0]["uploader"] == "物理实验"
    assert items[0]["category"] == "实验优先"
    assert items[0]["match_focus"] == "物理实验 高中物理 选择性必修二 探究感应电流产生的条件"


def test_demonstration_recommendation_prefers_gaokao_lin_for_ampere_force():
    svc = VideoRecommendationService(curated_videos={})

    item = svc.demonstration_recommendation(
        kp_id="x2c1s1k01",
        kp_name="安培力",
        volume="选择性必修 第二册",
        chapter="第一章 安培力与洛伦兹力",
        section="安培力",
    )

    assert item is not None
    assert item["uploader"] == "物理演示"
    assert item["category"] == "演示实验"
    assert "安培力演示实验" in item["title"]
    assert item["match_focus"] == "物理演示 高中物理 选择性必修二 安培力 演示实验"


def test_curated_demonstration_video_overrides_search_card():
    svc = VideoRecommendationService(
        curated_videos={},
        curated_experiment_videos={
            "v1c2s4k01": [
                {
                    "id": "gaokao-lin-free-fall-g",
                    "title": "【高一物理】探究自由落体运动实验，测重力加速度g",
                    "url": "https://www.bilibili.com/video/BV1yQ4y1k7CL/",
                    "uploader": "高考物理林老师",
                    "duration": "02:18",
                    "play_count": 31944,
                    "reason": "用自由落体实验建立重力加速度的直观认识。",
                    "match_focus": "自由落体运动 测重力加速度g",
                }
            ]
        },
    )

    item = svc.demonstration_recommendation(
        kp_id="v1c2s4k01",
        kp_name="自由落体运动",
        volume="必修 第一册",
        chapter="匀变速直线运动的研究",
        section="2.4 自由落体运动",
    )

    assert item is not None
    assert item["source"] == "teacher_experiment_curated"
    assert item["url"] == "https://www.bilibili.com/video/BV1yQ4y1k7CL/"
    assert item["uploader"] == "高考物理林老师"
    assert item["category"] == "演示实验"
    assert item["match_focus"] == "自由落体运动 测重力加速度g"


def test_curated_demonstration_videos_return_all_teacher_picks():
    svc = VideoRecommendationService(
        curated_videos={},
        curated_experiment_videos={
            "x2c2s1k04": [
                {
                    "id": "lenz-demo-1",
                    "title": "楞次定律实验探究",
                    "url": "https://www.bilibili.com/video/BV1wzPezbEdX/",
                    "uploader": "高考物理林老师",
                    "reason": "实验一",
                },
                {
                    "id": "lenz-demo-2",
                    "title": "探究感应电流方向",
                    "url": "https://www.bilibili.com/video/BV1QP4y1Q7Qd/",
                    "uploader": "高考物理林老师",
                    "reason": "实验二",
                },
            ]
        },
    )

    items = svc.demonstration_recommendations(
        kp_id="x2c2s1k04",
        kp_name="楞次定律表述",
        volume="选择性必修 第二册",
        chapter="第二章 电磁感应",
        section="2.1 楞次定律",
    )

    assert [item["title"] for item in items] == ["楞次定律实验探究", "探究感应电流方向"]
    assert all(item["source"] == "teacher_experiment_curated" for item in items)


def test_distribution_has_no_automatic_operational_video_curations():
    svc = VideoRecommendationService(curated_videos={})

    item = svc.demonstration_recommendation(
        kp_id="v1c1s3k02",
        kp_name="平均速度与瞬时速度",
        volume="必修 第一册",
        chapter="运动的描述",
        section="1.3 位置变化快慢的描述——速度",
    )

    assert item is None
    assert svc.curated_videos == {}
    assert svc.curated_experiment_videos == {}
    assert svc.source_preferences == {}


def test_demonstration_recommendation_is_absent_for_non_demo_concepts():
    svc = VideoRecommendationService(curated_videos={})

    item = svc.demonstration_recommendation(
        kp_id="v1c1s1k01",
        kp_name="质点",
        volume="必修 第一册",
        chapter="第一章 运动的描述",
        section="质点 参考系",
    )

    assert item is None
