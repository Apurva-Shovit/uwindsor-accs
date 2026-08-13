import React, { useEffect, useState } from 'react';
import { Clock, Save } from 'lucide-react';
import { formatDate } from '../../utils/formatters';
import {
  TIMEZONE_OPTIONS,
  toTimeInput,
  useNotificationSettings,
  useUpdateNotificationSettings,
} from '../../lib/notifications';

/**
 * Editor for the daily water quality cutoff — chair, admin and super admin only.
 *
 * The zone is picked alongside the time rather than assumed, because the whole
 * point of the setting is that "3 PM" means a wall-clock time somebody reads off
 * a clock. Saving regenerates the missed-deadline alerts server-side, so the
 * feed below re-renders against the new cutoff.
 */
export const DeadlineSettings: React.FC = () => {
  const { data, isLoading } = useNotificationSettings(true);
  const update = useUpdateNotificationSettings();

  const [time, setTime] = useState('');
  const [zone, setZone] = useState('');
  const [touched, setTouched] = useState(false);

  // Seed the form from the server once, and re-seed after a save lands, but
  // never on top of edits in progress.
  useEffect(() => {
    if (!data || touched) return;
    setTime(toTimeInput(data.deadline.hour, data.deadline.minute));
    setZone(data.deadline.timezone);
  }, [data, touched]);

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-xs text-slate-400 shadow-sm">
        Loading deadline settings…
      </div>
    );
  }

  const [hourText, minuteText] = time.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const valid = time !== '' && Number.isFinite(hour) && Number.isFinite(minute);
  const dirty =
    valid &&
    (hour !== data.deadline.hour ||
      minute !== data.deadline.minute ||
      zone !== data.deadline.timezone);

  // A zone already in use but missing from the shortlist must stay selectable,
  // or saving an unrelated time change would silently move it.
  const zoneChoices = TIMEZONE_OPTIONS.some((o) => o.id === zone)
    ? TIMEZONE_OPTIONS
    : [...TIMEZONE_OPTIONS, { id: zone, label: zone }];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    update.mutate(
      { hour, minute, timezone: zone },
      { onSuccess: () => setTouched(false) },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="border-b border-slate-100 pb-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-[#005596]">
          <Clock className="h-4 w-4" />
          Daily log deadline
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Tanks with no water quality log by this time are flagged for the staff they are
          assigned to. Currently <strong className="text-slate-700">{data.deadline.label}</strong>.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Cutoff time</span>
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTouched(true);
              setTime(e.target.value);
            }}
            required
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-800 shadow-sm focus:border-[#005596] focus:outline-none focus:ring-1 focus:ring-[#005596]"
          />
        </label>

        <label className="flex min-w-[15rem] flex-1 flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Time zone</span>
          <select
            value={zone}
            onChange={(e) => {
              setTouched(true);
              setZone(e.target.value);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 shadow-sm focus:border-[#005596] focus:outline-none focus:ring-1 focus:ring-[#005596]"
          >
            {zoneChoices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={!dirty || update.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#005596] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#003A66] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" />
          {update.isPending ? 'Saving…' : 'Save deadline'}
        </button>
      </div>

      <p className="text-[11px] text-slate-400">
        {update.isError ? (
          <span className="font-semibold text-red-600">
            The deadline could not be saved. Check the time and try again.
          </span>
        ) : update.isSuccess && !dirty ? (
          <span className="font-semibold text-emerald-600">
            Saved — missed-deadline alerts were rebuilt against the new cutoff.
          </span>
        ) : data.updated_at ? (
          <>
            Last changed {formatDate(data.updated_at)}
            {data.updated_by_name ? ` by ${data.updated_by_name}` : ''}.
          </>
        ) : (
          'Never changed from the default.'
        )}
      </p>
    </form>
  );
};
