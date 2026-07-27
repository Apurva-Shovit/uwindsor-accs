import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '../../utils/formatters';

export const Reports: React.FC = () => {
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [granularity, _setGranularity] = React.useState('monthly');
  const [eventFilter, setEventFilter] = React.useState('');
  const [auppFilter, setAuppFilter] = React.useState('');

  // Executive summary query
  const { data: execSummary } = useQuery({
    queryKey: ['execFacilitySummary', dateFrom, dateTo, granularity],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      let url = 'http://localhost:8000/reports/executive-facility-summary';
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', new Date(dateFrom + 'T00:00:00').toISOString());
      if (dateTo) params.append('date_to', new Date(dateTo + 'T23:59:59').toISOString());
      params.append('granularity', granularity);

      const res = await fetch(`${url}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch executive summary');
      return res.json();
    }
  });

  const { data, isLoading } = useQuery({
    queryKey: ['reportsSummary', dateFrom, dateTo],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      let url = 'http://localhost:8000/reports/summary';
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', new Date(dateFrom + 'T00:00:00').toISOString());
      if (dateTo) params.append('date_to', new Date(dateTo + 'T23:59:59').toISOString());
      
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch reports');
      return res.json();
    }
  });

  const formatSummary = (summaryStr: string) => {
    if (!summaryStr) return '-';
    // If it looks like a python/json dict, format it nicely
    if (summaryStr.includes('{') && summaryStr.includes('}')) {
      try {
        const jsonStr = summaryStr
          .substring(summaryStr.indexOf('{'))
          .replace(/'/g, '"');
        const obj = JSON.parse(jsonStr);
        const prefix = summaryStr.substring(0, summaryStr.indexOf('{'));
        return (
          <div className="space-y-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-brandBlueTint text-brandBlueDark mr-2">
              {prefix.replace(':', '').trim().toUpperCase()}
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {Object.entries(obj).map(([key, val]) => (
                <span key={key} className="text-xs bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                  <strong className="capitalize">{key.replace(/_/g, ' ')}:</strong> {String(val)}
                </span>
              ))}
            </div>
          </div>
        );
      } catch (e) {
        // Fallback if parsing fails
      }
    }
    return <span className="text-sm text-slate-700">{summaryStr}</span>;
  };



  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4 print:pb-2">
        <div>
          <h1 className="text-2xl font-bold text-[#005596]">Executive Facility Summary & Audit Reports</h1>
          <p className="text-sm text-slate-500 mt-1">Comprehensive population reconciliation, active protocols, and inspector-facing logs.</p>
        </div>
        <button
          onClick={() => window.print()}
          className="bg-[#005596] hover:bg-[#002B51] text-white px-5 py-2.5 rounded-lg shadow-sm font-semibold transition-all duration-200 flex items-center gap-2 print:hidden"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print Official Report
        </button>
      </div>

      {/* Executive Date Range Reconciliation Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 print:grid-cols-6">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Start Fish (Date X)</span>
          <span className="text-xl font-extrabold text-slate-900 mt-1 block">{execSummary?.starting_fish_count ?? 0}</span>
        </div>
        <div className="bg-white border border-emerald-100 bg-emerald-50/50 rounded-xl p-3.5 shadow-sm">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">+ Total Arrivals</span>
          <span className="text-xl font-extrabold text-emerald-600 mt-1 block">+{execSummary?.total_arrivals ?? 0}</span>
        </div>
        <div className="bg-white border border-red-100 bg-red-50/50 rounded-xl p-3.5 shadow-sm">
          <span className="text-[10px] font-bold text-red-700 uppercase tracking-wider block">- Total Deaths</span>
          <span className="text-xl font-extrabold text-red-600 mt-1 block">-{execSummary?.total_mortality ?? 0}</span>
        </div>
        <div className="bg-white border border-amber-100 bg-amber-50/50 rounded-xl p-3.5 shadow-sm" title="Permanent removals from facility (e.g. euthanized, manual reductions). Excludes internal transfers.">
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">- Reductions</span>
          <span className="text-xl font-extrabold text-amber-600 mt-1 block">-{execSummary?.total_dispositions ?? 0}</span>
        </div>
        <div className="bg-white border border-blue-100 bg-blue-50/50 rounded-xl p-3.5 shadow-sm">
          <span className="text-[10px] font-bold text-[#005596] uppercase tracking-wider block">= End Fish (Date Y)</span>
          <span className="text-xl font-extrabold text-[#005596] mt-1 block">{execSummary?.ending_fish_count ?? 0}</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Active Projects</span>
          <span className="text-xl font-extrabold text-slate-800 mt-1 block">{execSummary?.active_projects_count ?? 0}</span>
        </div>
      </div>


      {/* Filters (Hidden during printing) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm print:hidden space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Filter Parameters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
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
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Event Type</label>
            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#005596] focus:border-transparent transition-all"
            >
              <option value="">All Events</option>
              <option value="Census">Census</option>
              <option value="Water Quality">Water Quality</option>
              <option value="Incident">Incident</option>
              <option value="Project Closure">Project Closure</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Project (AUPP)</label>
            <input
              type="text"
              placeholder="e.g. 23-01"
              value={auppFilter}
              onChange={(e) => setAuppFilter(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#005596] focus:border-transparent transition-all"
            />
          </div>
          <div className="flex items-end gap-2">
            {(dateFrom || dateTo || eventFilter || auppFilter) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setEventFilter(''); setAuppFilter(''); }}
                className="w-full border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold py-2 rounded-lg transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Reports Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden print:border-none print:shadow-none">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <svg className="animate-spin h-8 w-8 text-[#005596] mx-auto mb-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Generating operational report...
          </div>
        ) : (() => {
          const filteredData = data.filter((row: any) => {
            if (eventFilter && row.event_type !== eventFilter) return false;
            if (auppFilter && !row.aupp_number?.toLowerCase().includes(auppFilter.toLowerCase())) return false;
            return true;
          });
          
          if (filteredData.length === 0) {
            return <div className="p-12 text-center text-slate-500">No records found matching filters.</div>;
          }

          return (
          <div className="overflow-hidden">
            <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 print:bg-slate-100">
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Location & Tank</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">AUPP #</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Event Type</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Summary</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredData.map((row: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-sm font-medium text-slate-900 whitespace-nowrap">
                      {formatDate(row.created_at || row.date)}
                    </td>
                    <td className="p-4 text-sm text-slate-500">
                      <div className="font-semibold text-slate-700">{row.facility}</div>
                      {row.room && <div className="text-xs text-slate-400">{row.room} • {row.tank}</div>}
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                        {row.aupp_number || 'N/A'}
                      </span>
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        row.event_type === 'Incident' ? 'bg-red-50 text-red-700 border border-red-100' :
                        row.event_type === 'Water Quality' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                        row.event_type === 'Project Closure' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                        'bg-blue-50 text-blue-700 border border-blue-100'
                      }`}>
                        {row.event_type}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-900 max-w-md">
                      {formatSummary(row.summary)}
                    </td>
                    <td className="p-4 text-sm text-slate-600 font-medium whitespace-nowrap">
                      {row.performed_by}
                    </td>
                  </tr>
                ))}

              </tbody>
            </table>
            </div>
            <div className="block lg:hidden flex flex-col divide-y divide-slate-100">
              {filteredData.map((row: any, i: number) => (
                <div key={i} className="p-4 flex flex-col gap-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="font-semibold text-slate-700 text-sm">{row.facility}</div>
                      {row.room && <div className="text-xs text-slate-500">{row.room} • {row.tank}</div>}
                    </div>
                    <time className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatDate(row.created_at || row.date)}</time>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                      row.event_type === 'Incident' ? 'bg-red-50 text-red-700 border-red-100' :
                      row.event_type === 'Water Quality' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                      row.event_type === 'Project Closure' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                      'bg-blue-50 text-blue-700 border-blue-100'
                    }`}>
                      {row.event_type}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                      {row.aupp_number || 'N/A'}
                    </span>
                    <span className="text-[11px] text-slate-600 ml-auto">By: <span className="font-semibold">{row.performed_by}</span></span>
                  </div>
                  <div className="text-sm text-slate-800 mt-1 bg-slate-50 rounded-lg p-2 border border-slate-100">
                    {formatSummary(row.summary)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
};
