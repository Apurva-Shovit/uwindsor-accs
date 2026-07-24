import React from 'react';
import { useQuery } from '@tanstack/react-query';

export const AuditLogs: React.FC = () => {
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [selectedLog, setSelectedLog] = React.useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['auditLogs', dateFrom, dateTo],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      let url = 'http://localhost:8000/audit-logs';
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', new Date(dateFrom).toISOString());
      if (dateTo) params.append('date_to', new Date(dateTo).toISOString());
      
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch audit logs');
      return res.json();
    }
  });

  const formatTimestamp = (tsStr: string) => {
    if (!tsStr) return '-';
    try {
      const d = new Date(tsStr);
      return d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch {
      return tsStr;
    }
  };

  const renderDiffTable = (before: any, after: any) => {
    if (!before && !after) return <span className="text-xs text-slate-400 italic">No detailed changes recorded.</span>;
    
    // If only one exists or they aren't objects, fall back to stringify
    if (typeof before !== 'object' && typeof after !== 'object') {
       return <pre className="whitespace-pre-wrap">{JSON.stringify(after || before, null, 2)}</pre>;
    }

    const allKeys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
    if (allKeys.length === 0) return <span className="text-xs text-slate-400 italic">Empty payload.</span>;

    return (
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
              <th className="p-2 border-r border-slate-200 w-1/3">Field</th>
              <th className="p-2 border-r border-slate-200 w-1/3 text-red-600">Old Value</th>
              <th className="p-2 w-1/3 text-emerald-600">New Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {allKeys.map(key => {
              const oldVal = before ? before[key] : undefined;
              const newVal = after ? after[key] : undefined;
              
              // Skip if both undefined or both the same
              if (oldVal === undefined && newVal === undefined) return null;
              
              const isChanged = JSON.stringify(oldVal) !== JSON.stringify(newVal);
              if (!isChanged) return null; // Only show fields that changed or were added/removed

              const displayOld = oldVal === undefined ? <span className="text-slate-300 italic">null</span> : JSON.stringify(oldVal);
              const displayNew = newVal === undefined ? <span className="text-slate-300 italic">null</span> : JSON.stringify(newVal);

              return (
                <tr key={key} className={isChanged ? 'bg-amber-50/30' : ''}>
                  <td className="p-2 border-r border-slate-200 font-mono text-slate-700 break-all">{key}</td>
                  <td className={`p-2 border-r border-slate-200 break-all font-mono ${oldVal === undefined ? 'text-slate-400' : 'text-red-700 line-through opacity-75'}`}>
                    {displayOld}
                  </td>
                  <td className={`p-2 break-all font-mono ${newVal === undefined ? 'text-slate-400' : 'text-emerald-700 font-bold'}`}>
                    {displayNew}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-[#005596]">System Audit Logs</h1>
        <p className="text-sm text-slate-500 mt-1">
          Traceable history of all login attempts, system updates, and user modifications.
        </p>
      </div>

      {/* Date Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Filter History</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#005596] focus:border-transparent transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#005596] focus:border-transparent transition-all"
            />
          </div>
          <div className="flex items-end">
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="w-full border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold py-2 rounded-lg transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden lg:col-span-2">
          {isLoading ? (
            <div className="p-12 text-center text-slate-500">
              <svg className="animate-spin h-8 w-8 text-[#005596] mx-auto mb-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Fetching audit history...
            </div>
          ) : !data || data.length === 0 ? (
            <div className="p-12 text-center text-slate-500">No audit events matched filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Timestamp</th>
                    <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Actor</th>
                    <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Action</th>
                    <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Entity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map((row: any, i: number) => (
                    <tr
                      key={i}
                      onClick={() => setSelectedLog(row)}
                      className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                        selectedLog === row ? 'bg-slate-50 font-medium' : ''
                      }`}
                    >
                      <td className="p-4 text-sm text-slate-900 whitespace-nowrap">
                        {formatTimestamp(row.timestamp)}
                      </td>
                      <td className="p-4 text-sm text-slate-600 whitespace-nowrap">
                        <div className="font-semibold">{row.actor_name}</div>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          row.action.includes('fail') || row.action.includes('reject')
                            ? 'bg-red-50 text-red-700 border-red-100'
                            : row.action.includes('create') || row.action.includes('approve')
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {row.action.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                        <div className="capitalize font-medium text-slate-700">{row.entity_type}</div>
                        <div className="text-[10px] text-slate-400 font-mono tracking-tighter">{row.entity_id}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Audit Details Panel */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm h-fit">
          <h2 className="text-lg font-bold text-[#005596] border-b border-slate-100 pb-3">Change Details</h2>
          {selectedLog ? (
            <div className="mt-4 space-y-4">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Entity Type & ID</span>
                <span className="text-sm font-semibold text-slate-700 capitalize">{selectedLog.entity_type}</span>
                <span className="text-xs text-slate-400 font-mono block mt-0.5">{selectedLog.entity_id}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Action Performed</span>
                <span className="text-sm font-medium text-slate-800 capitalize">{selectedLog.action.replace('_', ' ')}</span>
              </div>
              <div className="space-y-2 pt-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">State Changes</span>
                {renderDiffTable(selectedLog.before, selectedLog.after)}
              </div>
            </div>
          ) : (
            <div className="mt-8 text-center text-slate-400 text-sm py-12 italic">
              Select an entry in the table to view the audit changes and payload data.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
