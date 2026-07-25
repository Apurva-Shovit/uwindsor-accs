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
        weekday: 'short', 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch {
      return tsStr;
    }
  };

  const renderModifications = (before: any, after: any) => {
    if (!before && !after) return <span className="text-xs text-slate-400 italic">No detailed changes recorded.</span>;
    
    // If only one exists or they aren't objects, fall back to stringify
    if (typeof before !== 'object' && typeof after !== 'object') {
       return <pre className="whitespace-pre-wrap text-sm text-slate-600">{JSON.stringify(after || before, null, 2)}</pre>;
    }

    const allKeys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
    if (allKeys.length === 0) return <span className="text-xs text-slate-400 italic">Empty payload.</span>;

    const formatValueForProfessor = (val: any) => {
      if (val === undefined || val === null) return <span className="text-slate-400 italic">Not Set</span>;
      if (typeof val === 'boolean') return val ? 'Yes' : 'No';
      if (typeof val === 'string') {
        const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?)?$/;
        if (dateRegex.test(val)) {
          try {
            const d = new Date(val);
            if (!isNaN(d.getTime())) {
              const options: Intl.DateTimeFormatOptions = { 
                weekday: 'short', 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
              };
              if (val.includes('T')) {
                options.hour = '2-digit';
                options.minute = '2-digit';
              }
              return d.toLocaleString(undefined, options);
            }
          } catch {}
        }
      }
      if (typeof val === 'object') {
        return (
          <div className="space-y-1 mt-1 bg-white border border-slate-100 rounded p-2">
            {Object.entries(val).map(([k, v]) => (
              <div key={k} className="text-xs flex gap-2">
                <span className="font-bold text-slate-600 capitalize">{k.replace(/_/g, ' ')}:</span> 
                <span className="text-slate-700">{String(v)}</span>
              </div>
            ))}
          </div>
        );
      }
      return String(val);
    };

    const formatKeyForProfessor = (key: string) => {
      return key.replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase())
                .replace('Id', 'ID');
    };

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
                        {row.entity_id ? (
                          <div className="font-medium text-[#005596]">{row.entity_id}</div>
                        ) : (
                          <div className="capitalize font-medium text-slate-700">{row.entity_type.replace(/_/g, ' ')}</div>
                        )}
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
                {selectedLog.entity_id ? (
                  <span className="text-sm font-semibold text-[#005596]">{selectedLog.entity_id}</span>
                ) : (
                  <span className="text-sm font-semibold text-slate-700 capitalize">{selectedLog.entity_type.replace(/_/g, ' ')}</span>
                )}
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Action Performed</span>
                <span className="text-sm font-medium text-slate-800 capitalize">{selectedLog.action.replace('_', ' ')}</span>
              </div>
              <div className="space-y-2 pt-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">State Changes</span>
                {renderModifications(selectedLog.before, selectedLog.after)}
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
