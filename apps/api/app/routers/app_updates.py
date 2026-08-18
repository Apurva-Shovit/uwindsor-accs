"""
Over-the-air web-bundle delivery for the Android app.

Speaks the protocol `@capgo/capacitor-updater` expects of a self-hosted update
server, so no third-party service holds the bundles: the app POSTs its current
state to /app-updates/check on launch and gets back either a bundle to fetch or
an `up_to_date` acknowledgement.

See apps/web/ANDROID.md ("Over-the-air updates") for the deploy flow that fills
this in, and app/models/app_bundle.py for why the zip is hosted off-box.
"""

import hmac
from datetime import datetime, timezone as dt_timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..config import settings
from ..core.limiter import limiter
from ..core.permissions import require_chair_or_admin
from ..models.app_bundle import AppBundle
from ..models.user import User

router = APIRouter(prefix="/app-updates", tags=["app-updates"])


# --- Device-facing -----------------------------------------------------------


class UpdateCheckRequest(BaseModel):
    """
    The body `@capgo/capacitor-updater` posts. Its field names are the plugin's,
    not ours, hence the snake_case that does not match the rest of the API.

    Every field is optional with a default: the plugin has added fields across
    releases and will add more, and an update check that 422s is an app frozen
    on whatever bundle it already has. Unknown fields are ignored for the same
    reason.
    """

    platform: str = "android"
    # The bundle currently running. "builtin" means the assets shipped in the
    # APK, i.e. this device has never taken an OTA update.
    version_name: str = "builtin"
    # The APK's versionName and versionCode - the native shell, which OTA
    # cannot change.
    version_build: str = ""
    version_code: str = ""
    version_os: str = ""
    device_id: str = ""
    app_id: str = ""
    custom_id: str = ""
    plugin_version: str = ""
    is_emulator: bool = False
    is_prod: bool = True

    model_config = {"extra": "ignore"}


def _up_to_date(current: str) -> dict:
    """
    The shape the plugin reads as "nothing to do".

    It keys off the presence of `kind`; a bare 200 with no body, or one carrying
    only a version, sends it down the download path instead.
    """
    return {
        "kind": "up_to_date",
        "message": "No new version available",
        "version": current or "builtin",
    }


def _parse_version_code(raw: str) -> Optional[int]:
    """
    The plugin sends versionCode as a string, and older builds sometimes send it
    empty. Returning None for anything unparseable lets the caller decide, which
    it does by withholding the update rather than guessing.
    """
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


@router.post("/check")
@limiter.limit(settings.RATE_LIMIT_APP_UPDATE_CHECK)
async def check_for_update(request: Request, body: UpdateCheckRequest):
    """
    Unauthenticated by necessity: the plugin checks at app launch, before anyone
    has signed in, and a device stuck on a broken bundle may have no way to sign
    in at all. Nothing here is user data - the response is the same for every
    device on a given APK version - and the answer is rate-limited per IP.

    Never raises: any failure short-circuits to "up to date", because leaving a
    working app alone is always the safe outcome of a failed update check.
    """
    current = body.version_name or "builtin"

    if not settings.APP_UPDATE_ENABLED:
        return _up_to_date(current)

    try:
        bundle = await AppBundle.find_one(
            {"platform": body.platform or "android", "active": True}
        )
    except Exception:
        # A database blip must not look like an error the plugin should retry
        # aggressively or surface to the user.
        return _up_to_date(current)

    if bundle is None:
        return _up_to_date(current)

    # Already running it. The plugin also compares, but answering up_to_date
    # here keeps it from re-downloading a bundle it has when its own comparison
    # is against a stale local record.
    if bundle.version == current:
        return _up_to_date(current)

    # Withhold a bundle whose native requirements this APK does not meet. An
    # unreadable versionCode is treated as too old for the same reason.
    device_code = _parse_version_code(body.version_code)
    if device_code is None or device_code < bundle.min_version_code:
        return _up_to_date(current)

    return {
        "version": bundle.version,
        "url": bundle.url,
        "checksum": bundle.checksum,
    }


# --- CI-facing ---------------------------------------------------------------


class BundleRegistration(BaseModel):
    version: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=2000)
    # SHA-256 hex. Length-checked here so a truncated or hex-less value fails at
    # publish time rather than on every device that tries to download it.
    checksum: str = Field(min_length=64, max_length=64, pattern="^[0-9a-fA-F]{64}$")
    platform: str = Field(default="android", pattern="^(android|ios)$")
    min_version_code: int = Field(default=1, ge=1)
    commit_sha: Optional[str] = Field(default=None, max_length=64)
    notes: Optional[str] = Field(default=None, max_length=2000)
    size_bytes: Optional[int] = Field(default=None, ge=0)
    activate: bool = True


