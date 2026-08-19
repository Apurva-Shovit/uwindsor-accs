"""
Facility notifications: generation, reconciliation, and the read feed.

A background sweeper (see `notification_scheduler`) recomputes the whole picture
on a fixed interval and reconciles it against what is stored, so serving the feed
is a single indexed query. Each pass rebuilds the entire lookback window from
live data rather than only looking at "what changed since last time", which means
a pass missed while the service was spun down is silently backfilled by the next
one instead of leaving a permanent hole.

Four rules are implemented:

* `water_quality_missing` — past the daily deadline with no water quality log
  for a tank on that day. The deadline is a wall-clock time in the facility's
  own zone and chairs and admins can move it, so it is read from the settings
  record rather than hardcoded. Addressed to the staff the tank is assigned to;
  managers and above see every tank plus who owns it.
* `quarantine_expiring`   — a tank's quarantine window closes within a day.
* `quarantine_lifted`     — a window closed and the system released the tank.
* `aupp_expiring`         — an active project's AUPP lapses within a month.

`water_quality_missing` records a fact about a moment that has passed, so it is
written once and never rewritten. `quarantine_expiring` and `aupp_expiring`
describe a live countdown, so they are refreshed every pass and deleted the
moment the condition clears. `quarantine_lifted` is a past fact too, but one the
audit trail still holds, so it is rebuilt from that trail on every pass and
simply falls out when it ages past the notice window.

The sweep releases expired quarantines before it reads anything, which is what
makes the release happen on a timer rather than only when somebody opens a page
that touches tank state — and means the same pass reports what it just did.
"""
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence

from ..config import settings
from ..models.audit_log import AuditLog
from ..models.facility import Tank
from ..models.notification import Notification, NotificationSettings, NotificationSweepState
from ..models.project import Project
from ..models.tank_assignment import TankAssignment
from ..models.user import RoleEnum, StatusEnum, User
from ..models.water_quality_log import WaterQualityLog
from ..repositories.audit_repository import AuditRepository
from ..utils.clock import as_utc, day_bounds, local_date, now_utc
from ..utils.entity_resolver import EntityResolver
from ..utils.quarantine_utils import (
    SYSTEM_ACTOR_ID,
    format_duration,
    lift_expired_quarantines,
    snapshot_datetime,
)
from . import push_service
from .notification_settings import Deadline, NotificationSettingsStore

logger = logging.getLogger(__name__)

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}

WATER_QUALITY_MISSING = "water_quality_missing"
QUARANTINE_EXPIRING = "quarantine_expiring"
QUARANTINE_LIFTED = "quarantine_lifted"
AUPP_EXPIRING = "aupp_expiring"

