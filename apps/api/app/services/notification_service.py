"""
Facility notifications: generation, reconciliation, and the read feed.

A background sweeper (see `notification_scheduler`) recomputes the whole picture
on a fixed interval and reconciles it against what is stored, so serving the feed
is a single indexed query. Each pass rebuilds the entire lookback window from
live data rather than only looking at "what changed since last time", which means
a pass missed while the service was spun down is silently backfilled by the next
one instead of leaving a permanent hole.

Three rules are implemented:

* `water_quality_missing` — past the 17:00 UTC deadline with no daily water
  quality log for a tank on that day. Addressed to the staff the tank is
  assigned to; managers and above see every tank plus who owns it.
* `quarantine_expiring`   — a tank's quarantine window closes within a day.
* `aupp_expiring`         — an active project's AUPP lapses within a month.

The first records a fact about a moment that has passed, so it is written once
and never rewritten. The other two describe a live countdown, so they are
refreshed every pass and deleted the moment the condition clears.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence

from ..config import settings
from ..models.facility import Tank
from ..models.notification import Notification, NotificationSweepState
from ..models.project import Project
from ..models.tank_assignment import TankAssignment
from ..models.user import RoleEnum, StatusEnum, User
from ..models.water_quality_log import WaterQualityLog
from ..utils.server_time import as_utc, day_bounds, server_datetime, server_now

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}

WATER_QUALITY_MISSING = "water_quality_missing"
QUARANTINE_EXPIRING = "quarantine_expiring"
AUPP_EXPIRING = "aupp_expiring"

# Written once, then left alone: the alert states what was true at a deadline
# that has already passed, so logging a tank late does not un-miss the deadline
# and must not silently rewrite the record.
STICKY_TYPES = {WATER_QUALITY_MISSING}

# The bell only ever shows this much history; the panel shows everything.
RECENT_WINDOW = timedelta(days=1)

# `created_at` is the moment an alert became due, which for an AUPP is a full
# month before the expiry — sorting on it alone would bury a lapsing licence
# under a week of daily log misses. Severity leads, recency breaks the tie.
_SEVERITY_RANK = {"critical": 0, "warning": 1, "info": 2}

# Fields the sweeper refreshes on a live alert. `read` and `read_at` are
# deliberately absent: a countdown ticking down is not a reason to mark
# something unread again.
_MUTABLE_FIELDS = ("severity", "title", "message", "link", "meta", "created_at")


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


@dataclass
class FacilitySnapshot:
    """
    Everything the three rules need, read once per sweep.

    The rules are evaluated for every active user, so without this each pass
    would re-read the same tanks, logs and projects once per person. Capturing
    first also makes the rule functions synchronous and pure, which is what lets
    them be tested against a hand-built snapshot.
    """
    now: datetime
    days: List[date] = field(default_factory=list)
    tanks: List[Tank] = field(default_factory=list)
    logged_by_day: Dict[str, set] = field(default_factory=dict)
    projects: List[Project] = field(default_factory=list)
    project_tanks: Dict[str, set] = field(default_factory=dict)
    assignees: Dict[str, List[str]] = field(default_factory=dict)

    @classmethod
    async def capture(cls, now: Optional[datetime] = None) -> "FacilitySnapshot":
        now = now or server_now()
        deadline_hour = settings.WATER_QUALITY_DEADLINE_HOUR
        lookback = max(1, settings.WATER_QUALITY_MISSING_LOOKBACK_DAYS)
        today = now.date()

        # Only days whose deadline has already passed can be "missed" — the
        # current day stays silent until then rather than nagging all morning.
        days = [
            today - timedelta(days=offset)
            for offset in range(lookback)
            if server_datetime(today - timedelta(days=offset), deadline_hour) <= now
        ]

        tanks = await Tank.find({"deleted": False, "status": "active"}).to_list()
        projects = await Project.find({"status": "active"}).to_list()
        assignments = await TankAssignment.find({}).to_list()
        users = await User.find({"status": StatusEnum.active.value}).to_list()

        logged_by_day: Dict[str, set] = {}
        if days:
            range_start, _ = day_bounds(min(days))
            _, range_end = day_bounds(max(days))
            logs = await WaterQualityLog.find(
                {"date": {"$gte": range_start, "$lt": range_end}}
            ).to_list()
            for log in logs:
                log_day = log.date.date() if isinstance(log.date, datetime) else log.date
                logged_by_day.setdefault(str(log_day), set()).add(log.tank_id)

        project_tanks: Dict[str, set] = {}
        for a in assignments:
            if a.project_id and a.tank_id:
                project_tanks.setdefault(a.project_id, set()).add(a.tank_id)

        assignees: Dict[str, List[str]] = {}
        for u in users:
            for tank_id in (u.assigned_tank_ids or []):
                assignees.setdefault(tank_id, []).append(f"{u.first_name} {u.last_name}".strip())

        return cls(
            now=now,
            days=days,
            tanks=tanks,
            logged_by_day=logged_by_day,
            projects=projects,
            project_tanks=project_tanks,
            assignees=assignees,
        )


class NotificationRules:
    """Builds the alerts one user should currently be holding."""

    @staticmethod
    def for_user(user: User, snap: FacilitySnapshot) -> List[Dict[str, Any]]:
        return [
            *NotificationRules.water_quality(user, snap),
            *NotificationRules.quarantine(user, snap),
            *NotificationRules.aupp(user, snap),
        ]

    # ------------------------------------------------------- rule: water quality

    @staticmethod
    def water_quality(user: User, snap: FacilitySnapshot) -> List[Dict[str, Any]]:
        if not snap.days:
            return []

        manager_view = _is_manager_plus(user)
        tanks = snap.tanks
        if not manager_view:
            assigned = set(user.assigned_tank_ids or [])
            tanks = [t for t in tanks if str(t.id) in assigned]
        if not tanks:
            return []

        deadline_hour = settings.WATER_QUALITY_DEADLINE_HOUR
        notifications: List[Dict[str, Any]] = []

        for day in snap.days:
            done = snap.logged_by_day.get(day.isoformat(), set())
            missing = []
            for tank in tanks:
                if str(tank.id) in done:
                    continue
                # A tank added after the fact was never owed a log for that day.
                created = as_utc(tank.created_at)
                if created and created.date() > day:
                    continue
                missing.append(tank)

            if not missing:
                continue

            missing.sort(key=lambda t: _tank_sort_key(t.tank_number))
            labels = [f"Tank {t.tank_number}" for t in missing]
            is_today = day == snap.now.date()

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
                    f"{_format_hour(deadline_hour)} UTC on {_format_day(day)}."
                ),
                "created_at": server_datetime(day, deadline_hour),
                "link": "/staff/log-entry",
                "meta": {
                    "date": day.isoformat(),
                    "deadline_hour_utc": deadline_hour,
                    "tank_count": len(missing),
                    "tanks": [
                        {
                            "id": str(t.id),
                            "tank_number": t.tank_number,
                            # Who else works a tank is facility staffing, not
                            # something a staff member needs to log their own.
                            **({"assignees": snap.assignees.get(str(t.id), [])} if manager_view else {}),
                        }
                        for t in missing
                    ],
                },
            })

        return notifications

    # --------------------------------------------------------- rule: quarantine

    @staticmethod
    def quarantine(user: User, snap: FacilitySnapshot) -> List[Dict[str, Any]]:
        warn_days = settings.QUARANTINE_EXPIRY_WARNING_DAYS
        manager_view = _is_manager_plus(user)

        tanks = [t for t in snap.tanks if t.is_quarantined]
        if not manager_view:
            assigned = set(user.assigned_tank_ids or [])
            tanks = [t for t in tanks if str(t.id) in assigned]

        notifications: List[Dict[str, Any]] = []
        for tank in tanks:
            end = as_utc(tank.quarantine_end_date)
            if not end:
                continue

            warn_from = end - timedelta(days=warn_days)
            if snap.now < warn_from:
                continue

            expired = snap.now >= end
            hours_left = (end - snap.now).total_seconds() / 3600
            if expired:
                detail = f"ended {_format_day(end.date())} and the tank is still flagged"
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
    def aupp(user: User, snap: FacilitySnapshot) -> List[Dict[str, Any]]:
        warn_days = settings.AUPP_EXPIRY_WARNING_DAYS
        manager_view = _is_manager_plus(user)

        projects = snap.projects
        if not manager_view:
            assigned = set(user.assigned_tank_ids or [])
            if not assigned:
                return []
            # Staff only hear about the projects actually sitting in their tanks.
            projects = [
                p for p in projects
                if snap.project_tanks.get(str(p.id), set()) & assigned
            ]

        link = "/admin/projects" if manager_view else "/staff/projects"
        notifications: List[Dict[str, Any]] = []

        for project in projects:
            expiry = as_utc(project.aupp_expiry_date)
            if not expiry:
                continue

            warn_from = expiry - timedelta(days=warn_days)
            if snap.now < warn_from:
                continue

            expiry_day = expiry.date()
            days_left = (expiry_day - snap.now.date()).days
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


class NotificationService:
    """Read side of the feed, plus the reconciliation the sweeper drives."""

    # ------------------------------------------------------------- generation

    @staticmethod
    async def sweep(now: Optional[datetime] = None) -> Dict[str, Any]:
        """
        Bring stored notifications in line with live data, for every active user.

        Safe to run at any cadence and safe to run twice: keys are deterministic,
        so a second pass over unchanged data writes nothing.
        """
        started = server_now()
        snap = await FacilitySnapshot.capture(now)
        users = await User.find({"status": StatusEnum.active.value}).to_list()

        created = updated = removed = 0
        for user in users:
            c, u, r = await NotificationService._reconcile_user(user, snap)
            created += c
            updated += u
            removed += r

        # Notifications belonging to users who have since been deactivated or
        # deleted would otherwise linger unreachable but counted.
        removed += await NotificationService._prune_orphans({str(u.id) for u in users})

        duration_ms = int((server_now() - started).total_seconds() * 1000)
        await NotificationService._record_sweep(
            last_run_at=started, duration_ms=duration_ms,
            created=created, updated=updated, removed=removed,
        )
        return {
            "users": len(users),
            "created": created,
            "updated": updated,
            "removed": removed,
            "duration_ms": duration_ms,
            "swept_at": started.isoformat(),
        }

    @staticmethod
    async def _reconcile_user(user: User, snap: FacilitySnapshot) -> tuple:
        user_id = str(user.id)
        desired = {d["key"]: d for d in NotificationRules.for_user(user, snap)}
        existing = await Notification.find({"user_id": user_id}).to_list()
        existing_by_key = {n.key: n for n in existing}

        created = updated = removed = 0

        for key, spec in desired.items():
            current = existing_by_key.get(key)
            if current is None:
                await Notification(user_id=user_id, **spec).insert()
                created += 1
            elif current.type not in STICKY_TYPES and NotificationService._apply(current, spec):
                current.generated_at = server_now()
                await current.save()
                updated += 1

        live_keys = set(desired)
        for key, doc in existing_by_key.items():
            if key in live_keys:
                continue
            # A sticky alert outlives the condition — a missed deadline stays
            # missed — and only goes when it ages out of the lookback window.
            if doc.type in STICKY_TYPES and not NotificationService._aged_out(doc, snap):
                continue
            await doc.delete()
            removed += 1

        return created, updated, removed

    @staticmethod
    def _apply(doc: Notification, spec: Dict[str, Any]) -> bool:
        """Copy refreshed content onto a stored alert; True if anything moved."""
        changed = False
        for f in _MUTABLE_FIELDS:
            new = spec[f]
            if f == "created_at":
                if as_utc(getattr(doc, f)) == new:
                    continue
            elif getattr(doc, f) == new:
                continue
            setattr(doc, f, new)
            changed = True
        return changed

    @staticmethod
    def _aged_out(doc: Notification, snap: FacilitySnapshot) -> bool:
        oldest = min(snap.days) if snap.days else snap.now.date()
        day = (doc.meta or {}).get("date")
        if not day:
            return True
        return day < oldest.isoformat()

    @staticmethod
    async def _prune_orphans(active_user_ids: set) -> int:
        orphans = await Notification.find(
            {"user_id": {"$nin": list(active_user_ids)}}
        ).to_list()
        for doc in orphans:
            await doc.delete()
        return len(orphans)

    @staticmethod
    async def _record_sweep(**fields) -> None:
        state = await NotificationSweepState.find_one({"singleton": "notification-sweep"})
        if state is None:
            state = NotificationSweepState(**fields)
            await state.insert()
            return
        for k, v in fields.items():
            setattr(state, k, v)
        state.error = None
        await state.save()

    @staticmethod
    async def record_sweep_failure(message: str) -> None:
        state = await NotificationSweepState.find_one({"singleton": "notification-sweep"})
        if state is None:
            state = NotificationSweepState(error=message)
            await state.insert()
            return
        state.error = message
        await state.save()

    # ------------------------------------------------------------------- read

    @staticmethod
    async def list_notifications(current_user: User, window: str = "all") -> Dict[str, Any]:
        now = server_now()
        docs = await Notification.find({"user_id": str(current_user.id)}).to_list()

        items = [
            {
                "key": d.key,
                "type": d.type,
                "severity": d.severity,
                "title": d.title,
                "message": d.message,
                "link": d.link,
                "meta": d.meta,
                "read": d.read,
                "created_at": as_utc(d.created_at),
            }
            for d in docs
        ]
        items.sort(key=lambda i: (_SEVERITY_RANK.get(i["severity"], 9), -i["created_at"].timestamp()))

        recent_cutoff = now - RECENT_WINDOW
        recent = [i for i in items if i["created_at"] >= recent_cutoff]
        visible = recent if window == "recent" else items

        state = await NotificationSweepState.find_one({"singleton": "notification-sweep"})
        return {
            "items": [{**i, "created_at": i["created_at"].isoformat()} for i in visible],
            "total": len(items),
            "unread_count": sum(1 for i in items if not i["read"]),
            "recent_unread_count": sum(1 for i in recent if not i["read"]),
            "server_time": now.isoformat(),
            "deadline_hour_utc": settings.WATER_QUALITY_DEADLINE_HOUR,
            # None means the generator has not completed a pass yet, which is a
            # different thing to show than "nothing needs attention".
            "last_generated_at": (
                as_utc(state.last_run_at).isoformat() if state and not state.error else None
            ),
        }

    @staticmethod
    async def mark_read(
        current_user: User,
        keys: Optional[List[str]] = None,
        mark_all: bool = False,
    ) -> Dict[str, Any]:
        user_id = str(current_user.id)
        query: Dict[str, Any] = {"user_id": user_id, "read": False}

        if not mark_all:
            keys = [k for k in (keys or []) if k]
            if not keys:
                return {"marked": 0}
            query["key"] = {"$in": keys}

        pending = await Notification.find(query).to_list()
        now = server_now()
        for doc in pending:
            doc.read = True
            doc.read_at = now
            await doc.save()
        return {"marked": len(pending)}
