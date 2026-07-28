import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '../../utils/formatters';
import { Database, Search, Filter } from 'lucide-react';


export const TankHistoryPage: React.FC = () => {
  const [selectedTankId, setSelectedTankId] = useState('');
  const [eventType, setEventType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [keyword, setKeyword] = useState('');

  // Fetch available tanks
  const { data: tanks } = useQuery({
    queryKey: ['tanksList'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:8000/facilities-structure/tanks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch tanks');
      return res.json();
    }
  });

  // Fetch history search results
  const { data: history, isLoading } = useQuery({
    queryKey: ['tankHistorySearch', selectedTankId, eventType, dateFrom, dateTo, keyword],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (selectedTankId) params.append('tank_id', selectedTankId);
      if (eventType) params.append('event_type', eventType);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (keyword) params.append('keyword', keyword);

      const res = await fetch(`http://localhost:8000/facilities-structure/tanks/history/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch tank history');
      return res.json();
    }
  });



  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-[#005596] flex items-center gap-2">
          <Database className="w-7 h-7 text-[#005596]" />
          Dedicated Tank History Explorer
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Full-page chronological log search across census adjustments, daily water quality parameters, test strips, and incident reports.
        </p>
      </div>

      {/* Advanced Filter Panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#005596]" /> Filter Parameters
          </h2>
          {(selectedTankId || eventType || dateFrom || dateTo || keyword) && (
            <button
              onClick={() => {
                setSelectedTankId('');
                setEventType('');
                setDateFrom('');
                setDateTo('');
                setKeyword('');
              }}
              className="text-xs font-semibold text-[#005596] hover:underline"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          {/* Tank Dropdown */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase">Tank</label>
            <select
              value={selectedTankId}
              onChange={(e) => setSelectedTankId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#005596] focus:outline-none"
            >
              <option value="">All Tanks</option>
              {tanks?.map((t: any) => {
                const tankId = t.id || t._id || '';
                return (
                  <option key={tankId} value={tankId}>
                    Tank {t.tank_number}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Event Category */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase">Category</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#005596] focus:outline-none"
            >
              <option value="">All Categories</option>
              <option value="census">Census Events</option>
              <option value="quarantine">Quarantine Events</option>
              <option value="water_quality">Water Quality</option>
              <option value="incident">Incidents</option>
            </select>
          </div>

          {/* Date From */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#005596] focus:outline-none"
            />
          </div>

          {/* Date To */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#005596] focus:outline-none"
            />
          </div>

          {/* Keyword Search */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase">Keyword</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search details..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#005596] focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* History Timeline Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="animate-spin h-8 w-8 border-4 border-[#005596] border-t-transparent rounded-full mx-auto mb-3" />
            Loading tank history records...
          </div>
        ) : !history || history.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No history events found matching your filter criteria.</div>
        ) : (
          <div className="overflow-hidden">
            <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <th className="p-4">Date</th>
                  <th className="p-4">Tank #</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Event Type</th>
                  <th className="p-4">Details & Parameters</th>
                  <th className="p-4">Comments / Notes</th>
                  <th className="p-4">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {history.map((row: any) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-semibold text-slate-900 whitespace-nowrap">
                      {formatDate(row.created_at || row.date)}
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-[#005596]">
                        Tank {row.tank_number}
                      </span>
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        row.category === 'Census' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                        row.category === 'Quarantine' ? 'bg-amber-50 text-amber-800 border border-amber-300' :
                        row.category === 'Water Quality' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        {row.category}
                      </span>
                    </td>
                    <td className="p-4 font-medium text-slate-700 whitespace-nowrap">
                      {row.event_type === 'quarantine_placed' ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">Quarantine Placed</span>
                      ) : row.event_type === 'quarantine_lifted' ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">Quarantine Lifted</span>
                      ) : (
                        <span className="capitalize">{String(row.event_type).replace('_', ' ')}</span>
                      )}
                    </td>
                    <td className="p-4 text-slate-800 max-w-md font-mono text-xs">
                      {row.details}
                    </td>
                    <td className="p-4 text-slate-500 text-xs max-w-xs">
                      {row.notes || '-'}
                    </td>
                    <td className="p-4 text-slate-600 text-xs font-medium whitespace-nowrap">
                      {row.created_by}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="block lg:hidden flex flex-col divide-y divide-slate-100">
              {history.map((row: any) => (
                <div key={row.id} className="p-4 flex flex-col gap-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-[#005596]">
                      Tank {row.tank_number}
                    </span>
                    <time className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatDate(row.created_at || row.date)}</time>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                        row.category === 'Census' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                        row.category === 'Water Quality' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {row.category}
                    </span>
                    <span className="text-[11px] font-medium text-slate-700 capitalize">
                      {row.event_type}
                    </span>
                    <span className="text-[11px] text-slate-600 ml-auto">By: <span className="font-semibold">{row.created_by}</span></span>
                  </div>
                  <div className="text-xs text-slate-800 mt-1 bg-slate-50 rounded p-2 font-mono">
                    {row.details}
                  </div>
                  {row.notes && (
                    <div className="text-xs text-slate-500 italic mt-1">
                      Note: {row.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
