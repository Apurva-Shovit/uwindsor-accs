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



  const [showOfficialModal, setShowOfficialModal] = React.useState(false);
  const [selectedForm, setSelectedForm] = React.useState<'appendix6' | 'appendix7' | 'incidents'>('appendix6');
  const [selectedProjectId, setSelectedProjectId] = React.useState('');

  // Projects list for official report
  const { data: projectsList } = useQuery({
    queryKey: ['projectsListForReports'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:8000/projects', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return [];
      return res.json();
    }
  });

  React.useEffect(() => {
    if (projectsList && projectsList.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projectsList[0].id || projectsList[0]._id);
    }
  }, [projectsList, selectedProjectId]);

  // Official Report Data query (defaults to 30d if dateFrom/dateTo empty)
  const timePeriodParam = (!dateFrom && !dateTo) ? '30d' : 'all';
  const { data: sopReportData } = useQuery({
    queryKey: ['sopReportData', selectedProjectId, timePeriodParam, dateFrom, dateTo],
    queryFn: async () => {
      if (!selectedProjectId) return null;
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      params.append('time_period', timePeriodParam);
      if (dateFrom) params.append('start_date', dateFrom);
      if (dateTo) params.append('end_date', dateTo);
      params.append('page', '1');
      params.append('limit', '100');

      const res = await fetch(`http://localhost:8000/projects/${selectedProjectId}/report?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedProjectId && showOfficialModal
  });

  const sopProject = sopReportData?.project;
  const sopTanks = sopReportData?.occupied_tanks || [];
  const sopWq = sopReportData?.water_quality_logs || [];
  const sopIncidents = sopReportData?.incidents || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4 print:pb-2">
        <div>
          <h1 className="text-2xl font-bold text-[#005596]">Facility & Audit Reports</h1>
          <p className="text-sm text-slate-500 mt-1">Comprehensive population reconciliation, active protocols, and inspector-facing logs.</p>
        </div>
        <button
          onClick={() => setShowOfficialModal(true)}
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

      {/* Official Computerized SOP Forms Modal / Print Overlay */}
      {showOfficialModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static print:block">
          <div className="bg-white rounded-2xl max-w-5xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto print:max-h-none print:shadow-none print:p-0 print:w-full print:rounded-none">
            {/* Modal Header & Controls (Hidden during print) */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-4 print:hidden">
              <div>
                <h2 className="text-xl font-extrabold text-[#005596] flex items-center gap-2">
                  Official ACC Compliance Form Generator
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  University of Windsor Animal Care Committee Official Form • {(!dateFrom && !dateTo) ? 'Auto-Filtered: Past 1 Month (Default)' : `Range: ${dateFrom || 'Start'} to ${dateTo || 'Today'}`}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-[#005596] text-white font-extrabold text-xs rounded-xl shadow hover:bg-blue-800 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print Form
                </button>
                <button
                  onClick={() => setShowOfficialModal(false)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Template & Project Selection (Hidden during print) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-semibold print:hidden bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Select SOP Form Template</label>
                <select
                  value={selectedForm}
                  onChange={(e) => setSelectedForm(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-300 bg-white p-2 text-xs font-bold text-slate-800 shadow-sm focus:ring-2 focus:ring-[#005596]"
                >
                  <option value="appendix6">Appendix 6: Daily Water Quality Log Sheet</option>
                  <option value="appendix7">Appendix 7: Water Quality Test Strip Log Sheet</option>
                  <option value="incidents">Aquatic Incident Report Form</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Select Research Project (AUPP)</label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white p-2 text-xs font-bold text-slate-800 shadow-sm focus:ring-2 focus:ring-[#005596]"
                >
                  {projectsList?.map((p: any) => (
                    <option key={p.id || p._id} value={p.id || p._id}>
                      {p.title} (AUPP: {p.aupp_number})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Rendered Form Document */}
            {sopProject && (
              <div className="bg-white border-2 border-slate-900 p-6 shadow-sm text-slate-900 font-sans print:border-slate-900 print:p-2">
                {/* Form Header */}
                <div className="border-b-2 border-slate-900 pb-3 mb-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <img src="/uwin-logo.webp" alt="University of Windsor Logo" className="h-14 w-auto object-contain" />
                    <div>
                      <div className="text-xs font-bold tracking-widest uppercase text-slate-700">University of Windsor</div>
                      <h2 className="text-base font-black uppercase text-slate-900 leading-tight">
                        {selectedForm === 'appendix6' && 'APPENDIX 6 Daily Water Quality Log'}
                        {selectedForm === 'appendix7' && 'APPENDIX 7 Water Quality Aquarium Test Strips'}
                        {selectedForm === 'incidents' && 'AQUATIC INCIDENT REPORTS'}
                      </h2>
                      <div className="text-[10px] font-semibold text-slate-600">
                        {selectedForm === 'appendix6' && 'ACC SOP AH24 Daily Water Quality Log - Appendix 6 (June 2026)'}
                        {selectedForm === 'appendix7' && 'Fresh Water - Static and Recirculated Tanks - Appendix 7 (Revised May 2024)'}
                        {selectedForm === 'incidents' && 'Official Aquatic Health & Incident Monitoring Log'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs border-l border-slate-400 pl-4 space-y-1">
                    <div><strong>AUPP#:</strong> <span className="underline font-mono">{sopProject.aupp_number}</span></div>
                    <div><strong>PI:</strong> {sopProject.pi_name}</div>
                  </div>
                </div>

                {/* Form Metadata */}
                <div className="grid grid-cols-4 gap-2 border border-slate-900 p-3 text-xs mb-4 bg-slate-50 font-medium">
                  <div><strong>Room:</strong> RM {sopProject.room_number || '101'}</div>
                  <div><strong>Species:</strong> {sopProject.species || 'Zebrafish'}</div>
                  <div><strong>Date Range:</strong> {(!dateFrom && !dateTo) ? 'Past 1 Month (Auto)' : `${dateFrom || 'Start'} to ${dateTo || 'Today'}`}</div>
                  <div><strong>Status:</strong> <span className="uppercase font-bold">{sopProject.status}</span></div>
                </div>

                {/* Form 1: Appendix 6 */}
                {selectedForm === 'appendix6' && (() => {
                  const displayTanks = Array.from({ length: 14 }, (_, i) => String(i + 1));
                  const daysOfWeek = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat', 'Sun'];

                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse border border-slate-900 text-[11px] text-center">
                        <thead>
                          <tr className="bg-slate-200 border-b border-slate-900 font-bold uppercase">
                            <th className="border border-slate-900 p-1.5 w-16">Tank #</th>
                            <th className="border border-slate-900 p-1" colSpan={3}>Mon</th>
                            <th className="border border-slate-900 p-1" colSpan={3}>Tues</th>
                            <th className="border border-slate-900 p-1" colSpan={3}>Wed</th>
                            <th className="border border-slate-900 p-1" colSpan={3}>Thurs</th>
                            <th className="border border-slate-900 p-1" colSpan={3}>Fri</th>
                            <th className="border border-slate-900 p-1" colSpan={3}>Sat</th>
                            <th className="border border-slate-900 p-1" colSpan={3}>Sun</th>
                            <th className="border border-slate-900 p-1.5 w-24">Comments / Initials</th>
                          </tr>
                          <tr className="bg-slate-100 border-b border-slate-900 font-semibold text-[9px]">
                            <th className="border border-slate-900 p-1"></th>
                            {daysOfWeek.map(d => (
                              <React.Fragment key={d}>
                                <th className="border border-slate-900 p-0.5">pH</th>
                                <th className="border border-slate-900 p-0.5">Temp</th>
                                <th className="border border-slate-900 p-0.5">DO</th>
                              </React.Fragment>
                            ))}
                            <th className="border border-slate-900 p-1"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayTanks.map((tankNum: string) => {
                            const tankLogs = sopWq.filter((w: any) => String(w.tank_number) === tankNum);
                            const tankComment = tankLogs.find((w: any) => w.notes && w.notes !== '-')?.notes || '';
                            const tankLogger = tankLogs[0]?.logged_by_name?.slice(0, 3).toUpperCase() || '';

                            return (
                              <tr key={tankNum} className="border-b border-slate-400">
                                <td className="border border-slate-900 p-1 font-bold bg-slate-50">{tankNum}</td>
                                {daysOfWeek.map(day => {
                                  const dayLog = tankLogs.find((w: any) => w.day_of_week === day);
                                  return (
                                    <React.Fragment key={day}>
                                      <td className="border border-slate-400 p-1">{dayLog ? (dayLog.pH ?? '-') : ''}</td>
                                      <td className="border border-slate-400 p-1">{dayLog ? (dayLog.temperature_celsius ? `${dayLog.temperature_celsius}°` : '-') : ''}</td>
                                      <td className="border border-slate-400 p-1">{dayLog ? '-' : ''}</td>
                                    </React.Fragment>
                                  );
                                })}
                                <td className="border border-slate-900 p-1 text-[9px] text-slate-600 font-mono">
                                  {tankLogger ? `${tankComment || 'Logged'} / ${tankLogger}` : ''}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* Form 2: Appendix 7 */}
                {selectedForm === 'appendix7' && (
                  <div className="overflow-x-auto space-y-3">
                    <div className="bg-blue-50 border border-blue-200 rounded p-2 text-[10px] text-blue-900 font-medium">
                      <strong>Required Test Schedules:</strong> Recirculated Tanks: <strong>Daily</strong> - Temp, O2, pH | <strong>Biweekly</strong> - Ammonia, Nitrite/Nitrates, Total Hardness | <strong>Weekly</strong> - Nitrogen, Salinity | <strong>Annually</strong> - Chlorine.
                    </div>
                    <table className="w-full border-collapse border border-slate-900 text-center text-xs">
                      <thead>
                        <tr className="bg-slate-200 border-b border-slate-900 font-bold uppercase text-[10px]">
                          <th className="border border-slate-900 p-2">Date</th>
                          <th className="border border-slate-900 p-2">Tank ID</th>
                          <th className="border border-slate-900 p-2">Nitrate<br/><span className="text-[8px] font-normal">0–40 ppm</span></th>
                          <th className="border border-slate-900 p-2">Nitrite<br/><span className="text-[8px] font-normal">0 ppm</span></th>
                          <th className="border border-slate-900 p-2">Total Hardness<br/><span className="text-[8px] font-normal">20–450 ppm</span></th>
                          <th className="border border-slate-900 p-2">Total Chlorine<br/><span className="text-[8px] font-normal">0 ppm</span></th>
                          <th className="border border-slate-900 p-2">Total Alkalinity<br/><span className="text-[8px] font-normal">120–180 ppm</span></th>
                          <th className="border border-slate-900 p-2">pH<br/><span className="text-[8px] font-normal">6.5–9.0</span></th>
                          <th className="border border-slate-900 p-2">Ammonia<br/><span className="text-[8px] font-normal">0–0.5 ppm</span></th>
                          <th className="border border-slate-900 p-2">Comments / Initials</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sopWq.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-4 text-slate-500 italic text-center border border-slate-900">
                              No test strip records recorded for this period.
                            </td>
                          </tr>
                        ) : (
                          sopWq.map((wq: any, idx: number) => {
                            const params = wq.parameters || {};
                            return (
                              <tr key={idx} className="border-b border-slate-400">
                                <td className="border border-slate-900 p-2 font-semibold">{wq.date?.slice(0, 12)}</td>
                                <td className="border border-slate-900 p-2 font-bold text-[#005596]">Tank {wq.tank_number}</td>
                                <td className="border border-slate-400 p-2">{params.nitrate ? `${params.nitrate} ppm` : ''}</td>
                                <td className="border border-slate-400 p-2">{params.nitrite ? `${params.nitrite} ppm` : ''}</td>
                                <td className="border border-slate-400 p-2">{params.hardness ? `${params.hardness} ppm` : ''}</td>
                                <td className="border border-slate-400 p-2">{params.chlorine ? `${params.chlorine} ppm` : ''}</td>
                                <td className="border border-slate-400 p-2">{params.alkalinity ? `${params.alkalinity} ppm` : ''}</td>
                                <td className="border border-slate-400 p-2 font-bold text-emerald-700">{wq.pH ? String(wq.pH) : ''}</td>
                                <td className="border border-slate-400 p-2">{params.ammonia ? `${params.ammonia} ppm` : ''}</td>
                                <td className="border border-slate-900 p-2 text-[10px] text-slate-600">
                                  {wq.notes && wq.notes !== '-' ? wq.notes : 'Logged'} / {wq.logged_by_name?.slice(0, 3).toUpperCase()}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Form 3: Aquatic Incident Report Form */}
                {selectedForm === 'incidents' && (
                  <div className="overflow-x-auto space-y-4">
                    <table className="w-full border-collapse border border-slate-900 text-left text-xs">
                      <thead>
                        <tr className="bg-slate-200 border-b border-slate-900 font-bold uppercase text-[10px] text-center">
                          <th className="border border-slate-900 p-2">Date & Time</th>
                          <th className="border border-slate-900 p-2">Tank #</th>
                          <th className="border border-slate-900 p-2">Problem Description</th>
                          <th className="border border-slate-900 p-2">Treatment / Solution</th>
                          <th className="border border-slate-900 p-2">Aquatic Checked</th>
                          <th className="border border-slate-900 p-2">Vet Contacted</th>
                          <th className="border border-slate-900 p-2">Researcher Notified</th>
                          <th className="border border-slate-900 p-2">Reporter</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sopIncidents.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="p-4 text-slate-500 italic text-center border border-slate-900">
                              No aquatic incidents reported for this period.
                            </td>
                          </tr>
                        ) : (
                          sopIncidents.map((inc: any) => (
                            <tr key={inc.id} className="border-b border-slate-400">
                              <td className="border border-slate-900 p-2 font-semibold whitespace-nowrap">{inc.date}</td>
                              <td className="border border-slate-900 p-2 font-bold text-[#005596] text-center">{inc.tank_number}</td>
                              <td className="border border-slate-900 p-2">{inc.description}</td>
                              <td className="border border-slate-900 p-2">{inc.notes}</td>
                              <td className="border border-slate-900 p-2 text-center font-bold">Yes</td>
                              <td className="border border-slate-900 p-2 text-center font-bold">
                                <span className={inc.vet_contacted === 'Yes' ? 'text-red-600' : ''}>{inc.vet_contacted}</span>
                              </td>
                              <td className="border border-slate-900 p-2 text-center font-bold">Yes</td>
                              <td className="border border-slate-900 p-2 font-semibold text-slate-700">{inc.reported_by_name}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>

                    <div className="mt-6 pt-4 border-t border-slate-900 grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <strong>Facility Manager Signature:</strong> ___________________________
                      </div>
                      <div>
                        <strong>Principal Investigator Signature:</strong> ___________________________
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
