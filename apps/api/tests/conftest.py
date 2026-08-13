import pytest

from app.core.limiter import limiter


@pytest.fixture(autouse=True, scope="session")
def disable_rate_limiting():
    """Turn the request limiter off for the whole test session.

    RATE_LIMIT_LOGIN is 5/minute keyed on client IP, and every test runs from
    the same address. Any test that logs in therefore eats into the budget of
    whichever tests run after it, so a suite that passes on its own starts
    failing once another login-heavy test is added — failures that track
    execution order rather than the code under test.

    The limiter itself is still worth exercising, but that belongs in a test
    written for it specifically, not as a side effect on everything else.
    """
    limiter.enabled = False
    yield
    limiter.enabled = True
