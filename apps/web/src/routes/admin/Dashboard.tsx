import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Filter } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const [selectedTank, setSelectedTank] = useState<string>('all');
  const [timeRangeDays, setTimeRangeDays] = useState<number>(30);

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

  const { data: analyticsData, isLoading: loadingAnalytics } = useQuery({
    queryKey: ['waterQualityAnalytics', selectedTank, timeRangeDays],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      params.append('days', String(timeRangeDays));
      if (selectedTank && selectedTank !== 'all') {
        params.append('tank_id', selectedTank);
      }
      const res = await fetch(`http://localhost:8000/dashboard/water-quality-analytics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch water quality analytics');
      return res.json();
    }
  });

  if (loadingSummary) return (
    <div className="p-12 text-center text-slate-500">
      <svg className="animate-spin h-8 w-8 text-[#005596] mx-auto mb-3" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      Loading dashboard data...
    </div>
  );

  const series = analyticsData?.series || [];
  const tankOptions = analyticsData?.tank_options || [];

  // Helper renderer for dynamic SVG line chart
  const renderLineChart = (
    dataKey: 'ph' | 'temperature' | 'dissolved_oxygen',
    title: string,
    unit: string,
    strokeColor: string,
    _fillColor: string,
    defaultMin: number,
    defaultMax: number
  ) => {
    const validPoints = series
      .map((item: any, idx: number) => ({ idx, val: item[dataKey], date: item.date }))
      .filter((p: any) => p.val !== null && p.val !== undefined);

    if (validPoints.length === 0) {
      return (
        <div className="bg-slate-50 rounded-xl p-8 text-center text-xs text-slate-400 border border-slate-200 italic">
          No {title} readings recorded for the selected filter.
        </div>
      );
    }

    const vals = validPoints.map((p: any) => p.val);
    const minVal = Math.min(...vals) < defaultMin ? Math.floor(Math.min(...vals)) : defaultMin;
    const maxVal = Math.max(...vals) > defaultMax ? Math.ceil(Math.max(...vals)) : defaultMax;
    const midVal = +((maxVal + minVal) / 2).toFixed(1);

    const width = 600;
    const height = 150;
    const paddingLeft = 45;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 25;

    const range = maxVal - minVal || 1;
    const getX = (index: number) => paddingLeft + (index / (series.length - 1 || 1)) * (width - paddingLeft - paddingRight);
    const getY = (val: number) => height - paddingBottom - ((val - minVal) / range) * (height - paddingTop - paddingBottom);

    const pathD = series.reduce((acc: string, item: any, index: number) => {
      const val = item[dataKey];
      if (val === null || val === undefined) return acc;
      const x = getX(index);
      const y = getY(val);
      return acc ? `${acc} L ${x} ${y}` : `M ${x} ${y}`;
    }, '');

    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: strokeColor }} />
            {title} ({unit})
          </span>
          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            Latest: <strong>{validPoints[validPoints.length - 1]?.val}</strong> {unit}
          </span>
        </div>

        <div className="relative w-full overflow-visible pt-1">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36 overflow-visible">
            {/* Y Axis numeric ticks */}
            <text x={paddingLeft - 8} y={paddingTop + 4} textAnchor="end" className="text-[10px] font-bold fill-slate-400">
              {maxVal}
            </text>
            <text x={paddingLeft - 8} y={(paddingTop + height - paddingBottom) / 2 + 3} textAnchor="end" className="text-[10px] font-bold fill-slate-400">
              {midVal}
            </text>
            <text x={paddingLeft - 8} y={height - paddingBottom + 3} textAnchor="end" className="text-[10px] font-bold fill-slate-400">
              {minVal}
            </text>

            {/* Y Axis line */}
            <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height - paddingBottom} stroke="#cbd5e1" strokeWidth="1.5" />

            {/* Grid lines */}
            <line x1={paddingLeft} y1={paddingTop} x2={width - paddingRight} y2={paddingTop} stroke="#e2e8f0" strokeDasharray="3 3" />
            <line x1={paddingLeft} y1={(paddingTop + height - paddingBottom) / 2} x2={width - paddingRight} y2={(paddingTop + height - paddingBottom) / 2} stroke="#e2e8f0" strokeDasharray="3 3" />
            <line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} stroke="#cbd5e1" />

            {/* Sparkline Path */}
            {pathD && (
              <path
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Data Points */}
            {series.map((item: any, index: number) => {
              const val = item[dataKey];
              if (val === null || val === undefined) return null;
              const x = getX(index);
              const y = getY(val);
              const labelText = `${item.date}: ${val} ${unit}`;
              const tooltipWidth = labelText.length * 5.8 + 12;
              const tooltipX = Math.min(Math.max(x - tooltipWidth / 2, paddingLeft), width - paddingRight - tooltipWidth);

              return (
                <g key={index} className="group cursor-pointer">
                  {/* Hover vertical guide line */}
                  <line
                    x1={x} y1={paddingTop} x2={x} y2={height - paddingBottom}
                    stroke={strokeColor} strokeWidth="1" strokeDasharray="2 2"
                    className="opacity-0 group-hover:opacity-60 transition-opacity"
                  />
                  {/* Point Circle */}
                  <circle cx={x} cy={y} r="4" fill={strokeColor} className="transition-all group-hover:r-6 group-hover:stroke-white group-hover:stroke-2" />

                  {/* SVG Hover Tooltip Badge showing date and exact value */}
                  <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <rect
                      x={tooltipX}
                      y={Math.max(y - 28, 2)}
                      width={tooltipWidth}
                      height="20"
                      rx="4"
                      fill="#0f172a"
                      opacity="0.9"
                    />
                    <text
                      x={tooltipX + tooltipWidth / 2}
                      y={Math.max(y - 14, 15)}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="bold"
                    >
                      {labelText}
                    </text>
                  </g>

                  <title>{labelText}</title>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="flex justify-between text-[9px] text-slate-400 font-semibold pt-1 pl-10">
          <span>{series[0]?.date || ''}</span>
          <span>{series[Math.floor(series.length / 2)]?.date || ''}</span>
          <span>{series[series.length - 1]?.date || ''}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-[#005596]">Administrator & Chair Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Real-time facility telemetry, water quality analytics, and active operational metrics.</p>
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

      {/* Facility Water Quality Analytics Section */}
      <div className="bg-[#ffffff] rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-[#005596] flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#005596]" />
              Facility Water Quality Analytics & Trends
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Time-series monitoring for pH, Temperature, and Dissolved Oxygen across facility tanks.
            </p>
          </div>

          {/* Analytics Filters */}
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={selectedTank}
                onChange={(e) => setSelectedTank(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white p-2 text-xs font-semibold text-slate-800 shadow-sm focus:ring-2 focus:ring-[#005596]"
              >
                <option value="all">All Facility Tanks</option>
                <option value="group_1_8">Tanks 1 - 8 (Group)</option>
                <option value="group_9_14">Tanks 9 - 14 (Group)</option>
                <optgroup label="Individual Tanks">
                  {tankOptions.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      Tank {t.tank_number}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setTimeRangeDays(d)}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                    timeRangeDays === d ? 'bg-[#005596] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {d}D
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3 Parameter Charts Grid */}
        {loadingAnalytics ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            <div className="animate-spin h-6 w-6 border-2 border-[#005596] border-t-transparent rounded-full mx-auto mb-2" />
            Generating telemetry analytics...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {renderLineChart('ph', 'pH Level', 'pH', '#dc2626', '#fee2e2', 6.0, 9.5)}
            {renderLineChart('temperature', 'Water Temperature', '°C', '#d97706', '#fef3c7', 18.0, 32.0)}
            {renderLineChart('dissolved_oxygen', 'Dissolved Oxygen', 'mg/L', '#059669', '#d1fae5', 0.0, 15.0)}
          </div>
        )}
      </div>

      {/* Tank Status Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">Active Tank Distribution</h2>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2">
            <div className="flex flex-col items-center justify-center p-4 bg-emerald-50 rounded-xl w-full sm:flex-1 border border-emerald-100">
              <span className="text-sm font-semibold text-emerald-800 text-center">Healthy / Assigned</span>
              <span className="text-3xl font-extrabold text-emerald-600 mt-2">{summary?.tank_status?.healthy || 0}</span>
            </div>
            <div className="flex flex-col items-center justify-center p-4 bg-amber-50 rounded-xl w-full sm:flex-1 border border-amber-100">
              <span className="text-sm font-semibold text-amber-800 text-center">Quarantine</span>
              <span className="text-3xl font-extrabold text-amber-600 mt-2">{summary?.tank_status?.quarantine || 0}</span>
            </div>
            <div className="flex flex-col items-center justify-center p-4 bg-red-50 rounded-xl w-full sm:flex-1 border border-red-100">
              <span className="text-sm font-semibold text-red-800 text-center">Needs Attention</span>
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
    </div>
  );
};
