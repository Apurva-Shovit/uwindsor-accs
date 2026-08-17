import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Inbox } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  formatRelativeTime,
  notificationsPathForRole,
  styleForSeverity,
  typeIcons,
  typeLabels,
  useNotificationFeed,
  type NotificationItem,
} from '../../lib/notifications';

/**
 * Topbar bell: the last 24 hours only, deliberately read-only.
 *
 * Opening the dropdown does not clear the unread dot — that only happens in the
 * full panel, so a glance from the topbar can't quietly dismiss an alert nobody
 * has actually dealt with.
 */
export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useNotificationFeed('recent');
  const items = data?.items ?? [];
  const unread = data?.recent_unread_count ?? 0;
  const panelPath = notificationsPathForRole(user?.role);

  // Click-away and Escape both close the dropdown.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const goTo = (path: string) => {
    setIsOpen(false);
    navigate(path);
  };

  const renderRow = (item: NotificationItem) => {
    const styles = styleForSeverity(item.severity);
    const Icon = typeIcons[item.type] ?? Bell;

    return (
      <button
        key={item.key}
        onClick={() => goTo(item.link)}
        className={`flex w-full gap-3 border-b border-slate-100 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-50 ${
          item.read ? '' : 'bg-brandBlueTint/40'
        }`}
      >
        <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${styles.iconWrap}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="text-xs font-bold text-slate-800">{item.title}</span>
            {!item.read && <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${styles.dot}`} />}
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-600">{item.message}</span>
          <span className="mt-1 flex items-center gap-2 text-[10px] font-semibold text-slate-400">
            <span className={`rounded border px-1.5 py-0.5 ${styles.chip}`}>{typeLabels[item.type]}</span>
            <span>{formatRelativeTime(item.created_at)}</span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        className="relative inline-flex items-center rounded-md p-2 text-brandGrey transition-colors hover:bg-surface hover:text-brandBlue sm:p-1.5"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-2.5 w-2.5 sm:right-0.5 sm:top-0.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full border border-white bg-red-500" />
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2.5">
            <span className="text-xs font-bold text-slate-800">Last 24 hours</span>
            {unread > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                {unread} unread
              </span>
            )}
          </div>

          <div className="max-h-[24rem] overflow-y-auto overscroll-contain">
            {isLoading ? (
              <div className="px-3 py-8 text-center text-xs text-slate-400">Loading notifications…</div>
            ) : items.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-slate-400">
                <Inbox className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                Nothing new in the last day.
              </div>
            ) : (
              items.map(renderRow)
            )}
          </div>

          <button
            onClick={() => goTo(panelPath)}
            className="w-full border-t border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-brandBlue transition-colors hover:bg-brandBlueTint"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
};
