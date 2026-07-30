import React from 'react';
import { formatKeyForProfessor, formatValueForProfessor } from '../../utils/formatters';

interface ModificationCardProps {
  before: any;
  after: any;
  compact?: boolean;
}

export const ModificationCard: React.FC<ModificationCardProps> = ({ before, after, compact }) => {
  if (!before && !after) return <span className="text-xs text-slate-400 italic">No detailed changes recorded.</span>;
  
  // If only one exists or they aren't objects, fall back to stringify
  if (typeof before !== 'object' && typeof after !== 'object') {
     return <pre className="whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(after || before, null, 2)}</pre>;
  }

  const allKeys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  if (allKeys.length === 0) return <span className="text-xs text-slate-400 italic">Empty payload.</span>;

  const changes = allKeys.map(key => {
    const oldVal = before ? before[key] : undefined;
    const newVal = after ? after[key] : undefined;
    
    if (oldVal === undefined && newVal === undefined) return null;
    
    // Filter out ALL Mongo IDs, system timestamps, and passwords (keeping only necessary details)
    const systemFields = ['_id', 'id', 'v', 'created_at', 'updated_at', 'deleted_at', 'password_hash'];
    if (systemFields.includes(key) || key.endsWith('_id') || key.endsWith('_ids')) return null;

    const isChanged = JSON.stringify(oldVal) !== JSON.stringify(newVal);
    if (!isChanged) return null;

    return { key, oldVal, newVal };
  }).filter(Boolean);

  if (changes.length === 0) return <span className="text-xs text-slate-400 italic">No operational changes.</span>;

  if (compact) {
    return (
      <div className="space-y-1 mt-1 text-[11px]">
        {changes.map((change: any) => (
          <div key={change.key} className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200/80 rounded px-2.5 py-1">
            <span className="font-bold text-slate-500 uppercase text-[10px]">{formatKeyForProfessor(change.key)}:</span>
            {change.oldVal === undefined || change.oldVal === null ? (
              <span className="font-bold text-[#005596]">{formatValueForProfessor(change.newVal)}</span>
            ) : change.newVal === undefined || change.newVal === null ? (
              <span className="text-red-600 line-through opacity-75">{formatValueForProfessor(change.oldVal)}</span>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 line-through">{formatValueForProfessor(change.oldVal)}</span>
                <span className="text-slate-400 font-bold">→</span>
                <span className="font-bold text-[#005596]">{formatValueForProfessor(change.newVal)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-2">
      {changes.map((change: any) => (
        <div key={change.key} className="bg-slate-50 border border-slate-100 rounded-lg p-3">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            {formatKeyForProfessor(change.key)}
          </div>
          {change.oldVal === undefined || change.oldVal === null ? (
            <div className="text-sm font-bold text-[#005596]">
              {formatValueForProfessor(change.newVal)}
            </div>
          ) : change.newVal === undefined || change.newVal === null ? (
            <div className="text-sm font-medium text-red-600 line-through opacity-75">
              {formatValueForProfessor(change.oldVal)}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-sm">
              <div className="text-slate-500 line-through truncate max-w-[250px]">
                {formatValueForProfessor(change.oldVal)}
              </div>
              <svg className="w-4 h-4 text-slate-300 hidden sm:block shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
              <div className="font-bold text-[#005596] break-words">
                {formatValueForProfessor(change.newVal)}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

