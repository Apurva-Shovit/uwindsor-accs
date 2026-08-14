"""
Delivery of notifications to Android devices via Firebase Cloud Messaging.

The in-app feed is derived on every read, so it needs no push channel. A device
whose app is closed has nothing polling on its behalf, though, and that is the
whole point of an alert about a deadline nobody is sitting in front of. This
module is the only place that talks to FCM.

It speaks the HTTP v1 API directly rather than pulling in firebase-admin. The
only thing the SDK would add here is the service-account token exchange, which
is one signed JWT against a documented endpoint — python-jose and httpx are
already dependencies, and google-auth/firebase-admin would be two more wheels on
every Render deploy for that one call.

Everything degrades to a no-op when FCM is not configured. That keeps the dev
loop, the test suite, and any deployment that does not want push from having to
care that this exists.
"""
import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx
from jose import jwt

from ..config import settings
from ..models.device_token import DeviceToken

logger = logging.getLogger(__name__)

_TOKEN_URI = "https://oauth2.googleapis.com/token"
_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_JWT_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer"

# FCM rejects a token permanently with these; anything else (quota, 5xx,
# transient auth) is worth retrying on the next sweep rather than dropping the
# device. Sending to a disabled row again is harmless, losing a real device is not.
_DEAD_TOKEN_STATUSES = {"UNREGISTERED", "NOT_FOUND", "INVALID_ARGUMENT"}

# One connection burst per sweep, not one per device serially. Kept well under
# FCM's per-project ceiling — a facility has tens of devices, not thousands.
_MAX_CONCURRENT_SENDS = 10

# Refresh a little before the hour Google grants, so a send never races expiry.
_TOKEN_SKEW_SECONDS = 120

_cached_access_token: Optional[str] = None
_cached_expiry: Optional[datetime] = None
_token_lock = asyncio.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load_service_account() -> Optional[Dict[str, Any]]:
    """
    Read the service-account credentials, from an inline env var or a file.

    Inline JSON is what Render and most container hosts can actually provide;
    the file path is for local runs where pasting a multi-line secret into a
    shell is worse than pointing at the download.
    """
    raw = (settings.FCM_SERVICE_ACCOUNT_JSON or "").strip()
    if not raw:
        path = (settings.FCM_SERVICE_ACCOUNT_FILE or "").strip()
        if not path:
            return None
        try:
            raw = Path(path).read_text(encoding="utf-8")
        except OSError as exc:
            logger.error("FCM service account file unreadable at %s: %s", path, exc)
            return None

    try:
        creds = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error("FCM service account is not valid JSON: %s", exc)
        return None

    missing = [k for k in ("client_email", "private_key", "project_id") if not creds.get(k)]
    if missing:
        logger.error("FCM service account is missing %s", ", ".join(missing))
        return None
    return creds


def is_enabled() -> bool:
    """True when push is configured well enough to attempt a send."""
    return _load_service_account() is not None


def project_id() -> Optional[str]:
    creds = _load_service_account()
    return creds.get("project_id") if creds else None


async def _access_token() -> Optional[str]:
    """
    An OAuth2 access token for the messaging scope, cached until it nears expiry.

    Google grants these for an hour and rate-limits the exchange, so minting one
    per notification would be both slow and self-defeating.
    """
    global _cached_access_token, _cached_expiry

    async with _token_lock:
        if _cached_access_token and _cached_expiry and _now() < _cached_expiry:
            return _cached_access_token

        creds = _load_service_account()
        if not creds:
            return None

        issued = _now()
        claims = {
            "iss": creds["client_email"],
            "scope": _SCOPE,
            "aud": _TOKEN_URI,
            "iat": int(issued.timestamp()),
            "exp": int((issued + timedelta(hours=1)).timestamp()),
        }

        try:
            assertion = jwt.encode(claims, creds["private_key"], algorithm="RS256")
        except Exception as exc:
            logger.error("could not sign the FCM service-account assertion: %s", exc)
            return None

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    _TOKEN_URI,
                    data={"grant_type": _JWT_GRANT, "assertion": assertion},
                )
        except httpx.HTTPError as exc:
            logger.error("FCM token exchange failed to connect: %s", exc)
            return None

        if resp.status_code != 200:
            logger.error("FCM token exchange rejected (%s): %s", resp.status_code, resp.text[:500])
            return None

        payload = resp.json()
        token = payload.get("access_token")
        if not token:
            logger.error("FCM token exchange returned no access_token")
            return None

        lifetime = int(payload.get("expires_in", 3600))
        _cached_access_token = token
        _cached_expiry = issued + timedelta(seconds=max(0, lifetime - _TOKEN_SKEW_SECONDS))
        return token


def _message(token: str, title: str, body: str, data: Dict[str, str]) -> Dict[str, Any]:
    """
    Build one FCM v1 envelope.

    It carries both a `notification` block and a `data` block deliberately. The
    former is what makes Android post a tray entry with the app closed, without
    the app running any code; the latter is what the WebView reads when the user
    taps through, so the app can route to the right screen rather than just open.
    """
    return {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            "data": data,
            "android": {
                # `high` is what wakes a dozing device. These are deadline and
                # biosecurity alerts, which is the case the priority exists for.
                "priority": "high",
                "notification": {
                    # Must match the channel the app creates at startup, or
                    # Android 8+ drops the message silently.
                    "channel_id": settings.FCM_ANDROID_CHANNEL_ID,
                    # Collapsing on the notification key means a re-sent alert
                    # replaces its own tray entry instead of stacking a
                    # duplicate every sweep.
                    "tag": data.get("key", ""),
                    "default_sound": True,
                },
            },
        }
    }


