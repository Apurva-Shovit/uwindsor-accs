"""
Derived facility notifications.

Nothing here is written ahead of time by a scheduler — the API is a single
process that Render is free to spin down, so a cron-style generator would miss
whole days without anyone noticing. Instead every alert is recomputed from the
underlying tanks, logs, quarantines and projects on each request, and given a
deterministic key. Only the per-user read receipt is persisted (see
`NotificationRead`), which is what drives the unread dot on the bell.

Three rules are implemented:

* `water_quality_missing` — past the facility-local deadline (5 PM) with no
  daily water quality log for a tank on that day. Addressed to the staff the
  tank is assigned to; managers and above see every tank plus who owns it.
* `quarantine_expiring`   — a tank's quarantine window closes within a day.
* `aupp_expiring`         — an active project's AUPP lapses within a month.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

from pymongo.errors import BulkWriteError, DuplicateKeyError

from ..config import settings
from ..models.facility import Tank
from ..models.notification import NotificationRead
from ..models.project import Project
from ..models.tank_assignment import TankAssignment
from ..models.user import RoleEnum, StatusEnum, User
from ..models.water_quality_log import WaterQualityLog
from ..utils.facility_time import (
    as_utc,
    day_bounds_utc,
    facility_datetime,
    facility_now,
    facility_tz,
)

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}

WATER_QUALITY_MISSING = "water_quality_missing"
QUARANTINE_EXPIRING = "quarantine_expiring"
AUPP_EXPIRING = "aupp_expiring"

# The bell only ever shows this much history; the panel shows everything.
RECENT_WINDOW = timedelta(days=1)

# `created_at` is the moment an alert became due, which for an AUPP is a full
# month before the expiry — sorting on it alone would bury a lapsing licence
# under a week of daily log misses. Severity leads, recency breaks the tie.
_SEVERITY_RANK = {"critical": 0, "warning": 1, "info": 2}


def _is_manager_plus(user: User) -> bool:
    return user.role in MANAGER_PLUS


def _tank_sort_key(tank_number: str) -> tuple:
    """Tanks are numbered, so sort them numerically where the label allows it."""
    return (0, int(tank_number)) if str(tank_number).isdigit() else (1, str(tank_number))


def _join_tank_labels(labels: Sequence[str], limit: int = 3) -> str:
    shown = list(labels[:limit])
    remaining = len(labels) - len(shown)
    if remaining > 0:
        return f"{', '.join(shown)} and {remaining} more"
    if len(shown) > 1:
        return f"{', '.join(shown[:-1])} and {shown[-1]}"
    return shown[0] if shown else ""


def _format_day(day: date) -> str:
    # Built by hand rather than with %-d/%#d, which differ between glibc and the
    # Windows CRT and blow up on whichever one the code was not written against.
    return f"{day.strftime('%b')} {day.day}, {day.year}"


def _format_hour(hour: int) -> str:
    return f"{hour % 12 or 12} {'AM' if hour < 12 else 'PM'}"


class NotificationService:
    """Builds the notification feed for one user."""

    # ---------------------------------------------------------------- public

    @staticmethod
    async def list_notifications(current_user: User, window: str = "all") -> Dict[str, Any]:
        now_local = facility_now()
        now_utc = now_local.astimezone(timezone.utc)

        items: List[Dict[str, Any]] = []
        items += await NotificationService._water_quality_notifications(current_user, now_local)
        items += await NotificationService._quarantine_notifications(current_user, now_utc)
        items += await NotificationService._aupp_notifications(current_user, now_utc)

        read_keys = await NotificationService._read_keys(current_user, [i["key"] for i in items])
        for item in items:
            item["read"] = item["key"] in read_keys

        # Sorting and windowing happen on real datetimes; ISO strings only get
        # produced on the way out, so a stray microsecond cannot reorder a list.
        items.sort(
            key=lambda i: (_SEVERITY_RANK.get(i["severity"], 9), -i["created_at"].timestamp())
        )

        recent_cutoff = now_utc - RECENT_WINDOW
        recent = [i for i in items if i["created_at"] >= recent_cutoff]

        visible = recent if window == "recent" else items
        return {
            "items": [{**i, "created_at": i["created_at"].isoformat()} for i in visible],
            "total": len(items),
            "unread_count": sum(1 for i in items if not i["read"]),
            "recent_unread_count": sum(1 for i in recent if not i["read"]),
            "server_time": now_utc.isoformat(),
            "facility_time": now_local.isoformat(),
            "facility_timezone": str(facility_tz()),
        }

    @staticmethod
    async def mark_read(
        current_user: User,
        keys: Optional[List[str]] = None,
        mark_all: bool = False,
    ) -> Dict[str, Any]:
        if mark_all:
            feed = await NotificationService.list_notifications(current_user, window="all")
            keys = [i["key"] for i in feed["items"] if not i["read"]]

        keys = [k for k in (keys or []) if k]
        if not keys:
            return {"marked": 0}

        user_id = str(current_user.id)
        existing = await NotificationRead.find(
            {"user_id": user_id, "key": {"$in": keys}}
        ).to_list()
        already = {r.key for r in existing}

        fresh = [NotificationRead(user_id=user_id, key=k) for k in set(keys) - already]
        if fresh:
            try:
                await NotificationRead.insert_many(fresh)
            except (BulkWriteError, DuplicateKeyError):
                # Two tabs marking the same feed read at once; the receipt the
                # other one wrote is just as good as ours.
                pass
        return {"marked": len(fresh)}

    # --------------------------------------------------------------- helpers

    @staticmethod
    async def _read_keys(current_user: User, keys: List[str]) -> set:
        if not keys:
            return set()
        receipts = await NotificationRead.find(
            {"user_id": str(current_user.id), "key": {"$in": keys}}
        ).to_list()
        return {r.key for r in receipts}

    @staticmethod
    async def _assignee_map() -> Dict[str, List[str]]:
        """tank_id -> names of the active users that tank is assigned to."""
        users = await User.find({"status": StatusEnum.active.value}).to_list()
        mapping: Dict[str, List[str]] = {}
        for u in users:
            for tank_id in (u.assigned_tank_ids or []):
                mapping.setdefault(tank_id, []).append(f"{u.first_name} {u.last_name}".strip())
        return mapping

    @staticmethod
    def _project_link(user: User) -> str:
        return "/admin/projects" if _is_manager_plus(user) else "/staff/projects"

    # ------------------------------------------------------- rule: water quality

    @staticmethod
    async def _water_quality_notifications(
        current_user: User, now_local: datetime
    ) -> List[Dict[str, Any]]:
        deadline_hour = settings.WATER_QUALITY_DEADLINE_HOUR
        lookback = max(1, settings.WATER_QUALITY_MISSING_LOOKBACK_DAYS)
        today = now_local.date()

        # Only days whose 5 PM deadline has already passed can be "missed" — the
        # current day stays silent until then rather than nagging all morning.
        days = [
            today - timedelta(days=offset)
            for offset in range(lookback)
            if facility_datetime(today - timedelta(days=offset), deadline_hour) <= now_local
        ]
        if not days:
            return []

        tanks = await Tank.find({"deleted": False, "status": "active"}).to_list()
        if not _is_manager_plus(current_user):
            assigned = set(current_user.assigned_tank_ids or [])
            tanks = [t for t in tanks if str(t.id) in assigned]
        if not tanks:
            return []

        range_start, _ = day_bounds_utc(min(days))
        _, range_end = day_bounds_utc(max(days))
        logs = await WaterQualityLog.find(
            {"date": {"$gte": range_start, "$lt": range_end}}
        ).to_list()

        logged: Dict[str, set] = {}
        for log in logs:
            log_day = log.date.date() if isinstance(log.date, datetime) else log.date
            logged.setdefault(str(log_day), set()).add(log.tank_id)

        # Who else works a tank is facility staffing, not something a staff
        # member needs in order to log their own tank — so it is neither fetched
        # nor attached for them.
        manager_view = _is_manager_plus(current_user)
        assignees = await NotificationService._assignee_map() if manager_view else {}
        tz = facility_tz()

        notifications: List[Dict[str, Any]] = []
        for day in days:
            done = logged.get(day.isoformat(), set())
            missing = []
            for tank in tanks:
                if str(tank.id) in done:
                    continue
                # A tank added after the fact was never owed a log for that day.
                created = as_utc(tank.created_at)
                if created and created.astimezone(tz).date() > day:
                    continue
                missing.append(tank)

            if not missing:
                continue

            missing.sort(key=lambda t: _tank_sort_key(t.tank_number))
            labels = [f"Tank {t.tank_number}" for t in missing]
            is_today = day == now_local.date()

            notifications.append({
                "key": f"{WATER_QUALITY_MISSING}:{day.isoformat()}",
                "type": WATER_QUALITY_MISSING,
                "severity": "critical" if is_today else "warning",
                "title": (
                    f"Daily water quality log missing for {len(missing)} "
                    f"tank{'s' if len(missing) != 1 else ''}"
                ),
                "message": (
                    f"{_join_tank_labels(labels)} had no water quality log recorded by "
                    f"{_format_hour(deadline_hour)} on {_format_day(day)}."
                ),
                "created_at": facility_datetime(day, deadline_hour),
                "link": "/staff/log-entry",
                "meta": {
                    "date": day.isoformat(),
                    "deadline_hour": deadline_hour,
                    "tank_count": len(missing),
                    "tanks": [
                        {
                            "id": str(t.id),
                            "tank_number": t.tank_number,
                            **({"assignees": assignees.get(str(t.id), [])} if manager_view else {}),
                        }
                        for t in missing
                    ],
                },
            })

        return notifications

    # --------------------------------------------------------- rule: quarantine

    @staticmethod
    async def _quarantine_notifications(
        current_user: User, now_utc: datetime
    ) -> List[Dict[str, Any]]:
        warn_days = settings.QUARANTINE_EXPIRY_WARNING_DAYS
        tanks = await Tank.find({"deleted": False, "is_quarantined": True}).to_list()

        manager_view = _is_manager_plus(current_user)
        if not manager_view:
            assigned = set(current_user.assigned_tank_ids or [])
            tanks = [t for t in tanks if str(t.id) in assigned]

        notifications: List[Dict[str, Any]] = []
        for tank in tanks:
            end = as_utc(tank.quarantine_end_date)
            if not end:
                continue

            warn_from = end - timedelta(days=warn_days)
            if now_utc < warn_from:
                continue

            expired = now_utc >= end
            hours_left = (end - now_utc).total_seconds() / 3600
            if expired:
                detail = f"ended {_format_day(end.astimezone(facility_tz()).date())} and the tank is still flagged"
            elif hours_left >= 1:
                detail = f"ends in {int(hours_left)} hour{'s' if int(hours_left) != 1 else ''}"
            else:
                detail = "ends in under an hour"

            notifications.append({
                "key": f"{QUARANTINE_EXPIRING}:{str(tank.id)}:{end.date().isoformat()}",
                "type": QUARANTINE_EXPIRING,
                "severity": "critical" if expired else "warning",
                "title": (
                    f"Quarantine expired on Tank {tank.tank_number}"
                    if expired
                    else f"Quarantine ending on Tank {tank.tank_number}"
                ),
                "message": f"The quarantine window for Tank {tank.tank_number} {detail}.",
                "created_at": warn_from,
                "link": "/staff/quarantine",
                "meta": {
                    "tank_id": str(tank.id),
                    "tank_number": tank.tank_number,
                    "quarantine_end_date": end.isoformat(),
                    "expired": expired,
                    # When the window opened is history a manager reviews; staff
                    # only need to know when it closes.
                    **(
                        {
                            "quarantine_start_date": (
                                as_utc(tank.quarantine_start_date).isoformat()
                                if tank.quarantine_start_date
                                else None
                            )
                        }
                        if manager_view
                        else {}
                    ),
                },
            })

        return notifications

    # --------------------------------------------------------------- rule: AUPP

    @staticmethod
    async def _aupp_notifications(
        current_user: User, now_utc: datetime
    ) -> List[Dict[str, Any]]:
        warn_days = settings.AUPP_EXPIRY_WARNING_DAYS
        projects = await Project.find({"status": "active"}).to_list()

        manager_view = _is_manager_plus(current_user)
        if not manager_view:
            assigned = list(current_user.assigned_tank_ids or [])
            if not assigned:
                return []
            # Staff only hear about the projects actually sitting in their tanks.
            assignments = await TankAssignment.find({"tank_id": {"$in": assigned}}).to_list()
            visible = {a.project_id for a in assignments}
            projects = [p for p in projects if str(p.id) in visible]

        link = NotificationService._project_link(current_user)
        tz = facility_tz()

        notifications: List[Dict[str, Any]] = []
        for project in projects:
            expiry = as_utc(project.aupp_expiry_date)
            if not expiry:
                continue

            warn_from = expiry - timedelta(days=warn_days)
            if now_utc < warn_from:
                continue

            expiry_day = expiry.astimezone(tz).date()
            days_left = (expiry_day - now_utc.astimezone(tz).date()).days
            expired = days_left < 0

            if expired:
                detail = f"expired on {_format_day(expiry_day)}"
                severity = "critical"
            elif days_left == 0:
                detail = "expires today"
                severity = "critical"
            else:
                detail = f"expires in {days_left} day{'s' if days_left != 1 else ''} ({_format_day(expiry_day)})"
                severity = "critical" if days_left <= 7 else "warning"

            notifications.append({
                "key": f"{AUPP_EXPIRING}:{str(project.id)}:{expiry_day.isoformat()}",
                "type": AUPP_EXPIRING,
                "severity": severity,
                "title": (
                    f"AUPP {project.aupp_number} has expired"
                    if expired
                    else f"AUPP {project.aupp_number} expiring"
                ),
                # The PI is who a manager chases about a renewal; staff just need
                # to know which of their projects is running out.
                "message": (
                    f"“{project.title}” (PI {project.pi_name}) {detail}."
                    if manager_view
                    else f"“{project.title}” {detail}."
                ),
                "created_at": warn_from,
                "link": link,
                "meta": {
                    "project_id": str(project.id),
                    "project_title": project.title,
                    "aupp_number": project.aupp_number,
                    "aupp_expiry_date": expiry.isoformat(),
                    "days_left": days_left,
                    "expired": expired,
                    **({"pi_name": project.pi_name} if manager_view else {}),
                },
            })

        return notifications
