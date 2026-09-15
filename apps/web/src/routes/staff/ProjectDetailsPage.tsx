import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, CheckCircle2 } from 'lucide-react';
import { getProjects, createProject, getProjectDetails } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import SpeciesDropdown from '../../components/SpeciesDropdown';
import CloseProjectModal, { DISPOSITION_LABELS } from '../../components/CloseProjectModal';

interface Project {
  id?: string;
  _id?: string;
  title: string;
  pi_name: string;
  aupp_number: string;
  status: 'active' | 'closed';
  closed_at?: string;
  disposition_type?: string;
  disposition_notes?: string;

  // Extended PRD fields
  species?: string;
  sex?: 'male' | 'female' | 'both';
  dob?: string;
  established_date?: string;
  source?: string;
  aupp_expiry_date?: string;
  room_number?: string;
  rfid_tracking_enabled?: boolean;
}

const getId = (obj: { id?: string; _id?: string }): string => obj.id || obj._id || '';

export const ProjectDetailsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProj, setSelectedProj] = useState<Project | null>(null);
  const [projDetails, setProjDetails] = useState<any | null>(null);

  // Creation form state
  const [title, setTitle] = useState('');
  const [piName, setPiName] = useState('');
  const [auppNumber, setAuppNumber] = useState('');

  // Extended fields form state
  const [species, setSpecies] = useState('Zebrafish');
  const [sex, setSex] = useState<'male' | 'female' | 'both'>('both');
  const [dob, setDob] = useState('');
  const [establishedDate, setEstablishedDate] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState('');
  const [auppExpiryDate, setAuppExpiryDate] = useState('');
  const [roomNumber, setRoomNumber] = useState('1');
  const [rfidTrackingEnabled, setRfidTrackingEnabled] = useState(false);

  // Closing form state
  const [showCloseModal, setShowCloseModal] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const isManagerPlus = ['super_admin', 'chair', 'admin', 'manager'].includes(user?.role || '');

  const loadProjects = async () => {
    try {
      const res = await getProjects();
      const list = Array.isArray(res.data) ? res.data : (res.data?.items || res.data?.projects || []);
      setProjects(list);
      if (selectedProj) {
        const updated = list.find((p: Project) => getId(p) === getId(selectedProj));
        if (updated) setSelectedProj(updated);
      }
    } catch (err) { }
  };



  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProj) {
      const pid = getId(selectedProj);
      if (pid) {
        getProjectDetails(pid)
          .then(r => setProjDetails(r.data))
          .catch(() => setProjDetails(null));
      }
    } else {
      setProjDetails(null);
    }
  }, [selectedProj?.id, (selectedProj as any)?._id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await createProject({
        title,
        pi_name: piName,
        aupp_number: auppNumber,
        species,
        sex,
        dob: dob || undefined,
        established_date: establishedDate || undefined,
        source: source || undefined,
        aupp_expiry_date: auppExpiryDate ? new Date(auppExpiryDate).toISOString() : undefined,
        room_number: roomNumber || undefined,
        rfid_tracking_enabled: rfidTrackingEnabled,
      });
      setToast('Project created successfully!');
      setTitle('');
      setPiName('');
      setAuppNumber('');
      setDob('');
      setSource('');
      setAuppExpiryDate('');
      setRfidTrackingEnabled(false);
      await loadProjects();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const handleProjectClosed = async () => {
    setToast('Project closed and disposition recorded!');
    setShowCloseModal(false);
    await loadProjects();
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Left panel: List & Create */}
      <div className="col-span-1 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-textPrimary">Research Projects</h1>
          <p className="text-xs text-textSecondary mt-1">Manage active scientific protocols and AUPPs.</p>
        </div>

        {isManagerPlus && (
          <button
            onClick={() => setSelectedProj(null)}
            className={`w-full py-2 px-4 rounded-lg text-sm font-bold transition-colors ${!selectedProj ? 'bg-brandBlue text-white' : 'bg-brandBlueTint text-brandBlueDark hover:bg-blue-100'
              }`}
          >
            + Create New Protocol
          </button>
        )}

        <div className="rounded-xl border border-border bg-white p-4 shadow-sm space-y-2 flex-1 overflow-hidden flex flex-col max-h-[80vh]">
          <h3 className="text-sm font-bold text-textPrimary border-b border-border pb-2">Protocols List</h3>
          <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
            {projects.map(p => {
              const isSelected = selectedProj && getId(selectedProj) === getId(p);
              const isClosed = p.status === 'closed';
              return (
                <button
                  key={getId(p)}
                  onClick={() => setSelectedProj(p)}
                  className={`w-full text-left p-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between border ${
                    isSelected
                      ? 'bg-brandBlueTint text-brandBlueDark font-bold border-brandBlue/30 shadow-xs'
                      : isClosed
                      ? 'bg-slate-50/80 text-slate-500 hover:bg-slate-100 border-slate-200/60'
                      : 'bg-white text-textPrimary hover:bg-slate-50 border-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 pr-2">
                    {isClosed && <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
                    <span className="truncate">
                      {p.title} <span className="font-mono text-[10px] text-slate-400">({p.aupp_number})</span>
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase flex-shrink-0 ${
                      isClosed
                        ? 'bg-slate-200/80 text-slate-700 border border-slate-300/70'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isClosed ? 'bg-slate-500' : 'bg-emerald-500'}`} />
                    {p.status}
                  </span>
                </button>
              );
            })}
            {projects.length === 0 && <p className="text-xs text-textSecondary p-2">No projects registered yet.</p>}
          </div>
        </div>
      </div>

      {/* Right panel: Details or Form */}
      <div className="col-span-2 space-y-6">
        {!selectedProj ? (
          isManagerPlus ? (
            <div className="rounded-2xl border border-border bg-white p-6 shadow-sm space-y-6">
              <h2 className="text-xl font-bold text-textPrimary border-b border-border pb-4">Register New Protocol (AUPP)</h2>
              <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">Project Title</label>
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)} required
                    className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brandBlue" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">Principal Investigator</label>
                  <input type="text" value={piName} onChange={e => setPiName(e.target.value)} required
                    className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brandBlue" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">AUPP Number</label>
                  <input type="text" value={auppNumber} onChange={e => setAuppNumber(e.target.value)} required placeholder="e.g. 23-01"
                    className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brandBlue" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">Species</label>
                  <SpeciesDropdown species={species} setSpecies={setSpecies} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">Sex</label>
                  <select value={sex} onChange={e => setSex(e.target.value as any)}
                    className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brandBlue">
                    <option value="both">Both (Mixed)</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">Date of Birth (Optional)</label>
                  <input type="date" value={dob} onChange={e => setDob(e.target.value)}
                    className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brandBlue" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">Established Date</label>
                  <input type="date" value={establishedDate} onChange={e => setEstablishedDate(e.target.value)} required
                    className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brandBlue" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">Source</label>
                  <input type="text" value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. External Supplier Co"
                    className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brandBlue" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">AUPP Expiry Date</label>
                  <input type="date" value={auppExpiryDate} onChange={e => setAuppExpiryDate(e.target.value)} required
                    className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brandBlue" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-textSecondary uppercase">RM#</label>
                  <input type="text" value={roomNumber} onChange={e => setRoomNumber(e.target.value)} required
                    className="w-full rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-brandBlue" />
                </div>

                <div className="col-span-2 pt-2 border-t border-slate-100">
                  <label className="flex items-center gap-2 cursor-pointer p-3 bg-slate-50 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={rfidTrackingEnabled}
                      onChange={e => setRfidTrackingEnabled(e.target.checked)}
                      className="w-4 h-4 text-brandBlue rounded border-slate-300 focus:ring-brandBlue"
                    />
                    <div>
                      <span className="block text-sm font-bold text-slate-800">Enable RFID / Individual Tracking</span>
                      <span className="block text-xs text-slate-500">Switch this project from population counts to individual fish scanning mode.</span>
                    </div>
                  </label>
                </div>

                <div className="col-span-2 pt-4">
                  {error && <p className="text-xs text-red-600 font-medium mb-3 bg-red-50 p-2 rounded">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full md:w-auto px-6 rounded-lg bg-brandBlue py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    Register Project
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-white p-12 shadow-sm text-center">
              <p className="text-textSecondary">Select a protocol from the list to view details.</p>
            </div>
          )
        ) : (
          <div className={`rounded-2xl border bg-white p-6 shadow-sm space-y-6 ${
            selectedProj.status === 'closed' ? 'border-slate-300' : 'border-border'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold uppercase mb-1.5 ${
                    selectedProj.status === 'active'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-slate-100 text-slate-700 border border-slate-300'
                  }`}
                >
                  {selectedProj.status === 'active' ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Active Protocol
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5 text-slate-500" />
                      Closed / Archived Protocol
                    </>
                  )}
                </span>
                <h2 className="text-xl font-bold text-textPrimary">{selectedProj.title}</h2>
                <span className="text-xs text-textSecondary font-mono block">AUPP# {selectedProj.aupp_number}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/staff/projects/${getId(selectedProj)}/report`)}
                  className="rounded-lg bg-[#005596] px-4 py-2 text-xs font-extrabold text-white hover:bg-blue-800 transition-colors shadow"
                >
                  View Full Project Audit & Report
                </button>
                {selectedProj.status === 'active' && isManagerPlus && (
                  <button onClick={() => setShowCloseModal(true)}
                    className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition-colors">
                    Close Project
                  </button>
                )}
              </div>
            </div>

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                <span className="block text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Total Fish Count</span>
                <span className="text-xl font-extrabold text-emerald-700 mt-1 block">
                  {projDetails ? (projDetails.total_fish_count ?? 0) : '...'} Fish
                </span>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                <span className="block text-[10px] font-bold text-blue-800 uppercase tracking-wider">Occupied Tanks</span>
                <span className="text-xl font-extrabold text-blue-700 mt-1 block">
                  {projDetails ? (projDetails.assigned_tanks_count ?? 0) : '...'} Tanks
                </span>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
                <span className="block text-[10px] font-bold text-amber-800 uppercase tracking-wider">Quarantine Status</span>
                <span className="text-xl font-extrabold text-amber-700 mt-1 block">
                  {projDetails ? (projDetails.occupied_tanks?.filter((t: any) => t.is_quarantined).length ?? 0) : 0} Quarantined
                </span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tracking Mode</span>
                <span className="text-xs font-bold text-slate-800 mt-2 block">
                  {selectedProj.rfid_tracking_enabled ? 'RFID Individual' : 'Population Count'}
                </span>
              </div>
            </div>

            {selectedProj.status === 'closed' && (
              <div className="rounded-xl border border-slate-300 bg-slate-100 p-4 space-y-2 shadow-2xs">
                <div className="flex items-center gap-2 text-slate-800 font-extrabold text-xs">
                  <Lock className="w-4 h-4 text-slate-600" />
                  <span>CLOSED & ARCHIVED PROTOCOL</span>
                  <span className="ml-auto text-[10px] uppercase font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded border border-slate-300">Read-Only</span>
                </div>
                <p className="text-xs text-slate-600 font-medium">
                  No further fish movement, tank assignments, or census updates are permitted on this protocol.
                </p>
                <div className="text-xs text-slate-700 pt-2 border-t border-slate-200 space-y-1">
                  <div><strong>Closed Date:</strong> {formatDate(selectedProj.closed_at)}</div>
                  <div><strong>Final Disposition:</strong> <span>{DISPOSITION_LABELS[selectedProj.disposition_type || ''] || selectedProj.disposition_type || 'Recorded'}</span></div>
                  {selectedProj.disposition_notes && <div><strong>Notes:</strong> {selectedProj.disposition_notes}</div>}
                </div>
              </div>
            )}

            {/* Protocol Metadata Grid */}
            <div>
              <h3 className="text-xs font-bold text-textSecondary uppercase tracking-wider mb-3 border-b border-slate-100 pb-1">
                Protocol Metadata & Specifications
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                <div>
                  <span className="block text-xs font-semibold text-textSecondary uppercase">Principal Investigator</span>
                  <span className="text-sm font-medium text-textPrimary">{selectedProj.pi_name}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-textSecondary uppercase">AUPP Protocols #</span>
                  <span className="text-sm font-medium text-textPrimary">{selectedProj.aupp_number}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-textSecondary uppercase">Species</span>
                  <span className="text-sm font-medium text-textPrimary">{selectedProj.species || 'N/A'}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-textSecondary uppercase">Sex</span>
                  <span className="text-sm font-medium text-textPrimary capitalize">{selectedProj.sex || 'N/A'}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-textSecondary uppercase">Date of Birth (DOB)</span>
                  <span className="text-sm font-medium text-textPrimary">{formatDate(selectedProj.dob)}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-textSecondary uppercase">Established Date</span>
                  <span className="text-sm font-medium text-textPrimary">{formatDate(selectedProj.established_date)}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-textSecondary uppercase">Source</span>
                  <span className="text-sm font-medium text-textPrimary">{selectedProj.source || 'N/A'}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-textSecondary uppercase">AUPP Expiry Date</span>
                  <span className="text-sm font-medium text-textPrimary">{formatDate(selectedProj.aupp_expiry_date)}</span>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-textSecondary uppercase">Room Number (RM#)</span>
                  <span className="text-sm font-medium text-textPrimary">RM {selectedProj.room_number || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* Occupied Tanks Section */}
            <div className="pt-2">
              <h3 className="text-xs font-bold text-textSecondary uppercase tracking-wider mb-3 border-b border-slate-100 pb-1">
                Currently Occupied Tanks ({projDetails?.occupied_tanks?.length ?? 0})
              </h3>
              {projDetails && projDetails.occupied_tanks && projDetails.occupied_tanks.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase">
                        <th className="p-3">Tank</th>
                        <th className="p-3">Fish Population</th>
                        <th className="p-3">Quarantine Status</th>
                        <th className="p-3">Tank State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {projDetails.occupied_tanks.map((t: any) => (
                        <tr key={t.tank_assignment_id} className="hover:bg-slate-50">
                          <td className="p-3 font-bold text-[#005596]">Tank {t.tank_number}</td>
                          <td className="p-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {t.current_count} Fish
                            </span>
                          </td>
                          <td className="p-3">
                            {t.is_quarantined ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                                Quarantined {t.quarantine_end_date ? `(until ${new Date(t.quarantine_end_date).toLocaleDateString()})` : ''}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                Clear / Active
                              </span>
                            )}
                          </td>
                          <td className="p-3 capitalize text-slate-600">{t.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-slate-50 rounded-xl p-4 text-center text-xs text-slate-500 border border-slate-200 italic">
                  No tanks are currently occupied by this project.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Close project Modal */}
      {showCloseModal && selectedProj && (
        <CloseProjectModal
          project={{
            ...selectedProj,
            occupied_tanks: projDetails?.occupied_tanks,
            total_fish_count: projDetails?.total_fish_count,
          }}
          onClose={() => setShowCloseModal(false)}
          onClosed={handleProjectClosed}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-green-600 text-white px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold">
          {toast}
          <button onClick={() => setToast('')} className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}
    </div>
  );
};

export default ProjectDetailsPage;

