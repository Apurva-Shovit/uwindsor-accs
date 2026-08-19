"""Concurrency primitives for writes that more than one person can make at once.

The facility runs on shared tablets and a handful of desktops, and managers are
authorised on every tank, so any given TankAssignment row can be written by
several people in the same second. Read-modify-write in Python cannot survive
that -- and because Beanie's .save() replaces the whole document, a lost update
reverts every field, not just the counter it meant to change.

Everything here pushes the decision down to the database, so the outcome does
not depend on how two requests interleave. It is the same compare-and-set shape
already used for the quarantine exemption claim in services/quarantine_service.py
and the tank release in utils/quarantine_utils.py, factored out so it stops
being copy-pasted.

There are deliberately no MongoDB transactions: docker-compose.yml runs a
standalone mongod, so transactions are unavailable in development and in the
test suite. Multi-step writes use `Compensation` instead, which is weaker but
behaves identically everywhere.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional, Type

from beanie import Document, PydanticObjectId
from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..models.tank_assignment import TankAssignment

logger = logging.getLogger(__name__)

OCCUPIED_TANK_DETAIL = "Destination tank is occupied by a different AUPP project"


def _as_object_id(value: Any) -> PydanticObjectId:
    return value if isinstance(value, PydanticObjectId) else PydanticObjectId(str(value))


async def adjust_count(
    assignment_id: Any,
    delta: int,
    *,
    allow_negative: bool = False,
) -> int:
    """Apply `delta` to a TankAssignment's current_count in one database operation.

    Returns the resulting count. A debit that would take the tank below zero is
    refused by the query filter rather than by an `if` against a value read
    earlier, so two concurrent withdrawals can never both pass the check.

    `allow_negative` exists for compensating writes: a refund has to land even
    if the row has moved on since, because the alternative is losing animals.
    """
    oid = _as_object_id(assignment_id)
    query: Dict[str, Any] = {"_id": oid}
    if delta < 0 and not allow_negative:
        query["current_count"] = {"$gte": -delta}

    try:
        doc = await TankAssignment.get_motor_collection().find_one_and_update(
            query,
            {"$inc": {"current_count": delta}},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        # Crediting took the row from empty to occupied while another project
        # already held the tank. The partial unique index caught what the old
        # find_one occupancy check could not.
        raise HTTPException(409, OCCUPIED_TANK_DETAIL)

    if doc is not None:
        return doc["current_count"]

    # The update matched nothing. Work out which of the two reasons it was, so
    # the client can tell "this record is gone" from "someone got here first".
    current = await TankAssignment.get_motor_collection().find_one({"_id": oid})
    if current is None:
        raise HTTPException(404, "Tank assignment not found")

    raise HTTPException(
        409,
        f"This tank now holds {current.get('current_count', 0)} fish. "
        "Someone else updated it - refresh and re-check before resubmitting.",
    )


async def get_or_create_assignment(
    tank_id: str,
    project_id: str,
    *,
    created_by: str,
    pi_name: Optional[str] = None,
    aupp_number: Optional[str] = None,
) -> TankAssignment:
    """Fetch the (tank, project) assignment, creating it if it does not exist.

    A find-then-insert races: two first intakes into a fresh tank both see
    nothing and both insert. This upserts instead, and the unique index on
    (tank_id, project_id) makes the loser of any race fall back to a read.

    The new row starts at zero, which never trips the occupancy index -- an
    empty assignment is not an occupation. A conflicting project only surfaces
    when someone actually credits fish into the tank, which is where the 409
    belongs.
    """
    on_insert: Dict[str, Any] = {
        "current_count": 0,
        "created_by": created_by,
        "pi_name": pi_name,
        "aupp_number": aupp_number,
        "created_at": datetime.now(timezone.utc),
    }

    try:
        raw = await TankAssignment.get_motor_collection().find_one_and_update(
            {"tank_id": tank_id, "project_id": project_id},
            {"$setOnInsert": on_insert},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        # Another request inserted the same pair between our lookup and our
        # write. Its row is the one that exists, so use it.
        raw = await TankAssignment.get_motor_collection().find_one(
            {"tank_id": tank_id, "project_id": project_id}
        )
        if raw is None:
            raise HTTPException(409, "Tank assignment could not be created, please retry")

    return TankAssignment.model_validate(raw)


async def claim(
    model: Type[Document],
    doc_id: Any,
    expected: Dict[str, Any],
    updates: Dict[str, Any],
) -> bool:
    """Move a document from one state to another, once.

    Returns True for the request that performed the transition and False for
    everyone else. A status check read into Python cannot do this: a manager
    double-clicking "Approve" fires several requests that all read the document
    while it is still pending, so they all pass the check. Only a conditional
    update can pick a single winner.
    """
    result = await model.get_motor_collection().update_one(
        {"_id": _as_object_id(doc_id), **expected},
        {"$set": updates},
    )
    return result.modified_count == 1


class Compensation:
    """An undo stack for a sequence of writes that has to be all-or-nothing.

    Without transactions, a transfer that debits the source and then fails to
    credit the destination destroys animals. Registering the inverse of each
    step as it succeeds means the failure path can put them back.

    This is not atomic -- a reader can observe the half-applied state, and a
    hard process kill still leaves it -- but it closes the failure modes that
    actually occur (a validation error, a rejected write, a dropped
    connection), and it makes the rollback something you can read rather than
    something a docstring claims. scripts/reconcile_census.py is the backstop
    for whatever slips through.
    """

    def __init__(self) -> None:
        self._undo: list[Callable[[], Awaitable[Any]]] = []

    def add(self, undo: Callable[[], Awaitable[Any]]) -> None:
        self._undo.append(undo)

    async def rollback(self) -> None:
        """Run the registered inverses newest-first, best effort.

        A failing inverse must not mask the original exception, so each one is
        contained; anything it leaves behind is drift the reconciler reports.
        """
        log = logger
        while self._undo:
            undo = self._undo.pop()
            try:
                await undo()
            except Exception:
                log.exception("Compensating write failed; census may need reconciliation")
