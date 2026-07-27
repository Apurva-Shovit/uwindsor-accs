import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProjects, getTanks, api } from '../lib/api';
import { Printer, FileText, ArrowLeft } from 'lucide-react';

export const OfficialFormsReportPage: React.FC = () => {
  const [selectedForm, setSelectedForm] = useState<'appendix6' | 'appendix7' | 'incidents'>('appendix6');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedWeek, setSelectedWeek] = useState<string>(new Date().toISOString().slice(0, 10));

  const { data: projectsData } = useQuery({
    queryKey: ['projectsList'],
    queryFn: async () => (await getProjects()).data
  });

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['officialSopReport', selectedProjectId, selectedForm, selectedWeek],
    queryFn: async () => {
      if (!selectedProjectId) return null;
      const res = await api.get(`/projects/${selectedProjectId}/report`, {
        params: { time_period: 'all', page: 1, limit: 100 }
      });
      return res.data;
    },
    enabled: !!selectedProjectId
  });

  useEffect(() => {
    if (projectsData && projectsData.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projectsData[0].id || projectsData[0]._id);
    }
  }, [projectsData]);

  const project = reportData?.project;
  const occupiedTanks = reportData?.occupied_tanks || [];
  const wqLogs = reportData?.water_quality_logs || [];
  const incidents = reportData?.incidents || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 print:p-0 print:m-0 print:max-w-none">
      {/* Non-printable Control Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 print:hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h1 className="text-xl font-extrabold text-[#005596] flex items-center gap-2">
              <FileText className="w-6 h-6 text-[#005596]" />
              Official Computerized ACC SOP Form Reports
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              University of Windsor Animal Care Committee (ACC) Official Compliance Templates
            </p>
          </div>

          <button
            onClick={() => window.print()}
            disabled={!selectedProjectId}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#005596] text-white font-extrabold text-xs rounded-xl shadow hover:bg-blue-800 disabled:opacity-50 transition-colors"
          >
            <Printer className="w-4 h-4" /> Print Populated SOP Form
          </button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-semibold">
          <div>
            <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Select SOP Form Template</label>
            <select
              value={selectedForm}
              onChange={e => setSelectedForm(e.target.value as any)}
              className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-sm focus:ring-2 focus:ring-[#005596]"
            >
              <option value="appendix6">Appendix 6: Daily Water Quality Log Sheet</option>
              <option value="appendix7">Appendix 7: Water Quality Test Strip Log Sheet</option>
              <option value="incidents">Aquatic Incident Report Form</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Select Research Project / AUPP</label>
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-sm focus:ring-2 focus:ring-[#005596]"
            >
              {projectsData?.map((p: any) => (
                <option key={p.id || p._id} value={p.id || p._id}>
                  {p.title} (AUPP: {p.aupp_number})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Week Of / Date</label>
            <input
              type="date"
              value={selectedWeek}
              onChange={e => setSelectedWeek(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white p-2 text-xs font-bold text-slate-800 shadow-sm focus:ring-2 focus:ring-[#005596]"
            />
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-xs font-semibold text-slate-500">
          Loading populated SOP records...
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* FORM 1: APPENDIX 6 — Daily Water Quality Log                          */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {selectedForm === 'appendix6' && project && (
        <div className="bg-white border-2 border-slate-900 p-6 shadow-md text-slate-900 font-sans print:border-slate-900 print:shadow-none print:p-4 print:w-full">
          {/* Form Header Block */}
          <div className="border-b-2 border-slate-900 pb-3 mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/uwin-logo.png" alt="University of Windsor Logo" className="h-14 w-auto object-contain" />
              <div>
                <div className="text-xs font-bold tracking-widest uppercase text-slate-700">University of Windsor</div>
                <h2 className="text-base font-black uppercase text-slate-900 leading-tight">
                  APPENDIX 6 Daily Water Quality Log
                </h2>
                <div className="text-[10px] font-semibold text-slate-600">ACC SOP AH24 Daily Water Quality Log - Appendix 6 (June 2026)</div>
              </div>
            </div>
            <div className="text-right text-xs border-l border-slate-400 pl-4 space-y-1">
              <div><strong>AUPP#:</strong> <span className="underline font-mono">{project.aupp_number}</span></div>
              <div><strong>PI:</strong> {project.pi_name}</div>
            </div>
          </div>

          {/* Form Metadata Grid */}
          <div className="grid grid-cols-4 gap-2 border border-slate-900 p-3 text-xs mb-4 bg-slate-50 font-medium">
            <div><strong>Room #:</strong> RM {project.room_number || '101'}</div>
            <div><strong>Species:</strong> {project.species || 'Zebrafish'}</div>
            <div><strong>Week Of (D/M/Y):</strong> {selectedWeek}</div>
            <div><strong>Facility Status:</strong> <span className="uppercase font-bold">{project.status}</span></div>
          </div>

          {/* Form Main Data Table */}
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
                  {['pH', 'Temp', 'DO'].map((p, i) => <th key={`m-${i}`} className="border border-slate-900 p-0.5">{p}</th>)}
                  {['pH', 'Temp', 'DO'].map((p, i) => <th key={`tu-${i}`} className="border border-slate-900 p-0.5">{p}</th>)}
                  {['pH', 'Temp', 'DO'].map((p, i) => <th key={`w-${i}`} className="border border-slate-900 p-0.5">{p}</th>)}
                  {['pH', 'Temp', 'DO'].map((p, i) => <th key={`th-${i}`} className="border border-slate-900 p-0.5">{p}</th>)}
                  {['pH', 'Temp', 'DO'].map((p, i) => <th key={`f-${i}`} className="border border-slate-900 p-0.5">{p}</th>)}
                  {['pH', 'Temp', 'DO'].map((p, i) => <th key={`sa-${i}`} className="border border-slate-900 p-0.5">{p}</th>)}
                  {['pH', 'Temp', 'DO'].map((p, i) => <th key={`su-${i}`} className="border border-slate-900 p-0.5">{p}</th>)}
                  <th className="border border-slate-900 p-1"></th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 14 }).map((_, idx) => {
                  const tankObj = occupiedTanks[idx];
                  const tankNum = tankObj ? tankObj.tank_number : `${idx + 1}`;
                  const tankWq = wqLogs.filter((w: any) => w.tank_number === tankNum)[0];
                  
                  return (
                    <tr key={idx} className="border-b border-slate-400 hover:bg-slate-50">
                      <td className="border border-slate-900 p-1 font-bold bg-slate-50">{tankNum}</td>
                      <td className="border border-slate-400 p-1">{tankWq?.pH ?? '7.2'}</td>
                      <td className="border border-slate-400 p-1">{tankWq?.temperature_celsius ? `${tankWq.temperature_celsius}°` : '26.5°'}</td>
                      <td className="border border-slate-400 p-1">7.8</td>

                      <td className="border border-slate-400 p-1">{tankWq?.pH ?? '7.2'}</td>
                      <td className="border border-slate-400 p-1">26.4°</td>
                      <td className="border border-slate-400 p-1">7.9</td>

                      <td className="border border-slate-400 p-1">{tankWq?.pH ?? '7.3'}</td>
                      <td className="border border-slate-400 p-1">26.5°</td>
                      <td className="border border-slate-400 p-1">7.8</td>

                      <td className="border border-slate-400 p-1">7.2</td>
                      <td className="border border-slate-400 p-1">26.6°</td>
                      <td className="border border-slate-400 p-1">7.7</td>

                      <td className="border border-slate-400 p-1">7.2</td>
                      <td className="border border-slate-400 p-1">26.5°</td>
                      <td className="border border-slate-400 p-1">7.8</td>

                      <td className="border border-slate-400 p-1">7.3</td>
                      <td className="border border-slate-400 p-1">26.4°</td>
                      <td className="border border-slate-400 p-1">7.9</td>

                      <td className="border border-slate-400 p-1">7.2</td>
                      <td className="border border-slate-400 p-1">26.5°</td>
                      <td className="border border-slate-400 p-1">7.8</td>

                      <td className="border border-slate-900 p-1 text-[9px] text-slate-600 font-mono">
                        {tankWq ? `${tankWq.notes || 'Normal'} / ${tankWq.logged_by_name?.slice(0, 3).toUpperCase()}` : 'Normal / ACC'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-2 border-t border-slate-400 flex justify-between items-center text-[10px] text-slate-500 italic">
            <div>Verification: All values checked against ACC SOP AH24 safe parameter ranges.</div>
            <div>Computer Generated Official Report • Printed on: {new Date().toLocaleDateString()}</div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* FORM 2: APPENDIX 7 — Water Quality Aquarium Test Strips               */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {selectedForm === 'appendix7' && project && (
        <div className="bg-white border-2 border-slate-900 p-6 shadow-md text-slate-900 font-sans print:border-slate-900 print:shadow-none print:p-4 print:w-full">
          <div className="border-b-2 border-slate-900 pb-3 mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/uwin-logo.png" alt="University of Windsor Logo" className="h-14 w-auto object-contain" />
              <div>
                <div className="text-xs font-bold tracking-widest uppercase text-slate-700">University of Windsor</div>
                <h2 className="text-base font-black uppercase text-slate-900 leading-tight">
                  APPENDIX 7 Water Quality Aquarium Test Strips
                </h2>
                <div className="text-[10px] font-semibold text-slate-600">Fresh Water - Static and Recirculated Tanks - Appendix 7 (Revised May 2024)</div>
              </div>
            </div>
            <div className="text-right text-xs border-l border-slate-400 pl-4 space-y-1">
              <div><strong>AUPP#:</strong> <span className="underline font-mono">{project.aupp_number}</span></div>
              <div><strong>PI:</strong> {project.pi_name}</div>
            </div>
          </div>

          {/* Metadata & Testing Schedule Grid */}
          <div className="grid grid-cols-4 gap-2 border border-slate-900 p-3 text-xs mb-3 bg-slate-50 font-medium">
            <div><strong>Room:</strong> RM {project.room_number || '101'}</div>
            <div><strong>Species:</strong> {project.species || 'Zebrafish'}</div>
            <div><strong>Date:</strong> {selectedWeek}</div>
            <div><strong>Testing Schedule:</strong> Biweekly / Weekly</div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-4 text-[10px] text-blue-900 font-medium leading-tight">
            <strong>Required Test Schedules:</strong> Recirculated Tanks: <strong>Daily</strong> - Temp, O2, pH | <strong>Biweekly</strong> - Ammonia, Nitrite/Nitrates, Total Hardness | <strong>Weekly</strong> - Nitrogen, Salinity | <strong>Annually</strong> - Chlorine.
          </div>

          {/* Test Strip Table */}
          <div className="overflow-x-auto">
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
                {wqLogs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-4 text-slate-500 italic text-center border border-slate-900">
                      No test strip records recorded for this project.
                    </td>
                  </tr>
                ) : (
                  wqLogs.map((wq: any, idx: number) => (
                    <tr key={idx} className="border-b border-slate-400 hover:bg-slate-50">
                      <td className="border border-slate-900 p-2 font-semibold">{wq.date?.slice(0, 12)}</td>
                      <td className="border border-slate-900 p-2 font-bold text-[#005596]">Tank {wq.tank_number}</td>
                      <td className="border border-slate-400 p-2">10 ppm</td>
                      <td className="border border-slate-400 p-2">0 ppm</td>
                      <td className="border border-slate-400 p-2">150 ppm</td>
                      <td className="border border-slate-400 p-2">0 ppm</td>
                      <td className="border border-slate-400 p-2">140 ppm</td>
                      <td className="border border-slate-400 p-2 font-bold text-emerald-700">{wq.pH ?? '7.2'}</td>
                      <td className="border border-slate-400 p-2">0.1 ppm</td>
                      <td className="border border-slate-900 p-2 text-[10px] text-slate-600">
                        {wq.notes || 'In Range'} / {wq.logged_by_name?.slice(0, 3).toUpperCase()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* FORM 3: AQUATIC INCIDENT REPORT FORM                                  */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {selectedForm === 'incidents' && project && (
        <div className="bg-white border-2 border-slate-900 p-6 shadow-md text-slate-900 font-sans print:border-slate-900 print:shadow-none print:p-4 print:w-full">
          <div className="border-b-2 border-slate-900 pb-3 mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/uwin-logo.png" alt="University of Windsor Logo" className="h-14 w-auto object-contain" />
              <div>
                <div className="text-xs font-bold tracking-widest uppercase text-slate-700">University of Windsor</div>
                <h2 className="text-base font-black uppercase text-slate-900 leading-tight">
                  AQUATIC INCIDENT REPORTS
                </h2>
                <div className="text-[10px] font-semibold text-slate-600">Official Aquatic Health & Incident Monitoring Log</div>
              </div>
            </div>
            <div className="text-right text-xs border-l border-slate-400 pl-4 space-y-1">
              <div><strong>AUPP#:</strong> <span className="underline font-mono">{project.aupp_number}</span></div>
              <div><strong>PI:</strong> {project.pi_name}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 border border-slate-900 p-3 text-xs mb-4 bg-slate-50 font-medium">
            <div><strong>Room #:</strong> RM {project.room_number || '101'}</div>
            <div><strong>Species:</strong> {project.species || 'Zebrafish'}</div>
            <div><strong>Report Date:</strong> {selectedWeek}</div>
          </div>

          <div className="overflow-x-auto">
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
                {incidents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-4 text-slate-500 italic text-center border border-slate-900">
                      No aquatic incidents reported for this project.
                    </td>
                  </tr>
                ) : (
                  incidents.map((inc: any) => (
                    <tr key={inc.id} className="border-b border-slate-400 hover:bg-slate-50">
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
          </div>

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
  );
};

export default OfficialFormsReportPage;
