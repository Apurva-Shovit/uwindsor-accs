import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Inbox,
  UserCheck,
} from 'lucide-react';
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
  { id: 'all', label: 'All Notifications' },
  { id: 'water_quality_missing', label: 'Past Water Quality Logs' },
  { id: 'quarantine_expiring', label: typeLabels.quarantine_expiring },
  { id: 'quarantine_lifted', label: typeLabels.quarantine_lifted },
  { id: 'aupp_expiring', label: typeLabels.aupp_expiring },
];

const AUTO_READ_DELAY_MS = 1200;

// Exclude management & supervisory roles from tank assignee lists
const MANAGEMENT_ROLE_PATTERNS = [
  'facility manager',
  'trevor pitcher',
  'chair user',
  'admin',
  'super admin',
  'principal investigator',
  'pi',
];

export const filterFrontlineStaff = (assignees?: string[]): string[] => {
  if (!Array.isArray(assignees)) return [];
  return assignees.filter((name) => {
    const lower = name.toLowerCase().trim();
    return !MANAGEMENT_ROLE_PATTERNS.some((pattern) => lower.includes(pattern));
  });
};

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
      <div className="mt-2.5 flex flex-wrap gap-2">
        {tanks.map((tank) => {
          const staff = filterFrontlineStaff(tank.assignees);
          return (
            <div
              key={tank.id || tank.tank_number}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-1"
            >
              <span className="text-[11px] font-bold text-slate-800">Tank {tank.tank_number}</span>
              <span className="h-3 w-px bg-slate-200" />
              <span className="text-[10px] font-medium text-slate-600">
                {staff.length > 0 ? staff.join(', ') : 'Unassigned'}
              </span>
            </div>
          );
        })}
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

  if (item.type === 'quarantine_lifted') {
    return (
      <div className="mt-2 space-y-0.5">
        <MetaRow
          label="Started"
          value={meta.quarantine_start_date ? formatDate(meta.quarantine_start_date) : null}
        />
        <MetaRow label="Window closed" value={formatDate(meta.quarantine_end_date)} />
        <MetaRow label="Released" value={formatDate(meta.lifted_at)} />
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

  return null;
};

/**
 * Enhanced Notification Feed Panel
 * Provides a dedicated, high-priority "Today's Missing Water Quality Logs" summary card
 * alongside a streamlined historical & facility notification feed.
 */
export const NotificationsPanel: React.FC = () => {
  const [filter, setFilter] = useState<Filter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);

  const { data, isLoading, isError } = useNotificationFeed('all');
  const markRead = useMarkNotificationsRead();

  const items = useMemo(() => data?.items ?? [], [data]);
  const unreadCount = data?.unread_count ?? 0;

  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const autoReadDone = useRef(false);

  useEffect(() => {
    if (autoReadDone.current || isLoading || items.length === 0) return;

    const unreadKeys = items.filter((i) => !i.read).map((i) => i.key);
    if (unreadKeys.length === 0) return;

    setHighlighted((prev) => new Set([...prev, ...unreadKeys]));
    const timer = setTimeout(() => {
      autoReadDone.current = true;
      markRead.mutate({ keys: unreadKeys });
    }, AUTO_READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items, isLoading]);

  // Extract Today's local date ISO string (e.g. "2026-08-14")
  const todayDateStr = useMemo(() => {
    if (data?.server_time) return data.server_time.slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  }, [data]);

  // Separate Today's missing water quality logs from historical/other notifications
  const todayWQItem = useMemo(() => {
    return items.find(
      (item) => item.type === 'water_quality_missing' && item.meta?.date === todayDateStr,
    );
  }, [items, todayDateStr]);

  // Filter remaining items for historical feed
  const historyItems = useMemo(() => {
    return items.filter((item) => {
      // Exclude today's missing WQ log since it's presented prominently in the top section
      if (todayWQItem && item.key === todayWQItem.key) return false;
      if (filter !== 'all' && item.type !== filter) return false;
      if (unreadOnly && !(highlighted.has(item.key) || !item.read)) return false;
      return true;
    });
  }, [items, todayWQItem, filter, unreadOnly, highlighted]);

  const counts = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const item of items) {
      if (todayWQItem && item.key === todayWQItem.key) continue;
      byType[item.type] = (byType[item.type] ?? 0) + 1;
    }
    return byType;
  }, [items, todayWQItem]);

  const todayTanks = useMemo(() => todayWQItem?.meta?.tanks || [], [todayWQItem]);

  return (
    <div className="space-y-6">
      {/* TODAY'S MISSING WATER QUALITY LOGS CARD (CARD GRID LAYOUT, NO TABLES) */}
      {todayTanks.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-l-4 border-amber-500 border-slate-200 bg-amber-50/30 p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">
                    Today's Water Quality Log Missing for {todayTanks.length} {todayTanks.length === 1 ? 'Tank' : 'Tanks'}
                  </h3>
                  <span className="rounded bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-800 uppercase tracking-wide">
                    Urgent Action Required
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  The daily cutoff was <strong className="text-slate-800">{data?.deadline?.label || '5:00 PM EDT'}</strong>. Below are the assigned frontline staff responsible for each tank:
                </p>
              </div>
            </div>

            <Link
              to="/staff/log-entry"
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#005596] px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#003A66]"
            >
              Log Entry →
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {todayTanks.map((tank: any) => {
              const staff = filterFrontlineStaff(tank.assignees);
              return (
                <div
                  key={tank.id || tank.tank_number}
                  className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-3.5 shadow-2xs transition-all hover:border-slate-300"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-bold text-slate-900">
                      Tank {tank.tank_number}
                    </span>
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                      Missing Log
                    </span>
                  </div>

                  <div className="mt-2.5 text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-600 block text-[10px] uppercase tracking-wider mb-1">
                      Assigned Staff:
                    </span>
                    {staff.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {staff.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200/60"
                          >
                            <UserCheck className="h-2.5 w-2.5 text-blue-500" />
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="italic text-slate-400 text-[11px]">
                        Unassigned
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* HISTORICAL & OTHER NOTIFICATIONS PANEL */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Bell className="h-4 w-4 text-[#005596]" />
              Facility Notifications & History
              {unreadCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                  {unreadCount} unread
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Past water quality log alerts, expiring quarantines, and lapsing AUPP licenses.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => markRead.mutate({ all: true })}
              disabled={unreadCount === 0 || markRead.isPending}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all as read
            </button>

            <button
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              {historyExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4" /> Collapse
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" /> Expand ({historyItems.length})
                </>
              )}
            </button>
          </div>
        </div>

        {historyExpanded && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map((f) => {
                const count = f.id === 'all' ? historyItems.length : counts[f.id] ?? 0;
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
            ) : historyItems.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                <Inbox className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                <p className="text-xs font-semibold">
                  {items.length > 0
                    ? 'No historical notifications match this filter.'
                    : data?.last_generated_at
                    ? 'All clear — no historical alerts found.'
                    : 'Waiting for notification check.'}
                </p>
                {data?.last_generated_at && (
                  <p className="mt-1 text-[11px]">
                    Last checked {formatRelativeTime(data.last_generated_at)}.
                  </p>
                )}
              </div>
            ) : (
              <ul className="space-y-2.5">
                {historyItems.map((item) => {
                  const styles = styleForSeverity(item.severity);
                  const Icon = typeIcons[item.type] ?? Bell;
                  const isNew = highlighted.has(item.key) || !item.read;

                  return (
                    <li
                      key={item.key}
                      className={`rounded-lg border border-l-4 border-slate-200 p-3.5 transition-colors ${styles.border} ${
                        isNew ? 'bg-blue-50/40' : 'bg-white'
                      }`}
                    >
                      <div className="flex gap-3">
                        <span
                          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${styles.iconWrap}`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900">{item.title}</h4>
                            {isNew && (
                              <span
                                className={`h-2 w-2 rounded-full ${styles.dot}`}
                                aria-label="Unread"
                              />
                            )}
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${styles.chip}`}
                            >
                              {typeLabels[item.type]}
                            </span>
                            <span className="ml-auto text-[11px] font-semibold text-slate-400">
                              {formatRelativeTime(item.created_at)}
                            </span>
                          </div>

                          <p className="mt-1 text-xs leading-relaxed text-slate-600">
                            {item.message}
                          </p>

                          <NotificationDetail item={item} />

                          <Link
                            to={item.link}
                            className="mt-2.5 inline-block text-[11px] font-bold text-brandBlue hover:underline"
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
          </>
        )}
      </div>
    </div>
  );
};
