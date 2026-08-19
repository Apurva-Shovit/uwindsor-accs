"""Check TankAssignment.current_count against the census ledger.

The system keeps two representations of the same fact: `census_events` is an
immutable ledger of every arrival, death, hatch and transfer, and
`TankAssignment.current_count` is a mutable counter maintained alongside it.
Reports read from both -- population from the counter, mortality from the
ledger -- so once they disagree the numbers in the app quietly stop adding up.

Nothing reconciled them until now. Every write path is atomic as of the
concurrency work, but that only stops new drift; it does not detect drift left
by the read-modify-write code, and it cannot cover a process killed between a
compensating write and its retry. This module is the backstop that makes such a
gap visible instead of permanent.

The ledger is authoritative. It is append-only and every entry is audited, so
where the two disagree it is the counter that is wrong.
"""

import logging
from dataclasses import dataclass
from typing import List, Optional

from ..models.census_event import CensusEvent
from ..models.tank_assignment import TankAssignment

logger = logging.getLogger(__name__)


@dataclass
class Drift:
    assignment_id: str
    tank_id: str
    project_id: str
    current_count: int
    ledger_total: int

    @property
    def delta(self) -> int:
        """How far the counter has strayed. Positive means it claims too many."""
        return self.current_count - self.ledger_total

    def describe(self) -> str:
        return (
            f"assignment={self.assignment_id} tank={self.tank_id} "
            f"count={self.current_count} ledger={self.ledger_total} "
            f"drift={self.delta:+d}"
        )


async def ledger_totals() -> dict[str, int]:
    """Sum every census event per assignment.

    quarantine_placed and quarantine_lifted carry change=0, so they contribute
    nothing and need no special case.
    """
    rows = await CensusEvent.get_motor_collection().aggregate([
        {"$group": {"_id": "$tank_assignment_id", "total": {"$sum": "$change"}}},
    ]).to_list(length=None)
    return {row["_id"]: row["total"] for row in rows}


async def find_drift() -> List[Drift]:
    """Every assignment whose counter disagrees with its ledger entries."""
    totals = await ledger_totals()
    drifted: List[Drift] = []

    for ta in await TankAssignment.find_all().to_list():
        assignment_id = str(ta.id)
        expected = totals.get(assignment_id, 0)
        if ta.current_count != expected:
            drifted.append(Drift(
                assignment_id=assignment_id,
                tank_id=ta.tank_id,
                project_id=ta.project_id,
                current_count=ta.current_count,
                ledger_total=expected,
            ))

    return drifted


async def repair(drifted: Optional[List[Drift]] = None, *, actor_id: str = "system") -> int:
    """Reset drifted counters to their ledger totals. Returns how many changed.

    No census event is written: this corrects a cache to match the record, it
    does not record an animal moving. An audit entry is written for each
    correction so the change is not silent.
    """
    from ..models.audit_log import AuditLog
    from ..repositories.audit_repository import AuditRepository

    if drifted is None:
        drifted = await find_drift()

    repaired = 0
    for d in drifted:
        ta = await TankAssignment.get(d.assignment_id)
        if ta is None:
            continue

        # Re-read rather than trusting the scan: the count may have moved since,
        # in which case it is no longer the value this repair was computed for.
        if ta.current_count != d.current_count:
            logger.info("Skipping %s, its count changed during reconciliation", d.assignment_id)
            continue

        before = ta.model_dump(mode="json")
        result = await TankAssignment.get_motor_collection().update_one(
            {"_id": ta.id, "current_count": d.current_count},
            {"$set": {"current_count": d.ledger_total}},
        )
        if result.modified_count == 0:
            continue

        ta.current_count = d.ledger_total
        await AuditRepository.insert(AuditLog(
            actor_id=actor_id,
            actor_role="system",
            action="census_reconciliation",
            entity_type="tank_assignment",
            entity_id=d.assignment_id,
            before=before,
            after=ta.model_dump(mode="json"),
        ))
        repaired += 1

    return repaired
