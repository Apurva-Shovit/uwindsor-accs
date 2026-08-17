import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Droplets, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import {
  getNotificationSettings,
  getNotifications,
  markNotificationsRead,
  updateNotificationSettings,
} from './api';
import { isManagerPlus } from './roles';
import { parseApiDate } from '../utils/formatters';

export type NotificationSeverity = 'critical' | 'warning' | 'info';

export type NotificationType =
  | 'water_quality_missing'
  | 'quarantine_expiring'
  | 'quarantine_lifted'
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
  /** The daily-log cutoff every user is held to, whether or not they can change it. */
  deadline: Deadline;
  /** null until the generator has completed a pass — not the same as "all clear". */
  last_generated_at: string | null;
}

export interface Deadline {
  hour: number;
  minute: number;
  /** IANA zone name, e.g. "America/Toronto". */
  timezone: string;
  /** Ready-to-show label with the abbreviation in force today, e.g. "3:00 PM EDT". */
  label: string;
}

export interface NotificationSettings {
  deadline: Deadline;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
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

export const useNotificationSettings = (enabled: boolean) =>
  useQuery<NotificationSettings>({
    queryKey: ['notificationSettings'],
    queryFn: async () => (await getNotificationSettings()).data,
    enabled,
  });

export const useUpdateNotificationSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { hour: number; minute: number; timezone: string }) =>
      (await updateNotificationSettings(body)).data,
    onSuccess: () => {
      // Moving the cutoff regenerates the missed-deadline alerts server-side,
      // so the feed itself is stale, not just the settings card.
      queryClient.invalidateQueries({ queryKey: ['notificationSettings'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
};

/** Zones offered in the picker. Any IANA name is accepted by the API. */
export const TIMEZONE_OPTIONS: { id: string; label: string }[] = [
  { id: 'America/Toronto', label: 'Eastern — Toronto / Windsor' },
  { id: 'America/Halifax', label: 'Atlantic — Halifax' },
  { id: 'America/St_Johns', label: 'Newfoundland — St. John’s' },
  { id: 'America/Winnipeg', label: 'Central — Winnipeg' },
  { id: 'America/Edmonton', label: 'Mountain — Edmonton' },
  { id: 'America/Vancouver', label: 'Pacific — Vancouver' },
  { id: 'UTC', label: 'UTC' },
];

/** "15:04" for an <input type="time">. */
export const toTimeInput = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

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
  quarantine_lifted: 'Quarantine Lifted',
  aupp_expiring: 'AUPP Expiry',
};

export const typeIcons: Record<NotificationType, LucideIcon> = {
  water_quality_missing: Droplets,
  quarantine_expiring: ShieldAlert,
  // Deliberately the reassuring twin of the countdown's icon: the window closed
  // and the tank was cleared, which is the good outcome, not another alarm.
  quarantine_lifted: ShieldCheck,
  aupp_expiring: CalendarClock,
};
