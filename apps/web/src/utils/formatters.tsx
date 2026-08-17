import React from 'react';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a timestamp as the API sends it.
 *
 * The API serialises datetimes with a bare `.isoformat()` on values Mongo hands
 * back as naive UTC, so they arrive with no trailing 'Z' and no offset. Passing
 * those straight to `new Date()` makes the browser read them as local time and
 * silently skews every value by the viewer's UTC offset, so stamp them as UTC
 * before parsing. Date-only strings stay local — they carry no time to skew.
 */
export const parseApiDate = (dateStr: string | null | undefined): Date | null => {
  if (!dateStr) return null;
  let str = String(dateStr).trim();
  if (DATE_ONLY.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(str) && !/[Z+-]\d{2}:?\d{2}$/.test(str) && !str.endsWith('Z')) {
    str = str.replace(' ', 'T') + 'Z';
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

export const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-';
  const d = parseApiDate(dateStr);
  if (!d) return String(dateStr);
  if (DATE_ONLY.test(String(dateStr).trim())) {
    return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }
  return d.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export const isMongoObjectId = (str: string): boolean => {
  return typeof str === 'string' && /^[0-9a-fA-F]{24}$/.test(str);
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type QuarantineTone = 'steady' | 'soon' | 'urgent' | 'critical' | 'expired';

export interface QuarantineRemaining {
  label: string;
  tone: QuarantineTone;
}

/**
 * How much of a quarantine window is left, stepped down through days -> hours ->
 * minutes so the badge stays honest as the window closes. Reporting whole days
 * throughout is misleading at the end: a tank five minutes from release and a
 * tank a full day from release both read as "1 day".
 *
 * Anything from 23h up reads as whole days; below that the hour tier takes over,
 * then the minute tier inside the last hour. The final five minutes and the last
 * minute get their own tone so the badge escalates visually as release nears.
 */
export const formatQuarantineRemaining = (
  endDate: Date | null,
  now: Date = new Date(),
): QuarantineRemaining => {
  if (!endDate) return { label: 'No end date', tone: 'expired' };

  const remainingMs = endDate.getTime() - now.getTime();
  if (remainingMs <= 0) return { label: 'Expired', tone: 'expired' };

  if (remainingMs >= 23 * HOUR_MS) {
    const days = Math.max(1, Math.round(remainingMs / DAY_MS));
    return { label: `${days} ${days === 1 ? 'day' : 'days'} left`, tone: 'steady' };
  }

  if (remainingMs >= HOUR_MS) {
    const hrs = Math.floor(remainingMs / HOUR_MS);
    return { label: `${hrs} ${hrs === 1 ? 'hr' : 'hrs'} left`, tone: 'soon' };
  }

  if (remainingMs >= MINUTE_MS) {
    const mins = Math.floor(remainingMs / MINUTE_MS);
    return {
      label: `${mins} ${mins === 1 ? 'min' : 'mins'} left`,
      tone: mins < 5 ? 'critical' : 'urgent',
    };
  }

  return { label: '< 1 min left', tone: 'critical' };
};

export const formatBooleanBadge = (val: boolean): React.ReactNode => {
  return val ? (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      No
    </span>
  );
};

export const formatKeyForProfessor = (key: string): string => {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('Id', 'ID');
};

export const formatValueForProfessor = (val: any): React.ReactNode => {
  if (val === undefined || val === null || val === '') return <span className="text-slate-400 italic">Not Set</span>;
  if (typeof val === 'boolean') return formatBooleanBadge(val);
  
  if (typeof val === 'string') {
    if (isMongoObjectId(val)) return <span className="text-slate-400 text-xs italic">[System Reference]</span>;
    const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?)?$/;
    if (dateRegex.test(val)) {
      return formatDate(val);
    }
    return val;
  }

  if (Array.isArray(val)) {
    if (val.length === 0) return <span className="text-slate-400 italic">Empty</span>;
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {val.map((item, idx) => (
          <span key={idx} className="inline-block px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs text-slate-700">
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </span>
        ))}
      </div>
    );
  }

  if (typeof val === 'object') {
    return (
      <div className="space-y-1.5 mt-1 bg-slate-50 border border-slate-200 rounded-lg p-2.5 shadow-sm">
        {Object.entries(val).map(([k, v]) => {
          if (k.endsWith('_id') || k === '_id' || k === 'id') return null;
          return (
            <div key={k} className="text-xs flex flex-wrap items-baseline gap-2">
              <span className="font-semibold text-slate-600">{formatKeyForProfessor(k)}:</span> 
              <span className="text-slate-800">{formatValueForProfessor(v)}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return String(val);
};

export const renderModificationCard = (oldVal: any, newVal: any): React.ReactNode => {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-md shadow-xs text-sm">
      <span className="line-through text-rose-500 font-medium">{formatValueForProfessor(oldVal)}</span>
      <span className="text-slate-400 text-xs">➔</span>
      <span className="font-bold text-emerald-700">{formatValueForProfessor(newVal)}</span>
    </div>
  );
};

