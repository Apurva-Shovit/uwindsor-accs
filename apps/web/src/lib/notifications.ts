import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Droplets, ShieldAlert, type LucideIcon } from 'lucide-react';
import { getNotifications, markNotificationsRead } from './api';
import { isManagerPlus } from './roles';
import { parseApiDate } from '../utils/formatters';

export type NotificationSeverity = 'critical' | 'warning' | 'info';

export type NotificationType =
  | 'water_quality_missing'
  | 'quarantine_expiring'
  | 'aupp_expiring';

export interface NotificationItem {
  key: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  created_at: string;
  link: string;
  read: boolean;
  meta: Record<string, any>;
}

export interface NotificationFeed {
  items: NotificationItem[];
  total: number;
  unread_count: number;
  recent_unread_count: number;
  server_time: string;
  facility_time: string;
  facility_timezone: string;
}

/** The one place the full feed lives — both the bell and the sidebar point here. */
export const notificationsPathForRole = (role?: string | null): string =>
  isManagerPlus(role) ? '/admin/notifications' : '/staff/notifications';

const REFETCH_MS = 60_000;

/**
 * The feed is derived server-side on every call, so there is no push channel to
 * subscribe to — polling once a minute is what keeps the 5 PM deadline alert
 * from waiting on a page reload.
 */
export const useNotificationFeed = (scope: 'all' | 'recent') =>
  useQuery<NotificationFeed>({
    queryKey: ['notifications', scope],
    queryFn: async () => (await getNotifications(scope)).data,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });

export const useMarkNotificationsRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { keys?: string[]; all?: boolean }) =>
      (await markNotificationsRead(body)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
};

/** Compact "how long ago" label for feed rows. */
export const formatRelativeTime = (value: string, now: Date = new Date()): string => {
  const then = parseApiDate(value);
  if (!then) return '';

  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return 'just now';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

interface SeverityStyle {
  dot: string;
  chip: string;
  iconWrap: string;
  border: string;
}

const severityStyles: Record<NotificationSeverity, SeverityStyle> = {
  critical: {
    dot: 'bg-red-500',
    chip: 'bg-red-50 text-red-700 border-red-200',
    iconWrap: 'bg-red-50 text-red-600',
    border: 'border-l-red-500',
  },
  warning: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    iconWrap: 'bg-amber-50 text-amber-600',
    border: 'border-l-amber-500',
  },
  info: {
    dot: 'bg-sky-500',
    chip: 'bg-sky-50 text-sky-700 border-sky-200',
    iconWrap: 'bg-sky-50 text-sky-600',
    border: 'border-l-sky-500',
  },
};

/** Styles for a severity, falling back to `info` so an unrecognised one still renders. */
export const styleForSeverity = (severity: NotificationSeverity): SeverityStyle =>
  severityStyles[severity] ?? severityStyles.info;

export const typeLabels: Record<NotificationType, string> = {
  water_quality_missing: 'Water Quality',
  quarantine_expiring: 'Quarantine',
  aupp_expiring: 'AUPP Expiry',
};

export const typeIcons: Record<NotificationType, LucideIcon> = {
  water_quality_missing: Droplets,
  quarantine_expiring: ShieldAlert,
  aupp_expiring: CalendarClock,
};
