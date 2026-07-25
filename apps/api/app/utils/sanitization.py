import bleach
from typing import Any

def sanitize_html(text: str) -> str:
    """Removes all HTML tags and scripts from input text to prevent XSS."""
    if not isinstance(text, str):
        return text
    return bleach.clean(text, tags=[], attributes={}, protocols=[], strip=True)

def sanitize_dict(data: dict) -> dict:
    """Recursively sanitizes string values in a dictionary."""
    sanitized = {}
    for k, v in data.items():
        if isinstance(v, str):
            sanitized[k] = sanitize_html(v)
        elif isinstance(v, dict):
            sanitized[k] = sanitize_dict(v)
        elif isinstance(v, list):
            sanitized[k] = [sanitize_html(i) if isinstance(i, str) else i for i in v]
        else:
            sanitized[k] = v
    return sanitized
