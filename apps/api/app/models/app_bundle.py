from datetime import datetime, timezone as dt_timezone
from typing import Optional

from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class AppBundle(Document):
    """
    One over-the-air web bundle for the Android app.

    The APK is a WebView around `apps/web`, so almost every change staff need is
    HTML/JS/CSS the app can fetch and swap in on its own — no reinstall, no USB.
    A row here is the pointer to one such bundle; the zip itself lives on a
    GitHub Release, because Render's filesystem does not survive the redeploy
    that publishes the bundle in the first place.

    The bundle is not a secret: it is byte-for-byte the same frontend already
    served to any browser that opens the Vercel site. What must not be forged is
    the *pointer*, which is why registering one takes a shared token and
    delivery is checksummed end to end.

    Rows are immutable once written apart from `active`. Rolling back is
    therefore re-activating an older row rather than editing a live one, so the
    history of what was served stays intact.
    """

    # Bundle version, distinct from the APK's versionName. Capgo compares this
    # string against the running bundle's, so it must change on every publish;
    # CI derives it from the commit to guarantee that.
    version: str
    # Public https:// URL of the zip. Fetched by the device directly.
    url: str
    # SHA-256 hex of the zip. The plugin recomputes it after download and
    # discards the bundle on mismatch, so a truncated or swapped file cannot be
    # promoted into the app.
    checksum: str
    platform: str = "android"

    # Lowest APK versionCode this bundle may be served to. A bundle that needs a
    # native capability the old APK lacks — a new plugin, a new permission —
    # would white-screen the app it landed on, and a WebView with no working JS
    # cannot fetch its own way out of that. Gating here is the only thing
    # standing between such a bundle and every tablet in the facility.
    min_version_code: int = 1

    # Only one row per platform is active at a time. Deactivating without
    # activating another simply stops OTA: devices keep the bundle they have.
    active: bool = False

    # Provenance, for working out what a device is actually running.
    commit_sha: Optional[str] = None
    notes: Optional[str] = None
    size_bytes: Optional[int] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(dt_timezone.utc))
    activated_at: Optional[datetime] = None

    class Settings:
        name = "app_bundles"
        indexes = [
            IndexModel([("platform", ASCENDING), ("version", ASCENDING)], unique=True),
            # The check endpoint runs on every app launch and only ever wants
            # the active row for a platform.
            IndexModel([("platform", ASCENDING), ("active", ASCENDING)]),
            IndexModel([("created_at", DESCENDING)]),
        ]
