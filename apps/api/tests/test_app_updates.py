"""
Gating rules for over-the-air bundle delivery.

The failure this guards against is not a wrong JSON field — it is a bundle
reaching a device that cannot run it. An APK whose WebView loads a bundle
needing a plugin it does not have shows a white screen, and a white screen has
no working JavaScript with which to check for the fix. Every path below
therefore asserts that the server withholds rather than guesses.
"""

import pytest

from app.db import init_db
from app.config import settings
from app.models.app_bundle import AppBundle
from app.routers.app_updates import UpdateCheckRequest, check_for_update


async def _clear():
    for b in await AppBundle.find({"platform": "test-android"}).to_list():
        await b.delete()


def _req(**kw):
    kw.setdefault("platform", "test-android")
    return UpdateCheckRequest(**kw)


async def _check(body):
    # The route body is what holds the logic; `request` is only there for the
    # per-IP limiter, which conftest disables for the suite.
    return await check_for_update.__wrapped__(request=None, body=body)


@pytest.mark.asyncio
async def test_serves_active_bundle_to_new_enough_apk():
    await init_db()
    await _clear()

    bundle = AppBundle(
        version="2026.08.18-abc1234",
        url="https://example.invalid/bundle.zip",
        checksum="a" * 64,
        platform="test-android",
        min_version_code=5,
        active=True,
    )
    await bundle.insert()

    res = await _check(_req(version_name="builtin", version_code="5"))

    assert res["version"] == "2026.08.18-abc1234"
    assert res["url"] == "https://example.invalid/bundle.zip"
    assert res["checksum"] == "a" * 64
    # An update response must carry no `kind`: the plugin treats the presence of
    # that key as "nothing to download" and would skip the bundle entirely.
    assert "kind" not in res

    await _clear()


@pytest.mark.asyncio
async def test_withholds_bundle_from_older_apk():
    """The white-screen case: bundle needs versionCode 6, device is on 5."""
    await init_db()
    await _clear()

    bundle = AppBundle(
        version="2026.08.18-needs-native",
        url="https://example.invalid/bundle.zip",
        checksum="b" * 64,
        platform="test-android",
        min_version_code=6,
        active=True,
    )
    await bundle.insert()

    res = await _check(_req(version_name="builtin", version_code="5"))

    assert res["kind"] == "up_to_date"
    assert "url" not in res

    await _clear()


@pytest.mark.asyncio
async def test_unparseable_version_code_is_treated_as_too_old():
    """
    Older plugin builds have sent an empty versionCode. Guessing "probably new
    enough" here would push a native-dependent bundle to an unknown APK.
    """
    await init_db()
    await _clear()

    bundle = AppBundle(
        version="2026.08.18-xyz",
        url="https://example.invalid/bundle.zip",
        checksum="c" * 64,
        platform="test-android",
        min_version_code=1,
        active=True,
    )
    await bundle.insert()

    for bad in ("", "not-a-number", "5.1"):
        res = await _check(_req(version_name="builtin", version_code=bad))
        assert res["kind"] == "up_to_date", f"versionCode {bad!r} should withhold"

    await _clear()


@pytest.mark.asyncio
async def test_device_already_on_active_bundle_is_told_up_to_date():
    await init_db()
    await _clear()

    bundle = AppBundle(
        version="2026.08.18-same",
        url="https://example.invalid/bundle.zip",
        checksum="d" * 64,
        platform="test-android",
        min_version_code=1,
        active=True,
    )
    await bundle.insert()

    res = await _check(_req(version_name="2026.08.18-same", version_code="5"))

    assert res["kind"] == "up_to_date"
    assert res["version"] == "2026.08.18-same"

    await _clear()


@pytest.mark.asyncio
async def test_no_active_bundle_is_up_to_date_not_an_error():
    """A deployment that has never published must leave the APK's own assets alone."""
    await init_db()
    await _clear()

    inactive = AppBundle(
        version="2026.08.18-shelved",
        url="https://example.invalid/bundle.zip",
        checksum="e" * 64,
        platform="test-android",
        min_version_code=1,
        active=False,
    )
    await inactive.insert()

    res = await _check(_req(version_name="builtin", version_code="5"))

    assert res["kind"] == "up_to_date"
    assert res["version"] == "builtin"

    await _clear()


@pytest.mark.asyncio
async def test_kill_switch_stops_delivery_without_touching_bundles():
    """APP_UPDATE_ENABLED=false must halt the channel with no redeploy of the app."""
    await init_db()
    await _clear()

    bundle = AppBundle(
        version="2026.08.18-halted",
        url="https://example.invalid/bundle.zip",
        checksum="f" * 64,
        platform="test-android",
        min_version_code=1,
        active=True,
    )
    await bundle.insert()

    original = settings.APP_UPDATE_ENABLED
    settings.APP_UPDATE_ENABLED = False
    try:
        res = await _check(_req(version_name="builtin", version_code="5"))
        assert res["kind"] == "up_to_date"
        assert "url" not in res
    finally:
        settings.APP_UPDATE_ENABLED = original

    # The row is untouched, so flipping the flag back resumes delivery.
    still = await AppBundle.find_one({"platform": "test-android", "active": True})
    assert still is not None and still.version == "2026.08.18-halted"

    await _clear()
