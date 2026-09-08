"""
Email delivery service for ACARE facility alerts.

Handles building and dispatching emails for missing daily log notifications and
other facility alerts. Supports real SMTP delivery when configured via
environment variables, and falls back to structured mock log entries when SMTP
is unconfigured.
"""
import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Optional, Tuple

from ..config import settings

logger = logging.getLogger(__name__)


def is_smtp_configured() -> bool:
    """True when SMTP server details are provided in settings."""
    return bool((settings.SMTP_HOST or "").strip())


def _send_via_smtp(
    sender: str,
    to_addrs: List[str],
    cc_addrs: List[str],
    subject: str,
    body_text: str,
    body_html: str,
) -> Tuple[bool, Optional[str]]:
    """Synchronous SMTP sending logic, executed in a thread pool via asyncio.to_thread."""
    recipients = list(set(to_addrs + cc_addrs))
    if not recipients:
        return False, "No recipient email addresses provided"

    msg = MIMEMultipart("alternative")
    msg["From"] = sender
    msg["To"] = ", ".join(to_addrs)
    if cc_addrs:
        msg["Cc"] = ", ".join(cc_addrs)
    msg["Subject"] = subject

    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        if settings.SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15)

        with server:
            if settings.SMTP_USE_TLS and settings.SMTP_PORT != 465:
                server.starttls()
            if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.sendmail(sender, recipients, msg.as_string())
        return True, None
    except Exception as exc:
        logger.exception("SMTP email send failed: %s", exc)
        return False, str(exc)


async def send_email(
    sender: str,
    to_addrs: List[str],
    cc_addrs: List[str],
    subject: str,
    body_text: str,
    body_html: str,
) -> Tuple[str, Optional[str]]:
    """
    Dispatch an email.

    Returns a tuple of (status, error_message), where status is one of
    'sent', 'mock_sent', or 'failed'.
    """
    sender = (sender or settings.DEFAULT_SENDER_EMAIL or "acare-alerts@uwindsor.ca").strip()
    to_addrs = [addr.strip() for addr in to_addrs if addr and addr.strip()]
    cc_addrs = [addr.strip() for addr in cc_addrs if addr and addr.strip()]

    if not to_addrs and not cc_addrs:
        return "failed", "No recipient email addresses provided"

    if not is_smtp_configured():
        logger.info(
            "[EMAIL MOCK DISPATCH] From: %s | To: %s | CC: %s | Subject: '%s'",
            sender,
            ", ".join(to_addrs),
            ", ".join(cc_addrs),
            subject,
        )
        return "mock_sent", None

    success, err = await asyncio.to_thread(
        _send_via_smtp, sender, to_addrs, cc_addrs, subject, body_text, body_html
    )
    if success:
        return "sent", None
    return "failed", err


def render_missing_log_email(
    staff_name: str,
    tank_labels: List[str],
    missing_date_formatted: str,
    deadline_label: str,
    action_url: str = "/staff/log-entry",
) -> Tuple[str, str, str]:
    """
    Generate subject, plain text body, and HTML body for a missing daily log email.

    Ensures zero raw ObjectIDs, readable date formats, and professor-friendly presentation.
    """
    tank_count = len(tank_labels)
    tanks_str = ", ".join(tank_labels) if tank_labels else "assigned tanks"
    subject = f"[ACARE Alert] Missing Daily Water Quality Log ({missing_date_formatted})"

    body_text = (
        f"Hello {staff_name},\n\n"
        f"This is an automated alert from the ACARE Aquatic Facility Management System.\n\n"
        f"A daily water quality log entry was NOT recorded for {tanks_str} "
        f"by the required deadline ({deadline_label}) for {missing_date_formatted}.\n\n"
        f"Please submit the missing water quality parameters as soon as possible:\n"
        f"{action_url}\n\n"
        f"Thank you,\n"
        f"ACARE Facility Management Team"
    )

    body_html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 20px; }}
    .container {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }}
    .header {{ background-color: #0f172a; color: #ffffff; padding: 24px; text-align: left; border-bottom: 3px solid #0284c7; }}
    .header h1 {{ margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.025em; }}
    .content {{ padding: 24px; line-height: 1.6; }}
    .alert-banner {{ background-color: #fef2f2; border-left: 4px solid #ef4444; color: #991b1b; padding: 14px 16px; border-radius: 4px; margin-bottom: 20px; font-weight: 500; }}
    .details-box {{ background-color: #f1f5f9; border-radius: 6px; padding: 16px; margin: 16px 0; border: 1px solid #cbd5e1; }}
    .details-row {{ display: flex; margin-bottom: 8px; }}
    .details-row:last-child {{ margin-bottom: 0; }}
    .label {{ font-weight: 600; color: #475569; width: 140px; min-width: 140px; }}
    .value {{ color: #0f172a; font-weight: 500; }}
    .button {{ display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; margin-top: 16px; }}
    .footer {{ background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; font-size: 12px; color: #64748b; text-align: center; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ACARE Facility Alert</h1>
    </div>
    <div class="content">
      <p>Hello <strong>{staff_name}</strong>,</p>
      
      <div class="alert-banner">
        Daily Water Quality Log Missing for {missing_date_formatted}
      </div>

      <p>Our automated sweeper detected that water quality data has not been logged for the following tank(s) by the scheduled daily cutoff time:</p>

      <div class="details-box">
        <div class="details-row"><span class="label">Date:</span> <span class="value">{missing_date_formatted}</span></div>
        <div class="details-row"><span class="label">Deadline:</span> <span class="value">{deadline_label}</span></div>
        <div class="details-row"><span class="label">Tanks Affected ({tank_count}):</span> <span class="value">{tanks_str}</span></div>
      </div>

      <p>Please record the missing water quality parameters as soon as possible to ensure facility compliance and accurate environmental tracking.</p>

      <p style="text-align: center;">
        <a href="{action_url}" class="button">Log Water Quality Data</a>
      </p>
    </div>
    <div class="footer">
      This is an automated notification from the ACARE Aquatic Facility Management System. Please do not reply directly to this email.
    </div>
  </div>
</body>
</html>"""

    return subject, body_text, body_html
