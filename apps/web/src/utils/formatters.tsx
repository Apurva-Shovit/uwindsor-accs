import React from 'react';

export const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleString('en-US', { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } catch {
    return String(dateStr);
  }
};

export const isMongoObjectId = (str: string): boolean => {
  return typeof str === 'string' && /^[0-9a-fA-F]{24}$/.test(str);
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

