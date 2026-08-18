import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Filter, Maximize2, X } from 'lucide-react';
import { getDashboardSummary, getWaterQualityAnalytics } from '../../lib/api';

export const Dashboard: React.FC = () => {
  const [selectedTank, setSelectedTank] = useState<string>('all');
  const [timeRangeDays, setTimeRangeDays] = useState<number>(30);
  const [tappedCard, setTappedCard] = useState<string | null>(null);
  const [enlargedChart, setEnlargedChart] = useState<'ph' | 'temperature' | 'dissolved_oxygen' | null>(null);

  // Keyboard shortcut listener to close enlarged graph on Escape key press
  useEffect(() => {
    if (!enlargedChart) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEnlargedChart(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enlargedChart]);

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['dashboardSummary'],
    queryFn: async () => {
      const res = await getDashboardSummary();
      return res.data;
    }
  });

  const { data: analyticsData, isLoading: loadingAnalytics } = useQuery({
    queryKey: ['waterQualityAnalytics', selectedTank, timeRangeDays],
    queryFn: async () => {
      const params: Record<string, any> = { days: timeRangeDays };
      if (selectedTank && selectedTank !== 'all') {
        params.tank_id = selectedTank;
      }
      const res = await getWaterQualityAnalytics(params);
      return res.data;
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
  const tankGroups = analyticsData?.groups || [
    { id: 'group_1_8', label: 'Tanks 1 - 8 (Group)' },
    { id: 'group_9_14', label: 'Tanks 9 - 14 (Group)' },
  ];
  const summaryStats = analyticsData?.summary_stats;

  // Helper renderer for dynamic SVG line chart
  const renderLineChart = (
    dataKey: 'ph' | 'temperature' | 'dissolved_oxygen',
    title: string,
    unit: string,
    strokeColor: string,
    _fillColor: string,
    defaultMin: number,
    defaultMax: number,
    isEnlarged: boolean = false
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
    const paramStats = summaryStats?.[dataKey];
    const latestVal = paramStats?.latest ?? validPoints[validPoints.length - 1]?.val;

    const minVal = paramStats?.min !== null && paramStats?.min !== undefined
      ? (paramStats.min < defaultMin ? Math.floor(paramStats.min) : defaultMin)
      : (Math.min(...vals) < defaultMin ? Math.floor(Math.min(...vals)) : defaultMin);

    const maxVal = paramStats?.max !== null && paramStats?.max !== undefined
      ? (paramStats.max > defaultMax ? Math.ceil(paramStats.max) : defaultMax)
      : (Math.max(...vals) > defaultMax ? Math.ceil(Math.max(...vals)) : defaultMax);

    const midVal = paramStats?.mid ?? +((maxVal + minVal) / 2).toFixed(1);

    const width = isEnlarged ? 850 : 600;
    const height = isEnlarged ? 340 : 160;
    const paddingLeft = isEnlarged ? 55 : 45;
    const paddingRight = isEnlarged ? 25 : 20;
    const paddingTop = isEnlarged ? 30 : 20;
    const paddingBottom = isEnlarged ? 45 : 30;

    const range = maxVal - minVal || 1;
    const getX = (index: number) => paddingLeft + (index / (series.length - 1 || 1)) * (width - paddingLeft - paddingRight);
    const getY = (val: number) => height - paddingBottom - ((val - minVal) / range) * (height - paddingTop - paddingBottom);
    const validIndices = series
      .map((item: any, idx: number) => (item[dataKey] !== null && item[dataKey] !== undefined ? idx : -1))
      .filter((idx: number) => idx !== -1);

    const interpolatedSeries = series.map((item: any, idx: number) => {
      const val = item[dataKey];
      if (val !== null && val !== undefined) {
        return { ...item, val, isInterpolated: false };
      }

      // Find nearest preceding and succeeding valid indices for smooth trend estimation
      const prevIdx = validIndices.slice().reverse().find((i: number) => i < idx);
      const nextIdx = validIndices.find((i: number) => i > idx);

      let interpolatedVal: number;
      if (prevIdx !== undefined && nextIdx !== undefined) {
        const prevVal = series[prevIdx][dataKey];
        const nextVal = series[nextIdx][dataKey];
        const ratio = (idx - prevIdx) / (nextIdx - prevIdx);
        interpolatedVal = prevVal + (nextVal - prevVal) * ratio;
      } else if (prevIdx !== undefined) {
        interpolatedVal = series[prevIdx][dataKey];
      } else if (nextIdx !== undefined) {
        interpolatedVal = series[nextIdx][dataKey];
      } else {
        interpolatedVal = midVal;
      }

      return { ...item, val: interpolatedVal, isInterpolated: true };
    });

    const dashedPathD = interpolatedSeries.reduce((acc: string, item: any, idx: number) => {
      const x = getX(idx);
      const y = getY(item.val);
      return acc ? `${acc} L ${x} ${y}` : `M ${x} ${y}`;
    }, '');

    let inSolidSegment = false;
    const solidPathD = interpolatedSeries.reduce((acc: string, item: any, idx: number) => {
      if (item.isInterpolated) {
        inSolidSegment = false;
        return acc;
      }
      const x = getX(idx);
      const y = getY(item.val);
      const command = !inSolidSegment ? `M ${x} ${y}` : `L ${x} ${y}`;
      inSolidSegment = true;
      return acc ? `${acc} ${command}` : command;
    }, '');

    const missingDays = series.filter((item: any) => item.log_count === 0);

    // Generate Y-axis ticks (5 ticks for enlarged mode with parallel gridlines, 3 for standard mode)
    const yTickCount = isEnlarged ? 5 : 3;
    const yTicks = Array.from({ length: yTickCount }, (_, i) => {
      const val = minVal + (range * i) / (yTickCount - 1);
      return +val.toFixed(1);
    });

    return (
      <div
        onClick={() => !isEnlarged && setEnlargedChart(dataKey)}
        className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2 ${
          !isEnlarged ? 'cursor-pointer hover:border-slate-300 hover:shadow-md transition-all group/card relative' : ''
        }`}
        title={!isEnlarged ? 'Click to enlarge graph' : undefined}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: strokeColor }} />
            {title} ({unit})
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              Latest: <strong>{latestVal}</strong> {unit}
            </span>
            {!isEnlarged && (
              <span className="p-1 text-slate-400 group-hover/card:text-[#005596] rounded transition-colors" title="Click to enlarge">
                <Maximize2 className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        </div>

        <div className="relative w-full overflow-visible pt-1">
          <svg viewBox={`0 0 ${width} ${height}`} className={`w-full ${isEnlarged ? 'h-72' : 'h-40'} overflow-visible`}>
            {/* Y Axis numeric ticks & horizontal grid lines parallel to X-axis */}
            {yTicks.map((tickVal, i) => {
              const yPos = getY(tickVal);
              const isBottom = i === 0;
              return (
                <g key={`y-tick-${i}`}>
                  <text
                    x={paddingLeft - 8}
                    y={yPos + 4}
                    textAnchor="end"
                    className={`${isEnlarged ? 'text-[11px]' : 'text-[10px]'} font-bold fill-slate-400`}
                  >
                    {tickVal}
                  </text>
                  <line
                    x1={paddingLeft}
                    y1={yPos}
                    x2={width - paddingRight}
                    y2={yPos}
                    stroke={isBottom ? '#cbd5e1' : '#e2e8f0'}
                    strokeWidth={isBottom ? '1.5' : '1'}
                    strokeDasharray={isBottom ? undefined : '3 3'}
                  />
                </g>
              );
            })}

            {/* Y Axis line */}
            <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height - paddingBottom} stroke="#cbd5e1" strokeWidth="1.5" />

            {/* Interpolated Gap Dashed Bridge Path */}
            {missingDays.length > 0 && dashedPathD && (
              <path
                d={dashedPathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth={isEnlarged ? '2.5' : '2'}
                strokeDasharray="4 4"
                opacity="0.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Solid Recorded Line Path */}
            {solidPathD && (
              <path
                d={solidPathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth={isEnlarged ? '3.5' : '3'}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Data & Missing Points */}
            {interpolatedSeries.map((item: any, idx: number) => {
              const x = getX(idx);
              const y = getY(item.val);
              const isMissing = item.isInterpolated;

              if (isMissing) {
                const labelText = `${item.date}: No entry logged`;
                const tooltipWidth = labelText.length * 5.6 + 14;
                const tooltipX = Math.min(Math.max(x - tooltipWidth / 2, paddingLeft), width - paddingRight - tooltipWidth);

                return (
                  <g key={`missing-${idx}`} className="group cursor-pointer">
                    {/* Soft vertical guide line on hover */}
                    <line
                      x1={x} y1={paddingTop} x2={x} y2={height - paddingBottom}
                      stroke="#94a3b8" strokeWidth="1" strokeDasharray="2 2"
                      className="opacity-0 group-hover:opacity-40 transition-opacity"
                    />
                    {/* Sleek hollow ring for missing day */}
                    <circle
                      cx={x} cy={y} r={isEnlarged ? '4' : '3'}
                      fill="#ffffff"
                      stroke="#94a3b8"
                      strokeWidth="1.5"
                      className="transition-all group-hover:r-6 group-hover:stroke-amber-500 group-hover:stroke-2"
                    />
                    {/* SVG Hover Tooltip Badge */}
                    <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      <rect
                        x={tooltipX}
                        y={Math.max(y - 28, 2)}
                        width={tooltipWidth}
                        height="20"
                        rx="4"
                        fill="#334155"
                        opacity="0.95"
                      />
                      <text
                        x={tooltipX + tooltipWidth / 2}
                        y={Math.max(y - 14, 15)}
                        textAnchor="middle"
                        fill="#f8fafc"
                        fontSize="9.5"
                        fontWeight="600"
                      >
                        {labelText}
                      </text>
                    </g>
                    <title>{labelText}</title>
                  </g>
                );
              }

              const labelText = `${item.date}: ${item.val} ${unit}`;
              const tooltipWidth = labelText.length * 5.8 + 12;
              const tooltipX = Math.min(Math.max(x - tooltipWidth / 2, paddingLeft), width - paddingRight - tooltipWidth);

              return (
                <g key={`data-${idx}`} className="group cursor-pointer">
                  {/* Hover vertical guide line */}
                  <line
                    x1={x} y1={paddingTop} x2={x} y2={height - paddingBottom}
                    stroke={strokeColor} strokeWidth="1" strokeDasharray="2 2"
                    className="opacity-0 group-hover:opacity-60 transition-opacity"
                  />
                  {/* Point Circle */}
                  <circle
                    cx={x} cy={y} r={isEnlarged ? '5' : '4'}
                    fill={strokeColor}
                    className="transition-all group-hover:r-7 group-hover:stroke-white group-hover:stroke-2"
                  />
                  {/* SVG Hover Tooltip Badge */}
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
            {/* X-axis tick marks & date labels placed at exact getX(idx) coordinates */}
            {(() => {
              const numXTicks = isEnlarged ? Math.min(series.length, 7) : 3;
              const tickIndices: number[] = [];
              if (series.length <= numXTicks) {
                for (let i = 0; i < series.length; i++) tickIndices.push(i);
              } else {
                for (let i = 0; i < numXTicks; i++) {
                  const idx = Math.round((i / (numXTicks - 1)) * (series.length - 1));
                  if (!tickIndices.includes(idx)) tickIndices.push(idx);
                }
              }

              return tickIndices.map((idx, i) => {
                const x = getX(idx);
                const dateStr = series[idx]?.date || '';
                let textAnchor: 'start' | 'middle' | 'end' = 'middle';
                if (i === 0) textAnchor = 'start';
                else if (i === tickIndices.length - 1) textAnchor = 'end';

                return (
                  <g key={`x-tick-${idx}`}>
                    <line
                      x1={x}
                      y1={height - paddingBottom}
                      x2={x}
                      y2={height - paddingBottom + 5}
                      stroke="#94a3b8"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={height - paddingBottom + (isEnlarged ? 18 : 14)}
                      textAnchor={textAnchor}
                      className={`${isEnlarged ? 'text-[11px]' : 'text-[9.5px]'} font-bold fill-slate-500`}
                    >
                      {dateStr}
                    </text>
                  </g>
                );
              });
            })()}
          </svg>
        </div>

        {/* Sleek Legend & Gap Summary Footer */}
        <div className="flex items-center justify-between text-[10px] text-slate-500 bg-slate-50/80 border border-slate-200/70 rounded-lg px-3 py-1.5 mt-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: strokeColor }} />
              <span className="font-semibold text-slate-600 text-[9.5px]">Recorded</span>
            </div>
            {missingDays.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-3 border-b border-dashed border-slate-400 opacity-60" />
                <span className="font-medium text-slate-500 text-[9.5px]">Gap Bridge</span>
              </div>
            )}
          </div>

          {missingDays.length > 0 ? (
            <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50/90 border border-amber-200/80 px-2 py-0.5 rounded-full font-semibold text-[9px]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {missingDays.length} unlogged day{missingDays.length > 1 ? 's' : ''}
            </div>
          ) : (
            <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200/70 px-2 py-0.5 rounded-full">
              Complete Data
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Active Users */}
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

        {/* Card 2: Pending User Approvals */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow duration-200 flex items-center gap-4">
          <div className="p-3.5 bg-amber-50 rounded-lg text-amber-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending User Approvals</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{summary?.pending_approvals}</p>
          </div>
        </div>

        {/* Card 3: Active Projects */}
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
                <optgroup label="Tank Groups">
                  {tankGroups.map((g: any) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </optgroup>
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
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm overflow-visible">
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
            <h2 className="text-base font-bold text-slate-800">Active Tank Distribution</h2>
            <span className="text-[11px] font-medium text-slate-400">Hover or tap card for details</span>
          </div>
          {/* Transparent Backdrop Overlay for Mobile Touch Close */}
          {tappedCard && (
            <div 
              className="fixed inset-0 z-20 bg-black/10" 
              onClick={(e) => {
                e.stopPropagation();
                setTappedCard(null);
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
                setTappedCard(null);
              }}
            />
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2 relative">
            {/* Card 1: Healthy / Assigned */}
            <div 
              onClick={() => setTappedCard(tappedCard === 'healthy' ? null : 'healthy')}
              className="group relative flex flex-col items-center justify-center p-4 bg-emerald-50 rounded-xl w-full sm:flex-1 border border-emerald-100 cursor-pointer transition-all hover:shadow-md hover:bg-emerald-100/60"
            >
              <span className="text-sm font-semibold text-emerald-800 text-center">Active</span>
              <span className="text-3xl font-extrabold text-emerald-600 mt-2">{summary?.tank_status?.healthy || 0}</span>
              
              {/* Tooltip / Popover */}
              <div 
                onClick={(e) => e.stopPropagation()}
                className={`absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-30 w-56 p-3 bg-slate-900/95 text-white text-xs rounded-xl shadow-xl border border-slate-700 backdrop-blur-sm transition-all duration-200 ${
                tappedCard === 'healthy' ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto pointer-events-none'
              }`}>
                <div className="font-semibold text-emerald-400 mb-1 border-b border-slate-700/60 pb-1 flex items-center justify-between">
                  <span>Active Tanks</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setTappedCard(null);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-colors ml-2"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-slate-200 leading-snug">
                  {summary?.tank_status?.healthy || summary?.tank_status?.total_active || 0} tanks currently active in facility.
                </p>
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900/95" />
              </div>
            </div>

            {/* Card 2: Quarantine */}
            <div 
              onClick={() => setTappedCard(tappedCard === 'quarantine' ? null : 'quarantine')}
              className="group relative flex flex-col items-center justify-center p-4 bg-amber-50 rounded-xl w-full sm:flex-1 border border-amber-100 cursor-pointer transition-all hover:shadow-md hover:bg-amber-100/60"
            >
              <span className="text-sm font-semibold text-amber-800 text-center">Quarantine</span>
              <span className="text-3xl font-extrabold text-amber-600 mt-2">{summary?.tank_status?.quarantine || 0}</span>
              
              {/* Tooltip / Popover */}
              <div 
                onClick={(e) => e.stopPropagation()}
                className={`absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-30 w-60 p-3 bg-slate-900/95 text-white text-xs rounded-xl shadow-xl border border-slate-700 backdrop-blur-sm transition-all duration-200 ${
                tappedCard === 'quarantine' ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto pointer-events-none'
              }`}>
                <div className="font-semibold text-amber-400 mb-1 border-b border-slate-700/60 pb-1 flex items-center justify-between">
                  <span>Quarantine Status</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setTappedCard(null);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-colors ml-2"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-slate-200 leading-snug">
                  {summary?.tank_status?.quarantine_tanks?.length
                    ? `${summary.tank_status.quarantine_tanks.join(', ')} are in quarantine.`
                    : 'No tanks currently in quarantine.'}
                </p>
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900/95" />
              </div>
            </div>

            {/* Card 3: Needs Attention */}
            <div 
              onClick={() => setTappedCard(tappedCard === 'attention' ? null : 'attention')}
              className="group relative flex flex-col items-center justify-center p-4 bg-red-50 rounded-xl w-full sm:flex-1 border border-red-100 cursor-pointer transition-all hover:shadow-md hover:bg-red-100/60"
            >
              <span className="text-sm font-semibold text-red-800 text-center">Needs Attention</span>
              <span className="text-3xl font-extrabold text-red-600 mt-2">{summary?.tank_status?.attention || 0}</span>
              
              {/* Tooltip / Popover */}
              <div 
                onClick={(e) => e.stopPropagation()}
                className={`absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-30 w-64 p-3 bg-slate-900/95 text-white text-xs rounded-xl shadow-xl border border-slate-700 backdrop-blur-sm transition-all duration-200 ${
                tappedCard === 'attention' ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto pointer-events-none'
              }`}>
                <div className="font-semibold text-red-400 mb-1 border-b border-slate-700/60 pb-1 flex items-center justify-between">
                  <span>Needs Attention (24h)</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setTappedCard(null);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-colors ml-2"
                  >
                    ✕
                  </button>
                </div>
                {summary?.tank_status?.attention_details?.length ? (
                  <ul className="space-y-1.5 text-slate-200 max-h-36 overflow-y-auto pr-1">
                    {summary.tank_status.attention_details.map((item: any, idx: number) => (
                      <li key={idx} className="flex justify-between items-center bg-slate-800/90 px-2 py-1 rounded border border-slate-700/60">
                        <span className="font-medium text-slate-100">{item.tank}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-950/90 text-red-300 font-semibold border border-red-800/60">{item.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-300 italic">No tanks requiring attention in the last 24h.</p>
                )}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900/95" />
              </div>
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

      {/* Enlarged Telemetry Graph Modal Overlay */}
      {enlargedChart && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-md animate-fade-in"
          onClick={() => setEnlargedChart(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-5 sm:p-6 w-full max-w-5xl space-y-4 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <span
                  className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor:
                      enlargedChart === 'ph'
                        ? '#dc2626'
                        : enlargedChart === 'temperature'
                        ? '#d97706'
                        : '#059669',
                  }}
                />
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900">
                    {enlargedChart === 'ph'
                      ? 'pH Level Telemetry Trend'
                      : enlargedChart === 'temperature'
                      ? 'Water Temperature Telemetry Trend'
                      : 'Dissolved Oxygen Telemetry Trend'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Detailed view with expanded Y-axis gridlines & X-axis date ticks
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEnlargedChart(null)}
                className="p-1.5 sm:p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors border border-slate-200 flex-shrink-0"
                title="Close enlarged graph (Esc or click outside)"
                aria-label="Close enlarged graph"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="pt-2">
              {enlargedChart === 'ph' &&
                renderLineChart('ph', 'pH Level', 'pH', '#dc2626', '#fee2e2', 6.0, 9.5, true)}
              {enlargedChart === 'temperature' &&
                renderLineChart('temperature', 'Water Temperature', '°C', '#d97706', '#fef3c7', 18.0, 32.0, true)}
              {enlargedChart === 'dissolved_oxygen' &&
                renderLineChart('dissolved_oxygen', 'Dissolved Oxygen', 'mg/L', '#059669', '#d1fae5', 0.0, 15.0, true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
