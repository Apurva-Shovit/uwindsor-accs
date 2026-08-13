import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import { formatDate } from '../../utils/formatters';
import {
  formatRelativeTime,
  styleForSeverity,
  typeIcons,
  typeLabels,
  useMarkNotificationsRead,
  useNotificationFeed,
  type NotificationItem,
  type NotificationType,
} from '../../lib/notifications';

type Filter = 'all' | NotificationType;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'water_quality_missing', label: typeLabels.water_quality_missing },
  { id: 'quarantine_expiring', label: typeLabels.quarantine_expiring },
  { id: 'aupp_expiring', label: typeLabels.aupp_expiring },
];

// Long enough that passing through the page on the way somewhere else does not
// silently clear alerts nobody actually looked at.
const AUTO_READ_DELAY_MS = 1200;

/**
 * Renders nothing when the field is absent. The API trims its payload by role —
 * staff are not sent the tank's other assignees, the quarantine start date, or
 * the PI — so an empty row here means "not yours to see", not "missing data".
 */
const MetaRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
      <span className="font-semibold text-slate-500">{label}:</span>
      <span className="text-slate-800">{value}</span>
    </div>
  );
};

const NotificationDetail: React.FC<{ item: NotificationItem }> = ({ item }) => {
  const meta = item.meta || {};

  if (item.type === 'water_quality_missing') {
    const tanks: any[] = meta.tanks || [];
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tanks.map((tank) => (
          <span
            key={tank.id}
            className="inline-flex flex-col rounded-md border border-slate-200 bg-slate-50 px-2 py-1"
          >
            <span className="text-[11px] font-bold text-slate-800">Tank {tank.tank_number}</span>
            {/* Only managers are sent the roster; staff see the tank alone. */}
            {Array.isArray(tank.assignees) && (
              <span className="text-[10px] text-slate-500">
                {tank.assignees.length ? tank.assignees.join(', ') : 'Unassigned'}
              </span>
            )}
          </span>
        ))}
      </div>
    );
  }

  if (item.type === 'quarantine_expiring') {
    return (
      <div className="mt-2 space-y-0.5">
        <MetaRow
          label="Started"
          value={meta.quarantine_start_date ? formatDate(meta.quarantine_start_date) : null}
        />
        <MetaRow label="Ends" value={formatDate(meta.quarantine_end_date)} />
      </div>
    );
  }

  if (item.type === 'aupp_expiring') {
    return (
      <div className="mt-2 space-y-0.5">
        <MetaRow label="AUPP" value={meta.aupp_number} />
        <MetaRow label="Principal Investigator" value={meta.pi_name} />
        <MetaRow label="Expires" value={formatDate(meta.aupp_expiry_date)} />
      </div>
    );
  }

  // A type this build doesn't know about still renders its title and message.
  return null;
};

/**
 * The full notification feed. Viewing it is what clears the bell's unread dot —
 * items that were unread on arrival stay visually flagged for the rest of the
 * visit so the read receipt doesn't hide what was new.
 */
export const NotificationsPanel: React.FC = () => {
  const [filter, setFilter] = useState<Filter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data, isLoading, isError } = useNotificationFeed('all');
  const markRead = useMarkNotificationsRead();

  const items = useMemo(() => data?.items ?? [], [data]);
  const unreadCount = data?.unread_count ?? 0;

  // Keys that were unread when this panel first saw them, kept so the rows stay
  // highlighted after the receipts are written.
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const autoReadDone = useRef(false);

  useEffect(() => {
    if (autoReadDone.current || isLoading || items.length === 0) return;

    const unreadKeys = items.filter((i) => !i.read).map((i) => i.key);
    if (unreadKeys.length === 0) return;

    setHighlighted((prev) => new Set([...prev, ...unreadKeys]));
    // The guard is set from inside the timer, not before it: a poll landing in
    // the meantime cancels this one and schedules a fresh timer, and flipping
    // the guard early would leave that second pass doing nothing.
    const timer = setTimeout(() => {
      autoReadDone.current = true;
      markRead.mutate({ keys: unreadKeys });
    }, AUTO_READ_DELAY_MS);
    return () => clearTimeout(timer);
    // markRead is recreated on every render; depending on it would re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, isLoading]);

  const visible = items.filter((item) => {
    if (filter !== 'all' && item.type !== filter) return false;
    if (unreadOnly && !(highlighted.has(item.key) || !item.read)) return false;
    return true;
  });

  const counts = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const item of items) byType[item.type] = (byType[item.type] ?? 0) + 1;
    return byType;
  }, [items]);

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[#005596]">
            <Bell className="h-5 w-5" />
            Notifications
            {unreadCount > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                {unreadCount} unread
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Missed water quality logs, closing quarantine windows, and lapsing AUPPs.
            {data?.deadline && (
              <span className="ml-1 text-slate-400">
                Daily log cutoff is {data.deadline.label}.
              </span>
            )}
          </p>
        </div>

        <button
          onClick={() => markRead.mutate({ all: true })}
          disabled={unreadCount === 0 || markRead.isPending}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Mark all as read
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const count = f.id === 'all' ? items.length : counts[f.id] ?? 0;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                filter === f.id
                  ? 'bg-[#005596] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
        <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-[#005596] focus:ring-[#005596]"
          />
          Unread only
        </label>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-xs text-slate-400">Loading notifications…</div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 py-8 text-center text-xs font-semibold text-red-700">
          Notifications could not be loaded.
        </div>
      ) : visible.length === 0 ? (
        <div className="py-10 text-center text-slate-400">
          <Inbox className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-xs font-semibold">
            {items.length > 0
              ? 'Nothing matches this filter.'
              : /* An empty feed the generator has never filled is not the same
                   claim as an empty feed it just checked. */
                data?.last_generated_at
                ? 'All clear — nothing needs attention.'
                : 'Waiting for the first check to run.'}
          </p>
          {items.length === 0 && data?.last_generated_at && (
            <p className="mt-1 text-[11px]">Last checked {formatRelativeTime(data.last_generated_at)}.</p>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => {
            const styles = styleForSeverity(item.severity);
            const Icon = typeIcons[item.type] ?? Bell;
            const isNew = highlighted.has(item.key) || !item.read;

            return (
              <li
                key={item.key}
                className={`rounded-lg border border-l-4 border-slate-200 p-3 transition-colors ${styles.border} ${
                  isNew ? 'bg-brandBlueTint/30' : 'bg-white'
                }`}
              >
                <div className="flex gap-3">
                  <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${styles.iconWrap}`}>
                    <Icon className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
                      {isNew && <span className={`h-2 w-2 rounded-full ${styles.dot}`} aria-label="Unread" />}
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${styles.chip}`}>
                        {typeLabels[item.type]}
                      </span>
                      <span className="ml-auto text-[11px] font-semibold text-slate-400">
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>

                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.message}</p>

                    <NotificationDetail item={item} />

                    <Link
                      to={item.link}
                      className="mt-2 inline-block text-[11px] font-bold text-brandBlue hover:underline"
                    >
                      Take action →
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
