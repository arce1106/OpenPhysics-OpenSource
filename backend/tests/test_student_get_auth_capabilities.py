from app.api.student.auth import get_auth_capabilities

def test_distribution_never_advertises_removed_phone_services():
    import asyncio
    assert not any(asyncio.run(get_auth_capabilities()).values())
