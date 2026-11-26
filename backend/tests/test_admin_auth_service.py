from app.services.admin_auth_service import AdminAuthService


def test_admin_password_hash_roundtrip():
    password_hash = AdminAuthService.hash_password("secure-pass")

    assert AdminAuthService.verify_password("secure-pass", password_hash)
    assert not AdminAuthService.verify_password("wrong-pass", password_hash)


def test_admin_token_roundtrip():
    token = AdminAuthService.create_access_token("admin", "secret", minutes=5)

    assert AdminAuthService.decode_access_token(token, "secret") == "admin"
    assert AdminAuthService.decode_access_token(token, "other-secret") is None


def test_admin_token_rejects_expired_token():
    token = AdminAuthService.create_access_token("admin", "secret", minutes=-1)

    assert AdminAuthService.decode_access_token(token, "secret") is None