async def require_publish_token(x_update_token: str = Header(default="")) -> None:
    """
    Shared-secret auth for the publish endpoints, which run from CI where there
    is no user to sign in as.

    `compare_digest` rather than `==`: this is a bearer secret compared on every
    call, and a plain comparison leaks its prefix through timing. An unset
    APP_UPDATE_TOKEN closes the endpoints rather than opening them, so a
    deployment that has not been given the secret cannot have its update pointer
    rewritten by whoever finds the URL.
    """
    expected = settings.APP_UPDATE_TOKEN
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Bundle publishing is not configured (APP_UPDATE_TOKEN unset).",
        )
    if not hmac.compare_digest(x_update_token or "", expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid update token.",
        )


@router.post("/bundles", dependencies=[Depends(require_publish_token)])
async def register_bundle(body: BundleRegistration):
    """
    Record a freshly built bundle, and by default make it the one devices get.

    Re-registering an existing version is an error rather than an overwrite: the
    plugin caches by version string, so devices that already took that version
    would never see the replacement, and the two would diverge silently.
    """
    existing = await AppBundle.find_one(
        {"platform": body.platform, "version": body.version}
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bundle {body.version} already registered for {body.platform}.",
        )

    bundle = AppBundle(
        version=body.version,
        url=body.url,
        checksum=body.checksum.lower(),
        platform=body.platform,
        min_version_code=body.min_version_code,
        commit_sha=body.commit_sha,
        notes=body.notes,
        size_bytes=body.size_bytes,
    )
    await bundle.insert()

    if body.activate:
        await _activate(bundle)

    return {
        "version": bundle.version,
        "platform": bundle.platform,
        "active": bundle.active,
        "min_version_code": bundle.min_version_code,
    }


async def _activate(bundle: AppBundle) -> None:
    """
    Point a platform at one bundle.

    The new row is activated before the old ones are cleared. The reverse order
    leaves a window in which no bundle is active, and a device checking inside
    that window is told it is up to date and waits for the next launch.
    """
    bundle.active = True
    bundle.activated_at = datetime.now(dt_timezone.utc)
    await bundle.save()

    others = await AppBundle.find(
        {"platform": bundle.platform, "active": True}
    ).to_list()
    for other in others:
        if str(other.id) == str(bundle.id):
            continue
        other.active = False
        await other.save()


# --- Admin-facing ------------------------------------------------------------


@router.get("/bundles")
async def list_bundles(
    platform: str = "android",
    current: User = Depends(require_chair_or_admin),
):
    """What has been published, newest first, and which one devices are getting."""
    bundles = (
        await AppBundle.find({"platform": platform})
        .sort("-created_at")
        .limit(50)
        .to_list()
    )
    return [
        {
            "version": b.version,
            "active": b.active,
            "min_version_code": b.min_version_code,
            "url": b.url,
            "checksum": b.checksum,
            "commit_sha": b.commit_sha,
            "notes": b.notes,
            "size_bytes": b.size_bytes,
            "created_at": b.created_at,
            "activated_at": b.activated_at,
        }
        for b in bundles
    ]


@router.post("/bundles/{version}/activate")
async def activate_bundle(
    version: str,
    platform: str = "android",
    current: User = Depends(require_chair_or_admin),
):
    """
    Roll forward or back to an already-published bundle.

    This is the recovery path when a bundle ships broken: re-activating the
    previous version pushes it to every device on next launch, which is faster
    than any APK could be rebuilt and redistributed.
    """
    bundle = await AppBundle.find_one({"platform": platform, "version": version})
    if bundle is None:
        raise HTTPException(status_code=404, detail=f"No bundle {version}.")
    await _activate(bundle)
    return {"version": bundle.version, "active": True}


@router.post("/bundles/deactivate")
async def deactivate_bundles(
    platform: str = "android",
    current: User = Depends(require_chair_or_admin),
):
    """
    Stop serving OTA updates without removing history.

    Devices keep whatever bundle they are on - this halts the channel, it does
    not revert anyone. To move devices back, activate an older bundle instead.
    """
    actives = await AppBundle.find({"platform": platform, "active": True}).to_list()
    for bundle in actives:
        bundle.active = False
        await bundle.save()
    return {"deactivated": [b.version for b in actives]}


@router.get("/status")
async def update_status(current: User = Depends(require_chair_or_admin)):
    """
    Whether OTA is wired up at all, mirroring /notifications/push-status.

    Distinguishes "no bundle has been published" from "publishing is not
    configured", which are the two ways this silently does nothing.
    """
    active = await AppBundle.find_one({"platform": "android", "active": True})
    return {
        "enabled": settings.APP_UPDATE_ENABLED,
        "publishing_configured": bool(settings.APP_UPDATE_TOKEN),
        "active_bundle": (
            {
                "version": active.version,
                "min_version_code": active.min_version_code,
                "activated_at": active.activated_at,
                "commit_sha": active.commit_sha,
            }
            if active
            else None
        ),
    }
