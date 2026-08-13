import pytest
from datetime import datetime, timezone
from pydantic import ValidationError

from app.schemas.project import ProjectCreate
from app.utils.datetime_parsing import parse_iso_datetime


class TestParseIsoDatetime:
    """Guards the browser-timestamp format that broke project creation.

    JavaScript's Date.toISOString() emits a trailing 'Z', which
    datetime.fromisoformat only accepts from Python 3.11 onward. The API image
    is python:3.10-slim, so before this helper existed the same payload parsed
    on a developer machine and raised ValueError in production. These cases are
    interpreter-independent on purpose — they must hold on 3.10 and on 3.13.
    """

    @pytest.mark.parametrize(
        "raw,expected",
        [
            # The exact string from the Render traceback.
            ("2027-08-13T00:00:00.000Z", datetime(2027, 8, 13, tzinfo=timezone.utc)),
            ("2027-08-13T12:30:45.123456Z", datetime(2027, 8, 13, 12, 30, 45, 123456, tzinfo=timezone.utc)),
            ("2027-08-13T00:00:00z", datetime(2027, 8, 13, tzinfo=timezone.utc)),
            # Explicit offsets and naive values already worked; they must not regress.
            ("2027-08-13T00:00:00+00:00", datetime(2027, 8, 13, tzinfo=timezone.utc)),
            ("2027-08-13T00:00:00", datetime(2027, 8, 13)),
            ("2027-08-13", datetime(2027, 8, 13)),
            ("  2027-08-13T00:00:00.000Z  ", datetime(2027, 8, 13, tzinfo=timezone.utc)),
        ],
    )
    def test_parses_client_timestamps(self, raw, expected):
        assert parse_iso_datetime(raw) == expected

    @pytest.mark.parametrize("empty", [None, "", "   "])
    def test_empty_input_is_none(self, empty):
        """Callers relied on the old `if value else None` guard returning None."""
        assert parse_iso_datetime(empty) is None

    @pytest.mark.parametrize("bad", ["not-a-date", "13-08-2027", "2027-13-45T00:00:00Z"])
    def test_malformed_input_still_raises(self, bad):
        """Normalising the suffix must not turn bad input into a silent pass."""
        with pytest.raises(ValueError):
            parse_iso_datetime(bad)

    def test_z_suffix_is_utc_not_naive(self):
        """A 'Z' means UTC; dropping it would shift every stored timestamp."""
        parsed = parse_iso_datetime("2027-08-13T00:00:00.000Z")
        assert parsed.tzinfo is not None
        assert parsed.utcoffset().total_seconds() == 0


class TestProjectCreateDates:
    """Project creation is where this surfaced, and Pydantic now owns the parsing.

    The helper above no longer sits in this path, so these assert the schema
    itself accepts what the browser actually sends.
    """

    BASE = {"title": "Zebrafish study", "pi_name": "Dr Smith", "aupp_number": "AUP-1"}

    def test_accepts_browser_timestamp(self):
        """The exact payload shape that produced the 500 on Render."""
        body = ProjectCreate(
            **self.BASE,
            dob="2025-01-01T00:00:00.000Z",
            aupp_expiry_date="2027-08-13T00:00:00.000Z",
        )
        assert body.dob == datetime(2025, 1, 1, tzinfo=timezone.utc)
        assert body.aupp_expiry_date == datetime(2027, 8, 13, tzinfo=timezone.utc)

    def test_accepts_date_only(self):
        """The create form sends toISOString().slice(0, 10) for established_date."""
        body = ProjectCreate(**self.BASE, established_date="2026-08-13")
        assert body.established_date == datetime(2026, 8, 13)

    def test_dates_are_optional(self):
        body = ProjectCreate(**self.BASE)
        assert body.dob is None
        assert body.established_date is None
        assert body.aupp_expiry_date is None

    def test_malformed_date_is_a_validation_error(self):
        """Rejected at the boundary as a 422, rather than a 500 from the service."""
        with pytest.raises(ValidationError):
            ProjectCreate(**self.BASE, aupp_expiry_date="not-a-date")
