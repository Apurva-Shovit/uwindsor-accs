import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '../../utils/formatters';
import { ModificationCard } from '../../components/audit/ModificationCard';
import { getAuditLogs } from '../../lib/api';
import { Paginator } from '../../components/ui/Paginator';
import { ProtectedView } from '../../components/security/ProtectedView';

export const AuditLogs: React.FC = () => {
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [selectedLog, setSelectedLog] = React.useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['auditLogs', dateFrom, dateTo, page],
    queryFn: async () => {
      const params: Record<string, any> = { page, page_size: 20 };
      if (dateFrom) params.date_from = new Date(dateFrom).toISOString();
      if (dateTo) params.date_to = new Date(dateTo).toISOString();
      const res = await getAuditLogs(params);
      return res.data;
    }
  });

  const logsList = Array.isArray(data) ? data : (data?.items || []);
  const total = Array.isArray(data) ? logsList.length : (data?.total || 0);
  const totalPages = Array.isArray(data) ? 1 : (data?.total_pages || 1);

  return (
    <ProtectedView allowPrint={false} className="space-y-6">

      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-[#005596]">System Audit Logs</h1>
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
          ) : !logsList || logsList.length === 0 ? (
            <div className="p-12 text-center text-slate-500">No audit events matched filters.</div>
          ) : (
            <div className="overflow-hidden">
              <div className="hidden lg:block overflow-x-auto">
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
                    {logsList.map((row: any, i: number) => (
                      <tr
                        key={row.id || i}
                        onClick={() => setSelectedLog(row)}
                        className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                          selectedLog === row ? 'bg-slate-50 font-medium' : ''
                        }`}
                      >
                        <td className="p-4 text-sm text-slate-900 whitespace-nowrap">
                          {formatDate(row.timestamp)}
                        </td>
                      <td className="p-4 text-sm text-slate-600 whitespace-nowrap">
                        <div className="font-semibold">{row.actor_name}</div>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          row.action.includes('fail') || row.action.includes('reject')
                            ? 'bg-red-50 text-red-700 border-red-100'
                            : row.action === 'placed_in_quarantine'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : row.action === 'lifted_quarantine' || row.action.includes('create') || row.action.includes('approve')
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {row.action.replace(/_/g, ' ')}
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
              <div className="block lg:hidden flex flex-col divide-y divide-slate-100">
                {logsList.map((row: any, i: number) => (
                  <div 
                    key={row.id || i} 
                    onClick={() => setSelectedLog(row)} 
                    className={`p-4 hover:bg-slate-50 cursor-pointer flex flex-col gap-2 transition-colors ${
                      selectedLog === row ? 'bg-slate-50 ring-1 ring-inset ring-[#005596]' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-semibold text-slate-900 text-sm">{row.actor_name}</span>
                      <time className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatDate(row.timestamp)}</time>
                    </div>
                    <div className="flex justify-between items-center gap-2 mt-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border capitalize ${
                          row.action.includes('fail') || row.action.includes('reject')
                            ? 'bg-red-50 text-red-700 border-red-100'
                            : row.action.includes('create') || row.action.includes('approve')
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                        {row.action.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs font-semibold text-slate-600 truncate">
                        {row.entity_id || row.entity_type.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <Paginator
                page={page}
                totalPages={totalPages}
                total={total}
                limit={20}
                onPageChange={(p) => setPage(p)}
              />
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
                <ModificationCard before={selectedLog.before} after={selectedLog.after} />
              </div>
            </div>
          ) : (
            <div className="mt-8 text-center text-slate-400 text-sm py-12 italic">
              Select an entry in the table to view the audit changes and payload data.
            </div>
          )}
        </div>
      </div>
    </ProtectedView>
  );
};

