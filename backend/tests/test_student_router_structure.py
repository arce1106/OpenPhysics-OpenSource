def test_student_router_keeps_public_route_paths_after_split():
    import fastapi.dependencies.utils as dependency_utils

    dependency_utils.ensure_multipart_is_installed = lambda: None

    from app.api.student.router import router

    routes = {
        (next(iter(route.methods - {"HEAD", "OPTIONS"}), ""), route.path)
        for route in router.routes
        if hasattr(route, "methods")
    }

    expected = {
        ("POST", "/api/student/auth/login"),
        ("GET", "/api/student/auth/capabilities"),
        ("GET", "/api/student/auth/captcha"),
        ("GET", "/api/student/auth/me"),
        ("GET", "/api/student/practice/session"),
        ("POST", "/api/student/practice/submit"),
        ("POST", "/api/student/practice/submit-paper-batch"),
        ("GET", "/api/student/history/answers"),
        ("GET", "/api/student/review"),
        ("GET", "/api/student/learn/{kp_id}"),
        ("POST", "/api/student/learn/chat"),
        ("GET", "/api/student/directory"),
        ("GET", "/api/student/learning-catalogs/{catalog_code}"),
        ("GET", "/api/student/learning-catalogs/{catalog_code}/resume"),
        (
            "GET",
            "/api/student/learning-catalogs/{catalog_code}/nodes/{node_id}/overview",
        ),
        (
            "POST",
            "/api/student/learning-catalogs/{catalog_code}/nodes/{node_id}/evidence",
        ),
        (
            "POST",
            "/api/student/learning-catalogs/{catalog_code}/nodes/{node_id}/session",
        ),
        ("POST", "/api/student/diagnose/kp/{kp_id}"),
        ("POST", "/api/student/diagnose/kp/{kp_id}/submitted-feedback"),
        ("POST", "/api/student/diagnose/scope"),
        ("POST", "/api/student/diagnose/scope/submitted-feedback"),
    }

    assert expected.issubset(routes)
    removed = {"/api/student/auth/registration-code", "/api/student/auth/register",
               "/api/student/auth/phone-access", "/api/student/auth/phone-bind",
               "/api/student/auth/password-reset", "/api/student/payments"}
    assert not {path for _, path in routes} & removed