async def _send_one(
    client: httpx.AsyncClient,
    url: str,
    headers: Dict[str, str],
    device: DeviceToken,
    title: str,
    body: str,
    data: Dict[str, str],
    semaphore: asyncio.Semaphore,
) -> Tuple[bool, Optional[str]]:
    """Deliver to a single device. Returns (sent, dead_token_reason)."""
    async with semaphore:
        try:
            resp = await client.post(
                url, headers=headers, json=_message(device.token, title, body, data)
            )
        except httpx.HTTPError as exc:
            logger.warning("FCM send to %s failed to connect: %s", device.id, exc)
            return False, None

    if resp.status_code == 200:
        return True, None

    # The v1 API reports a dead token in the error detail, not the status line;
    # a 404 alone can also mean a bad project id, which must not disable devices.
    detail = ""
    try:
        payload = resp.json()
        error = payload.get("error", {})
        detail = error.get("status", "") or ""
        for item in error.get("details", []) or []:
            code = item.get("errorCode")
            if code:
                detail = code
                break
    except (ValueError, AttributeError):
        detail = resp.text[:200]

    if detail in _DEAD_TOKEN_STATUSES:
        return False, detail

    logger.warning("FCM send to %s rejected (%s): %s", device.id, resp.status_code, detail)
    return False, None


async def send_to_users(
    notifications_by_user: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, int]:
    """
    Push each user's new alerts to whatever devices they have registered.

    Takes the alerts already written to the feed rather than generating its own
    copy, so the tray entry and the in-app row can never disagree about what
    happened. A user with no registered device is simply skipped — the web feed
    is unaffected either way.
    """
    if not notifications_by_user:
        return {"sent": 0, "failed": 0, "devices": 0, "disabled": 0}

    creds = _load_service_account()
    if not creds:
        return {"sent": 0, "failed": 0, "devices": 0, "disabled": 0, "skipped": "not_configured"}

    access_token = await _access_token()
    if not access_token:
        return {"sent": 0, "failed": 0, "devices": 0, "disabled": 0, "skipped": "no_access_token"}

    devices = await DeviceToken.find({
        "user_id": {"$in": list(notifications_by_user)},
        "disabled_at": None,
    }).to_list()
    if not devices:
        return {"sent": 0, "failed": 0, "devices": 0, "disabled": 0}

    by_user: Dict[str, List[DeviceToken]] = {}
    for device in devices:
        by_user.setdefault(device.user_id, []).append(device)

    url = f"https://fcm.googleapis.com/v1/projects/{creds['project_id']}/messages:send"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
    }
    semaphore = asyncio.Semaphore(_MAX_CONCURRENT_SENDS)

    jobs = []
    job_devices: List[DeviceToken] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        for user_id, items in notifications_by_user.items():
            for device in by_user.get(user_id, []):
                title, body, data = _summarise(items)
                jobs.append(
                    _send_one(client, url, headers, device, title, body, data, semaphore)
                )
                job_devices.append(device)

        results = await asyncio.gather(*jobs, return_exceptions=True)

    sent = failed = disabled = 0
    now = _now()
    for device, result in zip(job_devices, results):
        if isinstance(result, BaseException):
            logger.warning("FCM send to %s raised: %s", device.id, result)
            failed += 1
            continue
        ok, dead_reason = result
        if ok:
            sent += 1
            continue
        failed += 1
        if dead_reason:
            device.disabled_at = now
            device.last_error = dead_reason
            await device.save()
            disabled += 1

    return {"sent": sent, "failed": failed, "devices": len(job_devices), "disabled": disabled}


def _summarise(items: List[Dict[str, Any]]) -> Tuple[str, str, Dict[str, str]]:
    """
    Reduce one user's new alerts to a single tray entry.

    A sweep that turns up four missed tanks should not post four notifications a
    second apart — that is how people learn to swipe the app's alerts away
    without reading them. One entry, and the app is one tap away from the detail.
    """
    if len(items) == 1:
        item = items[0]
        return (
            item.get("title", "ACARE"),
            item.get("message", ""),
            {
                "key": str(item.get("key", "")),
                "type": str(item.get("type", "")),
                "link": str(item.get("link", "")),
                "severity": str(item.get("severity", "info")),
            },
        )

    severities = {i.get("severity") for i in items}
    severity = "critical" if "critical" in severities else (
        "warning" if "warning" in severities else "info"
    )
    return (
        f"{len(items)} new ACARE alerts",
        "; ".join(i.get("title", "") for i in items[:3])
        + ("…" if len(items) > 3 else ""),
        {
            "key": "digest",
            "type": "digest",
            # The feed is the only place a digest can usefully land.
            "link": "/staff/notifications",
            "severity": severity,
        },
    )


async def prune_token(token: str) -> None:
    """Drop a registration the client itself reports as gone (sign-out, reinstall)."""
    doc = await DeviceToken.find_one({"token": token})
    if doc:
        await doc.delete()


async def register_token(user_id: str, token: str, platform: str = "android") -> DeviceToken:
    """
    Record a device against a user, reassigning it if it was someone else's.

    Capacitor hands the app the same token on every launch, so this is called far
    more often than it changes anything; it is written to be idempotent.
    """
    existing = await DeviceToken.find_one({"token": token})
    if existing:
        existing.user_id = user_id
        existing.platform = platform
        existing.last_seen_at = _now()
        # A device that re-registers is demonstrably alive, whatever FCM said
        # about it last time.
        existing.disabled_at = None
        existing.last_error = None
        await existing.save()
        return existing

    doc = DeviceToken(user_id=user_id, token=token, platform=platform)
    await doc.insert()
    return doc


def iter_user_ids(notifications: Iterable[Dict[str, Any]]) -> List[str]:
    return sorted({str(n.get("user_id")) for n in notifications if n.get("user_id")})
