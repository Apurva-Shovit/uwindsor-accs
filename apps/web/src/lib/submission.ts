/**
 * Helpers for the forms that move fish: census, intake and tank transfer.
 *
 * A disabled submit button stops a double-click, but it cannot help when the
 * request left the tablet and the reply never came back. Staff work on shared
 * tablets in a wet room with patchy wifi, so that is not a hypothetical: they
 * tap again, and the same mortality is recorded twice. The API accepts a
 * `request_id` on those three endpoints and refuses a key it has already seen,
 * which is what makes a retry safe.
 */

/** A key identifying one submission attempt. */
export function newRequestId(): string {
  // randomUUID needs a secure context. The Capacitor WebView and any https
  // deployment have one; a plain-http build served on the LAN does not, and
  // there it would be undefined rather than merely weaker.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Whether the server replied at all.
 *
 * This is the question that decides what happens to the request id. A server
 * that answered has already released the key, so the next attempt is a new
 * submission and needs a new one. A request that got no reply may or may not
 * have been applied, so its key has to be reused for the retry to be
 * recognised as the same entry rather than a second one.
 */
export function serverAnswered(err: unknown): boolean {
  return Boolean((err as { response?: unknown } | null)?.response);
}

/** A write refused because someone else changed the record first. */
export function isConflict(err: unknown): boolean {
  return (err as { response?: { status?: number } } | null)?.response?.status === 409;
}

/**
 * The message to show for a failed write.
 *
 * The API's 409s name the value the record now holds ("This tank now holds 42
 * fish"), which is the one thing that tells the user what to do next, so it is
 * preferred over any wording invented here.
 */
export function submitErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } } | null)
    ?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (!serverAnswered(err)) {
    return 'No response from the server. Check the connection and try again - resubmitting will not double-count this entry.';
  }
  return fallback;
}