# How long a completed release stays in the panel. It is a courtesy notice that
# something has already been handled, not a task waiting to be actioned, so it
# ages out on its own rather than sitting there until someone dismisses it.
QUARANTINE_LIFTED_WINDOW = timedelta(days=7)

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
    deadline: Deadline = field(default=Deadline(15, 0, "America/Toronto"))
    days: List[date] = field(default_factory=list)
    tanks: List[Tank] = field(default_factory=list)
    logged_by_day: Dict[str, set] = field(default_factory=dict)
    projects: List[Project] = field(default_factory=list)
    project_tanks: Dict[str, set] = field(default_factory=dict)
    assignees: Dict[str, List[str]] = field(default_factory=dict)
    # Releases the system performed itself, read from the audit trail: once a
    # tank is released its quarantine dates are cleared, so the tank row no
    # longer remembers that any of this happened.
    auto_lifts: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def today(self) -> date:
        """Today on the facility's clock, which is what "the current day's log" means."""
        return local_date(self.now, self.deadline.zone)

    @classmethod
    async def capture(
        cls, now: Optional[datetime] = None, deadline: Optional[Deadline] = None
    ) -> "FacilitySnapshot":
        now = now or now_utc()
        deadline = deadline or await NotificationSettingsStore.deadline()
        lookback = max(1, settings.WATER_QUALITY_MISSING_LOOKBACK_DAYS)
        today = local_date(now, deadline.zone)

        # Only days whose deadline has already passed can be "missed" — the
        # current day stays silent until then rather than nagging all morning.
        days = [
            today - timedelta(days=offset)
            for offset in range(lookback)
            if deadline.on(today - timedelta(days=offset)) <= now
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
            if u.role not in MANAGER_PLUS:
                for tank_id in (u.assigned_tank_ids or []):
                    assignees.setdefault(tank_id, []).append(f"{u.first_name} {u.last_name}".strip())

        # The `before` payload is the only place the closed window survives, so
        # the tank number and both dates are read back off the audit entry
        # rather than the (now cleared) tank row.
        lift_entries = await AuditLog.find({
            "action": "lifted_quarantine",
            "actor_id": SYSTEM_ACTOR_ID,
            "created_at": {"$gte": now - QUARANTINE_LIFTED_WINDOW},
        }).to_list()

        auto_lifts = [
            {
                "tank_id": entry.entity_id,
                "tank_number": (entry.before or {}).get("tank_number") or "?",
                "lifted_at": as_utc(entry.created_at),
                "started": snapshot_datetime(entry.before, "quarantine_start_date"),
                "ended": snapshot_datetime(entry.before, "quarantine_end_date"),
            }
            for entry in lift_entries
        ]
        # One notice per tank per day, so a tank released twice in a day collapses
        # to a single key. Oldest first means the newest release is the one that
        # survives the collapse, rather than whichever Mongo happened to return
        # last.
        auto_lifts.sort(key=lambda lift: lift["lifted_at"] or now)

        return cls(
            now=now,
            deadline=deadline,
            days=days,
            tanks=tanks,
            logged_by_day=logged_by_day,
            projects=projects,
            project_tanks=project_tanks,
            assignees=assignees,
            auto_lifts=auto_lifts,
        )


class NotificationRules:
    """Builds the alerts one user should currently be holding."""

    @staticmethod
    def for_user(user: User, snap: FacilitySnapshot) -> List[Dict[str, Any]]:
        return [
            *NotificationRules.water_quality(user, snap),
            *NotificationRules.quarantine(user, snap),
            *NotificationRules.quarantine_lifted(user, snap),
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

        deadline = snap.deadline
        zone = deadline.zone
        today = snap.today
        notifications: List[Dict[str, Any]] = []

        for day in snap.days:
            done = snap.logged_by_day.get(day.isoformat(), set())
            missing = []
            for tank in tanks:
                if str(tank.id) in done:
                    continue
                # A tank added after the fact was never owed a log for that day.
                created = as_utc(tank.created_at)
                if created and local_date(created, zone) > day:
                    continue
                missing.append(tank)

            if not missing:
                continue

            missing.sort(key=lambda t: _tank_sort_key(t.tank_number))
            labels = [f"Tank {t.tank_number}" for t in missing]
            is_today = day == today
            # Labelled with the zone in force on that day, so a miss from before
            # a daylight-saving change still reads back correctly.
            deadline_label = deadline.label(deadline.on(day))

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
                    f"{deadline_label} on {_format_day(day)}."
                ),
                "created_at": deadline.on(day),
                "link": "/staff/log-entry",
                "meta": {
                    "date": day.isoformat(),
                    "deadline": deadline_label,
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
            # Dates in the copy are the facility's, so a window closing at
            # 9 PM Eastern does not read back as the following day.
            end_day = local_date(end, snap.deadline.zone)
            if expired:
                detail = f"ended {_format_day(end_day)} and the tank is still flagged"
            elif hours_left >= 1:
                detail = f"ends in {int(hours_left)} hour{'s' if int(hours_left) != 1 else ''}"
            else:
                detail = "ends in under an hour"

            notifications.append({
                "key": f"{QUARANTINE_EXPIRING}:{str(tank.id)}:{end_day.isoformat()}",
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

    # -------------------------------------------------- rule: quarantine lifted

    @staticmethod
    def quarantine_lifted(user: User, snap: FacilitySnapshot) -> List[Dict[str, Any]]:
        """
        Tanks the system released when their window ran out.

        The release happens without anyone asking for it, so it has to be
        announced — otherwise a tank silently becomes transferable and the only
        record is an audit row nobody is watching. Informational rather than a
        warning: the thing it describes is already done and correct.
        """
        manager_view = _is_manager_plus(user)

        lifts = snap.auto_lifts
        if not manager_view:
            assigned = set(user.assigned_tank_ids or [])
            lifts = [lift for lift in lifts if lift["tank_id"] in assigned]

        # One notice per tank per day. `snap.auto_lifts` is oldest-first, so a
        # tank released twice in a day keeps the later release rather than
        # reporting a superseded one.
        by_key: Dict[str, Dict[str, Any]] = {}
        for lift in lifts:
            lifted_at = lift["lifted_at"]
            if not lifted_at:
                continue

            lifted_day = local_date(lifted_at, snap.deadline.zone)
            started, ended = lift["started"], lift["ended"]
            served = (
                f"completed its {format_duration(ended - started)} of quarantine"
                if started and ended
                else "completed quarantine"
            )

            key = f"{QUARANTINE_LIFTED}:{lift['tank_id']}:{lifted_day.isoformat()}"
            by_key[key] = {
                "key": key,
                "type": QUARANTINE_LIFTED,
                "severity": "info",
                "title": f"Quarantine lifted on Tank {lift['tank_number']}",
                "message": (
                    f"Tank {lift['tank_number']} {served} on {_format_day(lifted_day)} "
                    f"and was released automatically by the system."
                ),
                "created_at": lifted_at,
                "link": "/staff/quarantine",
                "meta": {
                    "tank_id": lift["tank_id"],
                    "tank_number": lift["tank_number"],
                    "lifted_at": lifted_at.isoformat(),
                    "automatic": True,
                    **({"quarantine_end_date": ended.isoformat()} if ended else {}),
                    # As with the countdown, when the window opened is history a
                    # manager reviews rather than something staff act on.
                    **(
                        {"quarantine_start_date": started.isoformat()}
                        if manager_view and started
                        else {}
                    ),
                },
            }

        return list(by_key.values())

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

            expiry_day = local_date(expiry, snap.deadline.zone)
            days_left = (expiry_day - snap.today).days
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

    # --------------------------------------------------------------- settings

    @staticmethod
    async def get_settings() -> Dict[str, Any]:
        record = await NotificationSettingsStore.get()
        deadline = await NotificationSettingsStore.deadline()
        return {
            "deadline": deadline.as_dict(),
            "updated_at": as_utc(record.updated_at).isoformat() if record.updated_at else None,
            "updated_by": record.updated_by,
            "updated_by_name": await EntityResolver.resolve_user_name(record.updated_by),
        }

    @staticmethod
    async def update_settings(
        hour: int, minute: int, timezone_name: str, current_user: User, now: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Move the daily deadline, then rebuild anything that was measured against
        the old one.

        Missed-deadline alerts are normally never rewritten, but they quote the
        cutoff they were generated against — leaving them in place after the
        cutoff moves would leave the feed asserting a deadline that no longer
        exists. Dropping and regenerating them is the only way the panel and the
        setting agree.
        """
        NotificationSettingsStore.validate(hour, minute, timezone_name)

        record = await NotificationSettingsStore.get()
        before = record.model_dump(mode="json")
        unchanged = (
            record.water_quality_deadline_hour == hour
            and record.water_quality_deadline_minute == minute
            and record.timezone == timezone_name
        )
        if unchanged:
            return {**await NotificationService.get_settings(), "changed": False}

        record.water_quality_deadline_hour = hour
        record.water_quality_deadline_minute = minute
        record.timezone = timezone_name
        record.updated_at = now_utc()
        record.updated_by = str(current_user.id)
        await record.save()

        deadline = Deadline(hour, minute, timezone_name)
        cutoff_label = deadline.label()

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="update",
            entity_type="water_quality_cutoff",
            entity_id=f"Daily Cutoff ({cutoff_label})",
            before=before,
            after=record.model_dump(mode="json"),
        ))

        stale = await Notification.find({"type": WATER_QUALITY_MISSING}).to_list()
        for doc in stale:
            await doc.delete()

        swept = await NotificationService.sweep(now=now, force=True)
        return {
            **await NotificationService.get_settings(),
            "changed": True,
            "regenerated": swept["created"],
        }

    # ------------------------------------------------------------- generation

    @staticmethod
    async def acquire_lock(instance_id: str = "default", timeout_seconds: int = 300) -> bool:
        """
        Attempt to atomically claim the sweep lock using PyMongo/Motor find_one_and_update.
        If locked_at is None or older than timeout_seconds (stale lock recovery), claim it.
        """
        from pymongo.errors import DuplicateKeyError

        now = now_utc()
        stale_cutoff = now - timedelta(seconds=timeout_seconds)

        collection = NotificationSweepState.get_motor_collection()
        filter_doc = {
            "singleton": "notification-sweep",
            "$or": [
                {"locked_at": None},
                {"locked_at": {"$lt": stale_cutoff}},
            ],
        }
        update_doc = {
            "$set": {
                "locked_at": now,
                "locked_by": instance_id,
            },
            "$setOnInsert": {
                "singleton": "notification-sweep",
                "last_run_at": now,
                "duration_ms": 0,
                "created": 0,
                "updated": 0,
                "removed": 0,
            },
        }
        try:
            await collection.find_one_and_update(
                filter_doc,
                update_doc,
                upsert=True,
            )
            return True
        except DuplicateKeyError:
            return False

    @staticmethod
    async def release_lock(instance_id: Optional[str] = None) -> None:
        """Release the sweep lock so subsequent passes can run immediately."""
        collection = NotificationSweepState.get_motor_collection()
        filter_doc: Dict[str, Any] = {"singleton": "notification-sweep"}
        if instance_id:
            filter_doc["locked_by"] = instance_id
        await collection.update_one(
            filter_doc,
            {"$set": {"locked_at": None, "locked_by": None}},
        )

    @staticmethod
    async def sweep(
        now: Optional[datetime] = None,
        force: bool = False,
        instance_id: str = "default",
    ) -> Dict[str, Any]:
        """
        Bring stored notifications in line with live data, for every active user.

        Safe to run at any cadence and safe to run twice: keys are deterministic,
        so a second pass over unchanged data writes nothing. Uses atomic locking to
        prevent concurrent sweeps across multi-replica deployments.
        """
        if not force:
            acquired = await NotificationService.acquire_lock(instance_id)
            if not acquired:
                return {
                    "users": 0,
                    "created": 0,
                    "updated": 0,
                    "removed": 0,
                    "released": 0,
                    "duration_ms": 0,
                    "swept_at": now_utc().isoformat(),
                    "status": "skipped",
                    "reason": "sweep_in_progress",
                }

        try:
            started = now_utc()
            released = await lift_expired_quarantines(now)
            snap = await FacilitySnapshot.capture(now)
            users = await User.find({"status": StatusEnum.active.value}).to_list()

            created = updated = removed = 0
            new_alerts: List[Dict[str, Any]] = []
            for user in users:
                c, u, r = await NotificationService._reconcile_user(user, snap, new_alerts)
                created += c
                updated += u
                removed += r

            removed += await NotificationService._prune_orphans({str(u.id) for u in users})

            pushed = await NotificationService._dispatch_push(new_alerts)

            drifted = await NotificationService._report_census_drift()

            duration_ms = int((now_utc() - started).total_seconds() * 1000)
            await NotificationService._record_sweep(
                last_run_at=started, duration_ms=duration_ms,
                created=created, updated=updated, removed=removed,
            )
            return {
                "users": len(users),
                "created": created,
                "updated": updated,
                "removed": removed,
                "released": released,
                "duration_ms": duration_ms,
                "swept_at": started.isoformat(),
                "status": "completed",
                "pushed": pushed,
                "census_drift": drifted,
            }
        finally:
            if not force:
                await NotificationService.release_lock(instance_id)

    @staticmethod
    async def _report_census_drift() -> int:
        """Log any tank whose count no longer matches its census ledger.

        Report only -- nothing here changes a count. Every write path is atomic
        now, so a mismatch means something got past them, and that is worth a
        log line an admin can act on rather than a silent correction. Repair is
        a deliberate step: scripts/reconcile_census.py --repair.

        A failure must not take the sweep down with it; this is a health check
        bolted onto a job whose real work has already completed.
        """
        try:
            from ..utils.census_reconcile import find_drift

            drifted = await find_drift()
        except Exception:
            logger.exception("Census drift check failed")
            return 0

        for d in drifted:
            logger.warning("Census drift: %s", d.describe())
        if drifted:
            logger.warning(
                "%d tank assignment(s) disagree with the census ledger. "
                "Run scripts/reconcile_census.py for detail.",
                len(drifted),
            )
        return len(drifted)

    @staticmethod
    async def _dispatch_push(new_alerts: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        Send the alerts this pass created to the users' registered devices.

        Only newly inserted rows go out. A sweep re-words an existing alert on
        most passes — the countdown in a quarantine notice changes every quarter
        hour — and pushing those would turn one condition into a stream of
        buzzes for something the user has already seen.

        Failures here never fail the sweep. The feed row is already written, so
        the alert is not lost; it is only the phone that missed it, and the next
        pass will not retry a row it no longer considers new. That is the right
        trade: a sweep that aborted on an FCM outage would leave the feed itself
        half-reconciled, which is the more visible breakage.
        """
        if not new_alerts:
            return {"sent": 0, "failed": 0, "devices": 0, "disabled": 0}

        try:
            by_user: Dict[str, List[Dict[str, Any]]] = {}
            for alert in new_alerts:
                by_user.setdefault(alert["user_id"], []).append(alert)
            return await push_service.send_to_users(by_user)
        except Exception:
            logger.exception("push dispatch failed; feed rows were still written")
            return {"sent": 0, "failed": len(new_alerts), "devices": 0, "disabled": 0}

    @staticmethod
    async def _reconcile_user(
        user: User,
        snap: FacilitySnapshot,
        new_alerts: Optional[List[Dict[str, Any]]] = None,
    ) -> tuple:
        """
        Bring one user's stored alerts in line with the snapshot.

        `new_alerts`, when given, collects the specs this pass inserted. Push
        delivery needs to know which rows are genuinely new — an alert whose
        wording was merely refreshed must not wake a phone a second time — and
        the counters alone cannot say which those were. It is an out-parameter
        rather than a fourth return value because the return arity is asserted
        on directly by the reconciliation tests.
        """
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
                if new_alerts is not None:
                    new_alerts.append({**spec, "user_id": user_id})
            elif current.type not in STICKY_TYPES and NotificationService._apply(current, spec):
                current.generated_at = now_utc()
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
        lookback_days = max(1, settings.WATER_QUALITY_MISSING_LOOKBACK_DAYS)
        cutoff_date = (snap.today - timedelta(days=lookback_days)).isoformat()
        day = (doc.meta or {}).get("date")
        if day:
            return day < cutoff_date
        created = as_utc(doc.created_at)
        return created < (snap.now - timedelta(days=lookback_days))

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
        now = now_utc()
        deadline = await NotificationSettingsStore.deadline()
        lookback_days = max(1, settings.WATER_QUALITY_MISSING_LOOKBACK_DAYS)
        cutoff_time = now - timedelta(days=lookback_days)
        cutoff_date = (local_date(now, deadline.zone) - timedelta(days=lookback_days)).isoformat()

        docs = await Notification.find({"user_id": str(current_user.id)}).to_list()
        valid_docs = []
        for d in docs:
            if as_utc(d.created_at) < cutoff_time:
                await d.delete()
                continue
            day = (d.meta or {}).get("date")
            if day and day < cutoff_date:
                await d.delete()
                continue
            valid_docs.append(d)

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
            for d in valid_docs
        ]
        items.sort(key=lambda i: (_SEVERITY_RANK.get(i["severity"], 9), -i["created_at"].timestamp()))

        recent_cutoff = now - RECENT_WINDOW
        recent = [i for i in items if i["created_at"] >= recent_cutoff]
        visible = recent if window == "recent" else items

        state = await NotificationSweepState.find_one({"singleton": "notification-sweep"})
        deadline = await NotificationSettingsStore.deadline()
        return {
            "items": [{**i, "created_at": i["created_at"].isoformat()} for i in visible],
            "total": len(items),
            "unread_count": sum(1 for i in items if not i["read"]),
            "recent_unread_count": sum(1 for i in recent if not i["read"]),
            "server_time": now.isoformat(),
            # Everyone sees the cutoff, including staff who cannot change it —
            # an alert about a deadline is not much use without the deadline.
            "deadline": deadline.as_dict(now),
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
        now = now_utc()
        for doc in pending:
            doc.read = True
            doc.read_at = now
            await doc.save()
        return {"marked": len(pending)}
