import React from 'react';
import { useQuery } from '@tanstack/react-query';

export const Dashboard: React.FC = () => {
  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['dashboardSummary'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:8000/dashboard/summary', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch summary');
      return res.json();
    }
  });

  const { data: activity, isLoading: loadingActivity } = useQuery({
    queryKey: ['dashboardActivity'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:8000/dashboard/activity', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch activity');
      return res.json();
    }
  });

  const formatTimestamp = (tsStr: string) => {
    if (!tsStr) return '-';
    try {
      const d = new Date(tsStr);
      return d.toLocaleString(undefined, {
        dateStyle: 'short',
        timeStyle: 'short'
      });
    } catch {
      return tsStr;
    }
  };

  if (loadingSummary || loadingActivity) return (
    <div className="p-12 text-center text-slate-500">
      <svg className="animate-spin h-8 w-8 text-[#005596] mx-auto mb-3" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      Loading dashboard data...
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-[#005596]">Administrator & Chair Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Real-time overview of facility metrics and recent operations.</p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow duration-200 flex items-center gap-4">
          <div className="p-3.5 bg-blue-50 rounded-lg text-[#005596]">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Users</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{summary?.users}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow duration-200 flex items-center gap-4">
          <div className="p-3.5 bg-emerald-50 rounded-lg text-emerald-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Projects</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{summary?.projects}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow duration-200 flex items-center gap-4">
          <div className="p-3.5 bg-amber-50 rounded-lg text-amber-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending Approvals</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{summary?.pending_approvals}</p>
          </div>
        </div>
      </div>

      {/* Tank Status Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">Active Tank Distribution</h2>
          <div className="flex items-center justify-between gap-6 py-2">
            <div className="flex flex-col items-center justify-center p-4 bg-emerald-50 rounded-xl flex-1 border border-emerald-100">
              <span className="text-sm font-semibold text-emerald-800">Healthy / Assigned</span>
              <span className="text-3xl font-extrabold text-emerald-600 mt-2">{summary?.tank_status?.healthy || 0}</span>
            </div>
            <div className="flex flex-col items-center justify-center p-4 bg-amber-50 rounded-xl flex-1 border border-amber-100">
              <span className="text-sm font-semibold text-amber-800">Quarantine</span>
              <span className="text-3xl font-extrabold text-amber-600 mt-2">{summary?.tank_status?.quarantine || 0}</span>
            </div>
            <div className="flex flex-col items-center justify-center p-4 bg-red-50 rounded-xl flex-1 border border-red-100">
              <span className="text-sm font-semibold text-red-800">Needs Attention</span>
              <span className="text-3xl font-extrabold text-red-600 mt-2">{summary?.tank_status?.attention || 0}</span>
            </div>
          </div>
        </div>

        {/* Recent Incidents (Last 7 Days) */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800 mb-2 border-b border-slate-100 pb-2">Alert Status</h2>
            <p className="text-sm text-slate-500">Number of incident reports submitted in the last 7 days.</p>
          </div>
          <div className="flex items-center gap-4 py-3">
            <span className={`inline-flex items-center justify-center rounded-full p-2.5 ${
              (summary?.recent_incidents || 0) > 0 ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-slate-50 text-slate-400'
            }`}>
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </span>
            <div>
              <span className="text-3xl font-extrabold text-slate-900">
                {summary?.recent_incidents || 0}
              </span>
              <span className="text-sm font-semibold text-slate-500 ml-2">Incidents recorded</span>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[#005596] border-b border-slate-100 pb-3 mb-4">Recent Activity Feed</h2>
        <div className="flow-root">
          <ul className="-mb-8">
            {activity && activity.length > 0 ? (
              activity.map((item: any, idx: number) => (
                <li key={idx}>
                  <div className="relative pb-8">
                    {idx !== activity.length - 1 && (
                      <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-slate-200" aria-hidden="true" />
                    )}
                    <div className="relative flex space-x-3">
                      <div>
                        <span className="h-8 w-8 rounded-full bg-blue-50 border border-[#005596] flex items-center justify-center ring-8 ring-white text-[#005596]">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                          </svg>
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                        <div>
                          <p className="text-sm text-slate-700">
                            <strong className="text-slate-900 font-semibold">{item.actor_name}</strong> performed{' '}
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-800 capitalize">
                              {item.action.replace('_', ' ')}
                            </span>{' '}
                            on <span className="font-semibold text-slate-600">{item.entity_type.replace(/_/g, ' ')}</span>
                            {item.entity_id && (
                              <>
                                : <span className="text-sm font-medium text-[#005596]">{item.entity_id}</span>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="text-right text-xs whitespace-nowrap text-slate-500 font-medium">
                          <time>{formatTimestamp(item.created_at)}</time>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))
            ) : (
              <p className="text-center text-slate-500 text-sm py-6">No recent activities logged.</p>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};
