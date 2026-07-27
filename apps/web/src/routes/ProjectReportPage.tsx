import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getProjectReport } from '../lib/api';
import { ModificationCard } from '../components/audit/ModificationCard';
import { BookOpen, ArrowLeft, Printer, AlertTriangle } from 'lucide-react';

export const ProjectReportPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'tanks' | 'deaths' | 'incidents' | 'census' | 'water_quality' | 'audits'>('tanks');
  const [timePeriod, setTimePeriod] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const limit = 10;

  useEffect(() => {
    if (id) {
      setLoading(true);
      getProjectReport(id, timePeriod, page, limit, startDate, endDate)
        .then(r => {
          setData(r.data);
          setLoading(false);
        })
        .catch(err => {
          setError(err.response?.data?.detail || 'Failed to fetch project report');
          setLoading(false);
        });
    }
  }, [id, timePeriod, startDate, endDate, page]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="animate-spin h-10 w-10 border-4 border-[#005596] border-t-transparent rounded-full" />
        <p className="text-sm font-semibold text-slate-600">Generating Comprehensive Project Audit Report...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 bg-red-50 border border-red-200 rounded-2xl text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-red-600 mx-auto" />
        <h2 className="text-lg font-bold text-red-900">Report Generation Error</h2>
        <p className="text-sm text-red-700">{error || 'Project data unavailable'}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-red-600 text-white font-bold text-sm rounded-lg hover:bg-red-700"
        >
          Go Back
        </button>
      </div>
    );
  }

  const { project, summary, occupied_tanks, deaths, deaths_meta, incidents, incidents_meta, census_events, census_meta, water_quality_logs, water_quality_meta, audit_logs, audit_meta } = data;

  const PaginationControls = ({ meta }: { meta: any }) => {
    if (!meta || meta.total_pages <= 1) return null;
    return (
      <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500 gap-2">
        <div>
          Showing page <strong className="text-slate-800">{meta.page}</strong> of <strong className="text-slate-800">{meta.total_pages}</strong> ({meta.total_items} total records)
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={meta.page <= 1}
            onClick={() => setPage(meta.page - 1)}
            className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded disabled:opacity-40 transition-colors"
          >
            Previous
          </button>
          <button
            disabled={meta.page >= meta.total_pages}
            onClick={() => setPage(meta.page + 1)}
            className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded disabled:opacity-40 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 print:p-0">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 print:hidden">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="flex items-center text-xs font-bold text-[#005596] hover:underline mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Research Projects
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-[#005596] flex items-center gap-2">
              <BookOpen className="w-7 h-7 text-[#005596]" />
              {project.title}
            </h1>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
              project.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
            }`}>
              {project.status}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-mono mt-0.5">
            AUPP Protocol# {project.aupp_number} • PI: {project.pi_name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">Preset Period</label>
            <select
              value={timePeriod}
              onChange={e => { setTimePeriod(e.target.value); setStartDate(''); setEndDate(''); setPage(1); }}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#005596]"
            >
              <option value="all">All Time</option>
              <option value="7d">Past 7 Days</option>
              <option value="30d">Past 30 Days</option>
              <option value="90d">Past 90 Days</option>
              <option value="1y">Past 1 Year</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">From Date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setPage(1); }}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#005596]"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">To Date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setPage(1); }}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#005596]"
            />
          </div>

          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(''); setEndDate(''); setPage(1); }}
              className="text-xs font-bold text-red-600 hover:underline mt-3"
            >
              Clear Range
            </button>
          )}

          <button
            onClick={() => navigate(`/staff/sop-forms?project_id=${id}`)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white font-bold text-xs rounded-xl shadow hover:bg-emerald-800 transition-colors mt-3 sm:mt-0"
          >
            <FileText className="w-4 h-4" /> Official SOP Form (1-Month Auto)
          </button>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#005596] text-white font-bold text-xs rounded-xl shadow hover:bg-blue-800 transition-colors mt-3 sm:mt-0"
          >
            <Printer className="w-4 h-4" /> Print Full Audit Report
          </button>
        </div>
      </div>

      {/* Top Executive Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-center shadow-sm">
          <span className="block text-[10px] font-extrabold text-emerald-800 uppercase tracking-wider">Live Fish Count</span>
          <span className="text-2xl font-black text-emerald-700 mt-1 block">{summary.total_fish_count}</span>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-center shadow-sm">
          <span className="block text-[10px] font-extrabold text-blue-800 uppercase tracking-wider">Occupied Tanks</span>
          <span className="text-2xl font-black text-blue-700 mt-1 block">{summary.occupied_tanks_count}</span>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-center shadow-sm">
          <span className="block text-[10px] font-extrabold text-red-800 uppercase tracking-wider">Total Deaths</span>
          <span className="text-2xl font-black text-red-700 mt-1 block">{summary.total_deaths}</span>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-center shadow-sm">
          <span className="block text-[10px] font-extrabold text-amber-800 uppercase tracking-wider">Incidents Logged</span>
          <span className="text-2xl font-black text-amber-700 mt-1 block">{summary.total_incidents}</span>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-3.5 text-center shadow-sm">
          <span className="block text-[10px] font-extrabold text-purple-800 uppercase tracking-wider">Census Events</span>
          <span className="text-2xl font-black text-purple-700 mt-1 block">{summary.total_census_events}</span>
        </div>
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-3.5 text-center shadow-sm">
          <span className="block text-[10px] font-extrabold text-teal-800 uppercase tracking-wider">Water Quality Logs</span>
          <span className="text-2xl font-black text-teal-700 mt-1 block">{summary.total_wq_logs}</span>
        </div>
        <div className="bg-slate-100 border border-slate-300 rounded-xl p-3.5 text-center shadow-sm col-span-2 sm:col-span-1">
          <span className="block text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Audit Trail Logs</span>
          <span className="text-2xl font-black text-slate-800 mt-1 block">{summary.total_audits}</span>
        </div>
      </div>

      {/* Protocol & Metadata Grid Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
          Protocol Specifications & Facility Context
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase">Principal Investigator</span>
            <span className="font-semibold text-slate-800 text-sm">{project.pi_name}</span>
          </div>
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase">AUPP Protocol Number</span>
            <span className="font-semibold text-slate-800 text-sm">{project.aupp_number}</span>
          </div>
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase">Species</span>
            <span className="font-semibold text-slate-800 text-sm">{project.species || 'N/A'}</span>
          </div>
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase">Sex</span>
            <span className="font-semibold text-slate-800 text-sm capitalize">{project.sex || 'N/A'}</span>
          </div>
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase">Room Number</span>
            <span className="font-semibold text-slate-800 text-sm">RM {project.room_number || 'N/A'}</span>
          </div>
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase">Tracking Mode</span>
            <span className="font-semibold text-slate-800 text-sm">
              {project.rfid_tracking_enabled ? 'RFID Individual Scanning' : 'Standard Population Count'}
            </span>
          </div>
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase">Supplier / Source</span>
            <span className="font-semibold text-slate-800 text-sm">{project.source || 'N/A'}</span>
          </div>
          <div>
            <span className="block text-[10px] font-bold text-slate-400 uppercase">AUPP Expiry Date</span>
            <span className="font-semibold text-slate-800 text-sm">
              {project.aupp_expiry_date ? new Date(project.aupp_expiry_date).toLocaleDateString() : 'N/A'}
            </span>
          </div>
        </div>

        {project.status === 'closed' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-800 space-y-1">
            <span className="font-bold uppercase block text-red-900">Project Closed & Dispositioned</span>
            <div><strong>Closed At:</strong> {project.closed_at ? new Date(project.closed_at).toLocaleString() : 'N/A'}</div>
            <div><strong>Disposition:</strong> <span className="capitalize">{project.disposition_type}</span></div>
            {project.disposition_notes && <div><strong>Notes:</strong> {project.disposition_notes}</div>}
          </div>
        )}
      </div>

      {/* Navigation Tabs for Report Sections */}
      <div className="border-b border-slate-200 flex gap-2 overflow-x-auto print:hidden">
        <button
          onClick={() => setActiveTab('tanks')}
          className={`px-4 py-2.5 text-xs font-extrabold rounded-t-xl transition-colors whitespace-nowrap ${
            activeTab === 'tanks' ? 'bg-[#005596] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Occupied Tanks ({occupied_tanks.length})
        </button>
        <button
          onClick={() => setActiveTab('deaths')}
          className={`px-4 py-2.5 text-xs font-extrabold rounded-t-xl transition-colors whitespace-nowrap ${
            activeTab === 'deaths' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Deaths & Mortality ({deaths.length})
        </button>
        <button
          onClick={() => setActiveTab('incidents')}
          className={`px-4 py-2.5 text-xs font-extrabold rounded-t-xl transition-colors whitespace-nowrap ${
            activeTab === 'incidents' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Incident Reports ({incidents.length})
        </button>
        <button
          onClick={() => setActiveTab('census')}
          className={`px-4 py-2.5 text-xs font-extrabold rounded-t-xl transition-colors whitespace-nowrap ${
            activeTab === 'census' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Census History ({census_events.length})
        </button>
        <button
          onClick={() => setActiveTab('water_quality')}
          className={`px-4 py-2.5 text-xs font-extrabold rounded-t-xl transition-colors whitespace-nowrap ${
            activeTab === 'water_quality' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Water Quality ({water_quality_logs.length})
        </button>
        <button
          onClick={() => setActiveTab('audits')}
          className={`px-4 py-2.5 text-xs font-extrabold rounded-t-xl transition-colors whitespace-nowrap ${
            activeTab === 'audits' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Audit Trail Logs ({audit_logs.length})
        </button>
      </div>

      {/* Tab 1: Occupied Tanks */}
      {activeTab === 'tanks' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Currently Occupied Tanks</h3>
          {occupied_tanks.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-4 text-center">No active tanks currently occupied by this project.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase">
                    <th className="p-3">Tank Identifier</th>
                    <th className="p-3">Current Fish Population</th>
                    <th className="p-3">Quarantine Status</th>
                    <th className="p-3">Tank Operational State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {occupied_tanks.map((t: any) => (
                    <tr key={t.tank_assignment_id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-[#005596]">Tank {t.tank_number}</td>
                      <td className="p-3">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {t.current_count} Fish
                        </span>
                      </td>
                      <td className="p-3">
                        {t.is_quarantined ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            Quarantined {t.quarantine_end_date ? `(until ${new Date(t.quarantine_end_date).toLocaleDateString()})` : ''}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            Active & Healthy
                          </span>
                        )}
                      </td>
                      <td className="p-3 capitalize text-slate-600">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Deaths & Mortality */}
      {activeTab === 'deaths' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-red-900">Project Mortality & Deaths Log</h3>
            <span className="text-xs font-bold text-red-700 bg-red-50 px-3 py-1 rounded-full border border-red-200">
              Total Mortality: {summary.total_deaths} Fish
            </span>
          </div>
          {deaths.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-4 text-center">No mortalities recorded for this project.</p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-red-50/50 border-b border-slate-200 text-red-900 font-bold uppercase">
                      <th className="p-3">Date</th>
                      <th className="p-3">Mortality Count</th>
                      <th className="p-3">Tank</th>
                      <th className="p-3">Reason / Cause</th>
                      <th className="p-3">Notes</th>
                      <th className="p-3">Reported By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {deaths.map((d: any) => (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="p-3 font-semibold text-slate-700 whitespace-nowrap">{d.date}</td>
                        <td className="p-3 font-extrabold text-red-600">-{d.count} Fish</td>
                        <td className="p-3 font-bold text-slate-800">{d.tank_number}</td>
                        <td className="p-3 text-slate-800">{d.reason}</td>
                        <td className="p-3 text-slate-600">{d.notes}</td>
                        <td className="p-3 text-slate-700 font-semibold">{d.reported_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationControls meta={deaths_meta} />
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Incidents Log */}
      {activeTab === 'incidents' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-amber-900">Incident Reports Log</h3>
          {incidents.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-4 text-center">No incidents reported for this project.</p>
          ) : (
            <div className="space-y-3">
              {incidents.map((inc: any) => (
                <div key={inc.id} className="bg-amber-50/30 border border-amber-200 rounded-xl p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-900 uppercase tracking-wider">{inc.incident_type}</span>
                      <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                        Severity: {inc.severity}
                      </span>
                    </div>
                    <span className="text-slate-500 font-semibold">{inc.date}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-slate-700">
                    <div><strong>Tank:</strong> {inc.tank_number}</div>
                    <div><strong>Vet Contacted:</strong> <span className={inc.vet_contacted === 'Yes' ? 'text-red-600 font-bold' : ''}>{inc.vet_contacted}</span></div>
                    <div><strong>Reported By:</strong> {inc.reported_by_name}</div>
                    <div><strong>Status:</strong> <span className="capitalize font-semibold text-slate-800">{inc.status}</span></div>
                  </div>
                  <div className="pt-2 text-slate-800">
                    <strong>Description:</strong> {inc.description}
                  </div>
                  {inc.notes !== '-' && (
                    <div className="text-slate-600 italic">
                      <strong>Notes:</strong> {inc.notes}
                    </div>
                  )}
                </div>
              ))}
              <PaginationControls meta={incidents_meta} />
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Census History */}
      {activeTab === 'census' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-purple-900">Population Census Activity History</h3>
          {census_events.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-4 text-center">No census events recorded.</p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-purple-50/50 border-b border-slate-200 text-purple-900 font-bold uppercase">
                      <th className="p-3">Date</th>
                      <th className="p-3">Event Type</th>
                      <th className="p-3">Population Change</th>
                      <th className="p-3">Tank</th>
                      <th className="p-3">Reason / Notes</th>
                      <th className="p-3">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {census_events.map((c: any) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="p-3 font-semibold text-slate-700 whitespace-nowrap">{c.date}</td>
                        <td className="p-3 capitalize font-bold text-purple-900">{c.event_type}</td>
                        <td className="p-3">
                          <span className={`font-extrabold ${c.change > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {c.change > 0 ? `+${c.change}` : c.change} Fish
                          </span>
                        </td>
                        <td className="p-3 font-bold text-slate-800">{c.tank_number}</td>
                        <td className="p-3 text-slate-600">{c.reason !== '-' ? c.reason : c.notes}</td>
                        <td className="p-3 text-slate-700 font-semibold">{c.actor_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationControls meta={census_meta} />
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Water Quality Logs */}
      {activeTab === 'water_quality' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-teal-900">Water Quality Logged Parameters</h3>
          {water_quality_logs.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-4 text-center">No water quality logs recorded for assigned tanks.</p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-teal-50/50 border-b border-slate-200 text-teal-900 font-bold uppercase">
                      <th className="p-3">Timestamp</th>
                      <th className="p-3">Tank</th>
                      <th className="p-3">pH</th>
                      <th className="p-3">Temp (°C)</th>
                      <th className="p-3">Logged By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {water_quality_logs.map((wq: any) => (
                      <tr key={wq.id} className="hover:bg-slate-50">
                        <td className="p-3 font-semibold text-slate-700 whitespace-nowrap">{wq.date}</td>
                        <td className="p-3 font-bold text-slate-800">{wq.tank_number}</td>
                        <td className="p-3 font-bold text-teal-700">{wq.pH ?? 'N/A'}</td>
                        <td className="p-3 font-bold text-teal-700">{wq.temperature_celsius ? `${wq.temperature_celsius}°C` : 'N/A'}</td>
                        <td className="p-3 text-slate-700 font-semibold">{wq.logged_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationControls meta={water_quality_meta} />
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Audit Trail Logs */}
      {activeTab === 'audits' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Project Operational Audit Trail</h3>
          {audit_logs.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-4 text-center">No operational audit logs recorded for this project.</p>
          ) : (
            <div className="space-y-4">
              {audit_logs.map((a: any) => (
                <div key={a.id} className="border border-slate-200 rounded-xl p-4 space-y-2 text-xs bg-slate-50/50">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-200 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 uppercase">{a.action}</span>
                      <span className="bg-blue-100 text-[#005596] font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                        {a.entity_type}
                      </span>
                    </div>
                    <div className="text-slate-500 font-medium">
                      By <strong className="text-slate-800">{a.actor_name}</strong> ({a.actor_role}) on {a.timestamp}
                    </div>
                  </div>
                  <ModificationCard before={a.before} after={a.after} />
                </div>
              ))}
              <PaginationControls meta={audit_meta} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectReportPage;
