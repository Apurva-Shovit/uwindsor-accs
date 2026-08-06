from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from ..core.permissions import require_manager_plus
from ..models.user import User
from ..services.export_service import ExportService

router = APIRouter(prefix="/export", tags=["export"])


def _validate_range(start_date: Optional[date], end_date: Optional[date]) -> None:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, "start_date must be on or before end_date")


@router.get("/preview")
async def preview_export(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current: User = Depends(require_manager_plus),
):
    _validate_range(start_date, end_date)
    record_counts = await ExportService.get_preview_counts(start_date, end_date)
    return {
        "record_counts": record_counts,
        "start_date": start_date,
        "end_date": end_date,
    }


@router.get("/backup")
async def download_backup(
    export_format: str = Query(..., alias="format", pattern="^(json|csv)$"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current: User = Depends(require_manager_plus),
):
    _validate_range(start_date, end_date)

    try:
        bundle = await ExportService.build_export_bundle(start_date, end_date)
    except Exception as exc:
        raise HTTPException(500, f"Export failed while building the data bundle: {exc}")

    record_counts = {name: len(rows) for name, rows in bundle.items()}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if export_format == "json":
        content = ExportService.generate_json_export(bundle)
        await ExportService.write_export_audit_log(current, "json", start_date, end_date, record_counts)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=acare_backup_{today}.json"},
        )

    if start_date or end_date:
        scope = f"{start_date.isoformat() if start_date else 'Beginning'} to {end_date.isoformat() if end_date else 'Now'}"
    else:
        scope = "Full Backup"
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "actor_name": f"{current.first_name} {current.last_name}".strip(),
        "scope": scope,
    }
    zip_buffer = ExportService.generate_csv_export(bundle, meta)
    await ExportService.write_export_audit_log(current, "csv", start_date, end_date, record_counts)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=acare_backup_{today}.zip"},
    )
