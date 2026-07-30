import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '../../utils/formatters';
import { getExecutiveSummary, getReportsSummary, getProjects, getProjectReport } from '../../lib/api';
import { Paginator } from '../../components/ui/Paginator';

export const Reports: React.FC = () => {
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [granularity, _setGranularity] = React.useState('monthly');
  const [eventFilter, setEventFilter] = React.useState('');
  const [auppFilter, setAuppFilter] = React.useState('');
  const [page, setPage] = React.useState(1);

  // Executive summary query
  const { data: execSummary } = useQuery({
    queryKey: ['execFacilitySummary', dateFrom, dateTo, granularity],
    queryFn: async () => {
      const params: Record<string, any> = { granularity };
      if (dateFrom) params.date_from = new Date(dateFrom + 'T00:00:00').toISOString();
      if (dateTo) params.date_to = new Date(dateTo + 'T23:59:59').toISOString();

      const res = await getExecutiveSummary(params);
      return res.data;
    }
  });

  const { data: reportsResponse, isLoading } = useQuery({
    queryKey: ['reportsSummary', dateFrom, dateTo, page],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit: 20 };
      if (dateFrom) params.date_from = new Date(dateFrom + 'T00:00:00').toISOString();
      if (dateTo) params.date_to = new Date(dateTo + 'T23:59:59').toISOString();

      const res = await getReportsSummary(params);
      return res.data;
    }
  });

  const data = Array.isArray(reportsResponse) ? reportsResponse : (reportsResponse?.items || []);
  const totalReports = Array.isArray(reportsResponse) ? data.length : (reportsResponse?.total || 0);
  const totalPages = Array.isArray(reportsResponse) ? 1 : (reportsResponse?.total_pages || 1);

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
  const { data: projectsResponse } = useQuery({
    queryKey: ['projectsListForReports'],
    queryFn: async () => {
      const res = await getProjects();
      return res.data;
    }
  });

  const projectsList = Array.isArray(projectsResponse) ? projectsResponse : (projectsResponse?.items || []);

  React.useEffect(() => {
    if (projectsList && projectsList.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projectsList[0].id || projectsList[0]._id);
    }
  }, [projectsList, selectedProjectId]);

  // Official Report Data query (fetches all available project logs for generator)
  const timePeriodParam = 'all';
  const { data: sopReportData } = useQuery({
    queryKey: ['sopReportData', selectedProjectId, timePeriodParam, dateFrom, dateTo],
    queryFn: async () => {
      if (!selectedProjectId) return null;
      const res = await getProjectReport(
        selectedProjectId,
        timePeriodParam,
        1,
        1000,
        dateFrom || undefined,
        dateTo || undefined
      );
      return res.data;
    },
    enabled: !!selectedProjectId && showOfficialModal
  });

  const sopProject = sopReportData?.project;
  const sopWq = sopReportData?.water_quality_logs || [];
  const sopIncidents = sopReportData?.incidents || [];

  const handlePrint = () => {
    const printElement = document.getElementById('official-sop-print-area');
    if (!printElement) return;

    // 1. Clone the real rendered DOM node (deep clone keeps all inline styles/computed classes)
    const cloned = printElement.cloneNode(true) as HTMLElement;
    cloned.id = 'sop-print-portal';
    cloned.style.display = 'block';
    cloned.style.position = 'fixed';
    cloned.style.top = '0';
    cloned.style.left = '0';
    cloned.style.width = '100%';
    cloned.style.zIndex = '999999';
    cloned.style.background = 'white';

    // 2. Inject a print-only style tag that hides all body children except our portal
    const style = document.createElement('style');
    style.id = 'sop-print-override';
    style.textContent = `
      @media print {
        @page { size: landscape; margin: 8mm; }
        body > *:not(#sop-print-portal) { display: none !important; visibility: hidden !important; }
        #sop-print-portal {
          display: block !important;
          visibility: visible !important;
          position: static !important;
          width: 100% !important;
          z-index: 0 !important;
        }
        #sop-print-portal * { visibility: visible !important; }
        .page-break {
          break-after: page !important;
          page-break-after: always !important;
          margin-bottom: 0 !important;
        }
        img { max-height: 50px !important; width: auto !important; }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(cloned);

    // 3. Give browser one frame to paint before printing
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        // 4. Cleanup after print dialog closes
        setTimeout(() => {
          const portal = document.getElementById('sop-print-portal');
          const override = document.getElementById('sop-print-override');
          if (portal) document.body.removeChild(portal);
          if (override) document.head.removeChild(override);
        }, 500);
      });
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4 print:pb-2">
        <div>
          <h1 className="text-2xl font-bold text-[#005596]">Facility &amp; Audit Reports</h1>
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
              <option value="Quarantine">Quarantine</option>
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
                    <td className="p-4 whitespace-nowrap">                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        row.event_type === 'Incident' ? 'bg-red-50 text-red-700 border border-red-100' :
                        row.event_type === 'Water Quality' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                        row.event_type === 'Quarantine' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
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
                      row.event_type === 'Quarantine' ? 'bg-amber-50 text-amber-800 border-amber-200' :
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
              <Paginator
                page={page}
                totalPages={totalPages}
                total={totalReports}
                limit={20}
                onPageChange={(p) => setPage(p)}
              />
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
                  onClick={handlePrint}
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

            {/* Rendered Form Document (Isolated for Print) */}
            {sopProject && (
              <div id="official-sop-print-area" className="bg-white text-slate-900 font-sans">
                <style>{`
                  @media print {
                    body * {
                      visibility: hidden !important;
                    }
                    #official-sop-print-area, #official-sop-print-area * {
                      visibility: visible !important;
                    }
                    #official-sop-print-area {
                      position: absolute !important;
                      left: 0 !important;
                      top: 0 !important;
                      width: 100% !important;
                      margin: 0 !important;
                      padding: 0 !important;
                      background: white !important;
                    }
                    .print\\:break-after-page {
                      break-after: page !important;
                      page-break-after: always !important;
                    }
                  }
                `}</style>

                {/* Form 1: Appendix 6 (Weekly Multi-Page Generator) */}
                {selectedForm === 'appendix6' && (() => {
                  const cleanTankNum = (val: any) => String(val || '').replace(/tank\s*/i, '').trim();
                  const displayTanks = Array.from({ length: 14 }, (_, i) => String(i + 1));

                  // Calculate calendar weeks (Monday - Sunday) spanned by the selected range
                  const getMonday = (d: Date) => {
                    const date = new Date(d);
                    const day = date.getDay();
                    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
                    return new Date(date.setDate(diff));
                  };

                  let startDateObj: Date;
                  let endDateObj: Date;

                  if (dateFrom || dateTo) {
                    startDateObj = dateFrom ? new Date(dateFrom + 'T00:00:00') : new Date(Date.now() - 35 * 86400 * 1000);
                    endDateObj = dateTo ? new Date(dateTo + 'T23:59:59') : new Date();
                  } else {
                    // Default mode: Current week + past 4 weeks (Includes June 29)
                    const currentMonday = getMonday(new Date());
                    const fourWeeksAgoMonday = new Date(currentMonday);
                    fourWeeksAgoMonday.setDate(fourWeeksAgoMonday.getDate() - 28);
                    fourWeeksAgoMonday.setHours(0, 0, 0, 0);

                    const currentSunday = new Date(currentMonday);
                    currentSunday.setDate(currentSunday.getDate() + 6);
                    currentSunday.setHours(23, 59, 59, 999);

                    startDateObj = fourWeeksAgoMonday;
                    endDateObj = currentSunday;
                  }

                  const weekPages = [];
                  let currMon = getMonday(startDateObj);

                  while (currMon <= endDateObj) {
                    const currSun = new Date(currMon);
                    currSun.setDate(currSun.getDate() + 6);
                    currSun.setHours(23, 59, 59, 999);

                    weekPages.push({
                      monDate: new Date(currMon),
                      sunDate: new Date(currSun)
                    });

                    currMon = new Date(currMon);
                    currMon.setDate(currMon.getDate() + 7);
                  }

                  const daysOfWeekConfig = [
                    { offset: 0, key: 'Mon', label: 'Mon' },
                    { offset: 1, key: 'Tues', label: 'Tues' },
                    { offset: 2, key: 'Wed', label: 'Wed' },
                    { offset: 3, key: 'Thurs', label: 'Thurs' },
                    { offset: 4, key: 'Fri', label: 'Fri' },
                    { offset: 5, key: 'Sat', label: 'Sat' },
                    { offset: 6, key: 'Sun', label: 'Sun' }
                  ];

                  return (
                    <div className="space-y-8 print:space-y-0">
                      {weekPages.map((wp, pageIdx) => {
                        const weekMonStr = wp.monDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

                        return (
                          <div
                            key={pageIdx}
                            className="bg-white border-2 border-slate-900 p-6 shadow-sm text-slate-900 font-sans print:border-slate-900 print:p-2 print:break-after-page page-break mb-6"
                          >
                            {/* Form Header */}
                            <div className="border-b-2 border-slate-900 pb-3 mb-3 flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <img src="/uwin-logo.webp" alt="University of Windsor Logo" className="h-12 w-auto object-contain" />
                                <div>
                                  <div className="text-[10px] font-bold tracking-widest uppercase text-slate-700">University of Windsor</div>
                                  <h2 className="text-sm font-black uppercase text-slate-900 leading-tight">
                                    APPENDIX 6 Daily Water Quality Log
                                  </h2>
                                  <div className="text-[9px] font-semibold text-slate-600">
                                    ACC SOP AH24 Daily Water Quality Log - Appendix 6 (June 2026)
                                  </div>
                                </div>
                              </div>
                              <div className="text-right text-[11px] border-l border-slate-400 pl-3 space-y-0.5">
                                <div><strong>AUPP#:</strong> <span className="underline font-mono">{sopProject.aupp_number}</span></div>
                                <div><strong>PI:</strong> {sopProject.pi_name}</div>
                              </div>
                            </div>

                            {/* Form Metadata Line */}
                            <div className="grid grid-cols-4 gap-2 border border-slate-900 p-2 text-[11px] mb-3 bg-slate-50 font-medium">
                              <div><strong>Room:</strong> RM {sopProject.room_number || '101'}</div>
                              <div><strong>Species:</strong> {sopProject.species || 'Zebrafish'}</div>
                              <div><strong>Week of (D/M/Y):</strong> <span className="font-bold underline">{weekMonStr}</span></div>
                              <div><strong>Page:</strong> <span className="font-bold">{pageIdx + 1} of {weekPages.length}</span></div>
                            </div>

                            {/* Weekly Form Table */}
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse border-2 border-slate-900 text-[10px] text-center">
                                <thead>
                                  <tr className="bg-[#005596] text-white border-b-2 border-slate-900 font-bold uppercase">
                                    <th className="border border-slate-900 p-1.5 w-12 text-center" colSpan={2}>Day</th>
                                    {displayTanks.map((tn) => (
                                      <th key={tn} className="border border-slate-900 p-1 w-8 text-center">{tn}</th>
                                    ))}
                                    <th className="border border-slate-900 p-1.5 w-24 text-center">Initials</th>
                                    <th className="border border-slate-900 p-1.5 w-28 text-center">Comments</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {daysOfWeekConfig.map(({ offset, key: dayKey, label: dayLabel }) => {
                                    const cellDate = new Date(wp.monDate);
                                    cellDate.setDate(cellDate.getDate() + offset);
                                    cellDate.setHours(12, 0, 0, 0);

                                    // Strictly check if cell date is within the requested range [startDateObj, endDateObj]
                                    const isEligible = cellDate >= startDateObj && cellDate <= endDateObj;
                                    const yyyy = cellDate.getFullYear();
                                    const mm = String(cellDate.getMonth() + 1).padStart(2, '0');
                                    const dd = String(cellDate.getDate()).padStart(2, '0');
                                    const cellIso = `${yyyy}-${mm}-${dd}`;

                                    const dayLogs = isEligible
                                      ? sopWq.filter((w: any) =>
                                          (w.iso_date === cellIso || (w.day_of_week === dayKey && (!w.iso_date || w.iso_date === cellIso))) &&
                                          (w.type === 'daily' || w.temperature_celsius != null || w.dissolved_oxygen != null)
                                        )
                                      : [];

                                    const dayInitials = isEligible ? Array.from(new Set(dayLogs.map((w: any) => w.logged_by_name))).filter(Boolean).join(', ') : '';
                                    const dayComments = isEligible ? Array.from(new Set(dayLogs.map((w: any) => w.notes))).filter((n: any) => n && n !== '-').join('; ') : '';

                                    return (
                                      <React.Fragment key={dayKey}>
                                        {/* Sub-row 1: pH */}
                                        <tr className="border-t-2 border-slate-900">
                                          <td rowSpan={3} className="border border-slate-900 font-black text-slate-900 bg-slate-100 p-1 align-middle text-xs">
                                            {dayLabel}
                                          </td>
                                          <td className="border border-slate-900 font-bold text-red-900 bg-rose-100 p-1">pH</td>
                                          {displayTanks.map((tankNum) => {
                                            const log = isEligible ? dayLogs.find((w: any) => cleanTankNum(w.tank_number) === tankNum) : null;
                                            return (
                                              <td key={`ph-${tankNum}`} className="border border-slate-400 p-1 text-slate-900 font-semibold">
                                                {log && log.pH !== null && log.pH !== undefined ? String(log.pH) : ''}
                                              </td>
                                            );
                                          })}
                                          <td rowSpan={3} className="border border-slate-900 p-1 text-[9px] font-semibold text-slate-800 align-middle">
                                            {dayInitials || ''}
                                          </td>
                                          <td rowSpan={3} className="border border-slate-900 p-1 text-[9px] text-slate-700 align-middle text-left">
                                            {dayComments || ''}
                                          </td>
                                        </tr>

                                        {/* Sub-row 2: DO */}
                                        <tr>
                                          <td className="border border-slate-900 font-bold text-emerald-900 bg-emerald-100 p-1">DO</td>
                                          {displayTanks.map((tankNum) => {
                                            const log = isEligible ? dayLogs.find((w: any) => cleanTankNum(w.tank_number) === tankNum) : null;
                                            return (
                                              <td key={`do-${tankNum}`} className="border border-slate-400 p-1 text-slate-900 font-semibold">
                                                {log && log.dissolved_oxygen !== null && log.dissolved_oxygen !== undefined ? String(log.dissolved_oxygen) : ''}
                                              </td>
                                            );
                                          })}
                                        </tr>

                                        {/* Sub-row 3: Temp */}
                                        <tr>
                                          <td className="border border-slate-900 font-bold text-amber-900 bg-amber-100 p-1">Temp</td>
                                          {displayTanks.map((tankNum) => {
                                            const log = isEligible ? dayLogs.find((w: any) => cleanTankNum(w.tank_number) === tankNum) : null;
                                            return (
                                              <td key={`temp-${tankNum}`} className="border border-slate-400 p-1 text-slate-900 font-semibold">
                                                {log && log.temperature_celsius !== null && log.temperature_celsius !== undefined ? `${log.temperature_celsius}°` : ''}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      </React.Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Form 2: Appendix 7 */}
                {selectedForm === 'appendix7' && (() => {
                  const testStripLogs = sopWq.filter((w: any) =>
                    w.type === 'test_strip' ||
                    (w.parameters && (w.parameters.nitrate != null || w.parameters.hardness != null || w.parameters.nitrite != null || w.parameters.chlorine != null || w.parameters.ammonia != null))
                  );

                  // Chunk into pages of 10 records per page
                  const pageSize = 10;
                  const pages = [];
                  if (testStripLogs.length === 0) {
                    pages.push([]);
                  } else {
                    for (let i = 0; i < testStripLogs.length; i += pageSize) {
                      pages.push(testStripLogs.slice(i, i + pageSize));
                    }
                  }

                  return (
                    <div className="space-y-8 print:space-y-0">
                      {pages.map((pageLogs, pageIdx) => {
                        const paddingCount = Math.max(0, 10 - pageLogs.length);

                        return (
                          <div
                            key={pageIdx}
                            className="bg-white border-2 border-slate-900 text-slate-900 font-sans p-6 shadow-sm print:border-slate-900 print:p-2 print:break-after-page page-break mb-6"
                          >
                            {/* Paper-exact Header: Logo centered + Title */}
                            <div className="flex flex-col items-center pt-2 pb-2 border-b-2 border-slate-900">
                              <img src="/uwin-logo.webp" alt="University of Windsor Logo" className="h-12 w-auto object-contain mb-1" />
                              <div className="text-center">
                                <div className="text-[11px] font-bold tracking-wide text-slate-800">University of Windsor</div>
                                <div className="text-sm font-black uppercase text-slate-900 leading-tight">APPENDIX 7</div>
                                <div className="text-xs font-bold uppercase text-slate-900">Water Quality AQUARIUM TEST STRIPS</div>
                                <div className="text-[11px] font-semibold text-slate-700">Fresh Water-Static &amp; Recirculated Tanks</div>
                              </div>
                            </div>

                            {/* Paper-exact Metadata Grid */}
                            <table className="w-full border-collapse border-2 border-slate-900 text-xs my-2">
                              <tbody>
                                <tr>
                                  <td className="border border-slate-900 p-1.5 font-bold w-20">Room:</td>
                                  <td className="border border-slate-900 p-1.5 w-40">{sopProject.room_number || ''}</td>
                                  <td className="border border-slate-900 p-1.5 font-bold w-20">AUPP#:</td>
                                  <td className="border border-slate-900 p-1.5 font-mono">{sopProject.aupp_number}</td>
                                </tr>
                                <tr>
                                  <td className="border border-slate-900 p-1.5 font-bold">Species:</td>
                                  <td className="border border-slate-900 p-1.5">{sopProject.species || ''}</td>
                                  <td className="border border-slate-900 p-1.5 font-bold">PI:</td>
                                  <td className="border border-slate-900 p-1.5">{sopProject.pi_name}</td>
                                </tr>
                              </tbody>
                            </table>

                            {/* Paper-exact Data Table */}
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse border-2 border-slate-900 text-center text-[10px]">
                                <thead>
                                  <tr className="bg-slate-100 border-b-2 border-slate-900 font-bold">
                                    <th className="border border-slate-900 p-1.5 text-left">Date</th>
                                    <th className="border border-slate-900 p-1.5">Tank<br/>ID</th>
                                    <th className="border border-slate-900 p-1.5">NITRATE<br/><span className="font-normal text-[9px]">0-40 ppm</span></th>
                                    <th className="border border-slate-900 p-1.5">NITRITE<br/><span className="font-normal text-[9px]">0 ppm</span></th>
                                    <th className="border border-slate-900 p-1.5">TOTAL<br/>HARDNESS<br/><span className="font-normal text-[9px]">20-450<br/>mg/L (ppm)</span></th>
                                    <th className="border border-slate-900 p-1.5">TOTAL<br/>CHLORINE<br/><span className="font-normal text-[9px]">0 ppm</span></th>
                                    <th className="border border-slate-900 p-1.5">TOTAL<br/>ALKALINITY<br/><span className="font-normal text-[9px]">120-180 ppm</span></th>
                                    <th className="border border-slate-900 p-1.5">pH<br/><span className="font-normal text-[9px]">6.5-8 cold<br/>7.5-9warm</span></th>
                                    <th className="border border-slate-900 p-1.5">AMMONIA<br/><span className="font-normal text-[9px]">0-0.5 ppm</span></th>
                                    <th className="border border-slate-900 p-1.5">COMMENTS</th>
                                    <th className="border border-slate-900 p-1.5">INITIALS</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pageLogs.map((wq: any, idx: number) => {
                                    const params = wq.parameters || {};
                                    const rawTank = String(wq.tank_number || '').replace(/^tank\s*/i, '');
                                    const tankLabel = rawTank ? `Tank ${rawTank}` : '';
                                    return (
                                      <tr key={idx} className="border-b border-slate-300 h-7">
                                        <td className="border border-slate-900 p-1.5 text-left font-semibold whitespace-nowrap text-[9px]">
                                          {wq.iso_date || wq.date?.slice(0, 10) || ''}
                                        </td>
                                        <td className="border border-slate-900 p-1.5 font-bold text-[#005596]">{tankLabel}</td>
                                        <td className="border border-slate-400 p-1.5">{params.nitrate != null ? `${params.nitrate}` : ''}</td>
                                        <td className="border border-slate-400 p-1.5">{params.nitrite != null ? `${params.nitrite}` : ''}</td>
                                        <td className="border border-slate-400 p-1.5">{params.hardness != null ? `${params.hardness}` : ''}</td>
                                        <td className="border border-slate-400 p-1.5">{params.chlorine != null ? `${params.chlorine}` : ''}</td>
                                        <td className="border border-slate-400 p-1.5">{params.alkalinity != null ? `${params.alkalinity}` : ''}</td>
                                        <td className="border border-slate-400 p-1.5 font-bold">{params.ph != null ? `${params.ph}` : (wq.pH != null ? String(wq.pH) : '')}</td>
                                        <td className="border border-slate-400 p-1.5">{params.ammonia != null ? `${params.ammonia}` : ''}</td>
                                        <td className="border border-slate-400 p-1.5 text-left text-[9px]">{wq.notes && wq.notes !== '-' ? wq.notes : ''}</td>
                                        <td className="border border-slate-900 p-1.5 font-semibold">{wq.logged_by_name || ''}</td>
                                      </tr>
                                    );
                                  })}
                                  {Array.from({ length: paddingCount }).map((_, pIdx) => (
                                    <tr key={`pad-${pIdx}`} className="border-b border-slate-300 h-7">
                                      {Array.from({ length: 11 }).map((_, j) => (
                                        <td key={j} className="border border-slate-300 p-1">&nbsp;</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Paper-exact Footer Legend */}
                            <div className="border-t-2 border-slate-900 text-[9px] p-2 space-y-0.5 mt-2">
                              <div className="font-bold flex justify-between">
                                <span>Recirculated tanks: Daily-Temp, O2, pH &nbsp;|&nbsp; <strong>Biweekly</strong>-Ammonia, Nitrite/Nitrates, Total Hardness &nbsp;|&nbsp; <strong>Weekly</strong>-Nitrogen, Salinity &nbsp;|&nbsp; <strong>Annually</strong>-Chlorine</span>
                                <span className="font-mono">Page {pageIdx + 1} of {pages.length}</span>
                              </div>
                              <table className="w-full border-collapse border border-slate-600 mt-1 text-[9px]">
                                <tbody>
                                  <tr>
                                    <td className="border border-slate-600 p-0.5 font-semibold">Biweekly <em>circle</em> M T W T F S S</td>
                                    <td className="border border-slate-600 p-0.5">Ammonia &nbsp; O &nbsp; O</td>
                                    <td className="border border-slate-600 p-0.5">Nitrite &nbsp; O &nbsp; O</td>
                                    <td className="border border-slate-600 p-0.5">Nitrates &nbsp; O &nbsp; O</td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-600 p-0.5 font-semibold">Weekly <em>circle</em> M T W T F S S</td>
                                    <td className="border border-slate-600 p-0.5">Nitrogen &nbsp; O</td>
                                    <td className="border border-slate-600 p-0.5">Salinity &nbsp; O</td>
                                    <td className="border border-slate-600 p-0.5"></td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-600 p-0.5 font-semibold">Annually &nbsp; Date:</td>
                                    <td className="border border-slate-600 p-0.5">Chlorine</td>
                                    <td className="border border-slate-600 p-0.5"></td>
                                    <td className="border border-slate-600 p-0.5"></td>
                                  </tr>
                                </tbody>
                              </table>
                              <div className="mt-1"><strong>Note:</strong> Salinity requirements vary according to whether they are marine or freshwater in origin.</div>
                              <div className="mt-0.5 text-slate-500">ACC SOP AH24 Water Quality Aquarium Test Strips- Fresh Water Static and Recirculated Tanks- Appendix 7 (Revised May 2024)</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}                {/* Form 3: Aquatic Incident Report Form */}
                {selectedForm === 'incidents' && (() => {
                  // Helper: format date as D/M/Y
                  const fmtDMY = (dateStr: string | undefined) => {
                    if (!dateStr) return '';
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) return dateStr;
                    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
                  };
                  const fmtTime = (dateStr: string | undefined) => {
                    if (!dateStr) return '';
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) return '';
                    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                  };
                  const dateEst = fmtDMY(sopProject.date_established || sopProject.created_at);

                  // Dynamic chunking based on text length weight (target max weight 6 per page)
                  const getRowWeight = (inc: any) => {
                    const totalChars = (inc.description || '').length + (inc.comments || '').length + (inc.notes || '').length;
                    return Math.max(1, Math.ceil(totalChars / 90));
                  };

                  const pages: any[][] = [];
                  if (sopIncidents.length === 0) {
                    pages.push([]);
                  } else {
                    let currentChunk: any[] = [];
                    let currentWeight = 0;
                    for (const inc of sopIncidents) {
                      const w = getRowWeight(inc);
                      if (currentChunk.length > 0 && currentWeight + w > 6) {
                        pages.push(currentChunk);
                        currentChunk = [inc];
                        currentWeight = w;
                      } else {
                        currentChunk.push(inc);
                        currentWeight += w;
                      }
                    }
                    if (currentChunk.length > 0) {
                      pages.push(currentChunk);
                    }
                  }

                  return (
                    <div className="space-y-8 print:space-y-0">
                      {pages.map((pageIncidents, pageIdx) => {
                        const paddingCount = Math.max(0, 6 - pageIncidents.length);

                        return (
                          <div
                            key={pageIdx}
                            className="bg-white border-2 border-slate-900 p-6 shadow-sm text-slate-900 font-sans print:border-slate-900 print:p-2 print:break-after-page page-break mb-6"
                          >
                            {/* Form Header — centered logo + title */}
                            <div className="border-b-2 border-slate-900 pb-3 flex flex-col items-center text-center gap-1">
                              <img src="/uwin-logo.webp" alt="University of Windsor Logo" className="h-12 w-auto object-contain" />
                              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-700">University of Windsor</div>
                              <h2 className="text-sm font-black uppercase text-slate-900 leading-tight">
                                AQUATIC INCIDENT REPORTS
                              </h2>
                            </div>

                            {/* Metadata — single 4-col row: Room | Species | PI | AUPP# */}
                            <div className="grid grid-cols-4 gap-0 border border-slate-900 text-[11px] font-medium my-3">
                              <div className="border-r border-slate-900 p-2"><strong>Room:</strong> {sopProject.room_number || ''}</div>
                              <div className="border-r border-slate-900 p-2"><strong>Species:</strong> {sopProject.species || ''}</div>
                              <div className="border-r border-slate-900 p-2"><strong>PI:</strong> {sopProject.pi_name}</div>
                              <div className="p-2"><strong>AUPP#:</strong> <span className="font-mono">{sopProject.aupp_number}</span></div>
                            </div>

                            {/* Data Table */}
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse border border-slate-900 text-left text-[10px]">
                                <thead>
                                  <tr className="bg-slate-200 border-b border-slate-900 font-bold uppercase text-[10px] text-center">
                                    <th className="border border-slate-900 p-2 whitespace-nowrap">Date<br/><span className="font-normal text-[8px] normal-case">(D/M/Y)</span></th>
                                    <th className="border border-slate-900 p-2 whitespace-nowrap">Time</th>
                                    <th className="border border-slate-900 p-2 whitespace-nowrap">Date Est.<br/><span className="font-normal text-[8px] normal-case">(D/M/Y)</span></th>
                                    <th className="border border-slate-900 p-2">Tank #</th>
                                    <th className="border border-slate-900 p-2">Problem Description</th>
                                    <th className="border border-slate-900 p-2">Comments</th>
                                    <th className="border border-slate-900 p-2">Treatment / Solution</th>
                                    <th className="border border-slate-900 p-2">Aquatic Checked</th>
                                    <th className="border border-slate-900 p-2">Vet Contacted</th>
                                    <th className="border border-slate-900 p-2">Researcher Notified</th>
                                    <th className="border border-slate-900 p-2">Initials</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pageIncidents.map((inc: any) => (
                                    <tr key={inc.id} className="border-b border-slate-400">
                                      <td className="border border-slate-900 p-2 font-semibold whitespace-nowrap">{fmtDMY(inc.date || inc.created_at)}</td>
                                      <td className="border border-slate-900 p-2 whitespace-nowrap text-slate-700">{fmtTime(inc.date || inc.created_at)}</td>
                                      <td className="border border-slate-900 p-2 whitespace-nowrap text-slate-700">{dateEst}</td>
                                      <td className="border border-slate-900 p-2 font-bold text-[#005596] text-center">{inc.tank_number}</td>
                                      <td className="border border-slate-900 p-2">{inc.description}</td>
                                      <td className="border border-slate-900 p-2 text-slate-600">{inc.comments || ''}</td>
                                      <td className="border border-slate-900 p-2">{inc.notes}</td>
                                      <td className="border border-slate-900 p-2 text-center font-bold">Yes</td>
                                      <td className="border border-slate-900 p-2 text-center font-bold">
                                        <span className={inc.vet_contacted === 'Yes' ? 'text-red-600' : ''}>{inc.vet_contacted}</span>
                                      </td>
                                      <td className="border border-slate-900 p-2 text-center font-bold">Yes</td>
                                      <td className="border border-slate-900 p-2 font-semibold text-slate-700 whitespace-nowrap">{inc.reported_by_name || ''}</td>
                                    </tr>
                                  ))}
                                  {Array.from({ length: paddingCount }).map((_, i) => (
                                    <tr key={`pad-${i}`} className="border-b border-slate-300 h-8">
                                      {Array.from({ length: 11 }).map((_, j) => (
                                        <td key={j} className="border border-slate-300 p-1">&nbsp;</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-3 text-right text-[10px] font-mono text-slate-500">
                              Page {pageIdx + 1} of {pages.length}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
