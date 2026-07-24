import React, { useEffect, useState } from 'react';
import { getProjects, createProject, closeProject } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import SpeciesDropdown from '../../components/SpeciesDropdown';

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
}

const getId = (obj: { id?: string; _id?: string }): string => obj.id || obj._id || '';

export const ProjectDetailsPage: React.FC = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProj, setSelectedProj] = useState<Project | null>(null);

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
  const [roomNumber, setRoomNumber] = useState('301');
  const [rfidTrackingEnabled, setRfidTrackingEnabled] = useState(false);

  // Closing form state
  const [dispositionType, setDispositionType] = useState<'euthanized' | 'transferred_external' | 'adopted' | 'other'>('euthanized');
  const [dispositionNotes, setDispositionNotes] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const isManagerPlus = ['super_admin', 'chair', 'admin', 'manager'].includes(user?.role || '');

  const loadProjects = async () => {
    try {
      const res = await getProjects();
      setProjects(res.data);
      if (selectedProj) {
        const updated = res.data.find((p: Project) => getId(p) === getId(selectedProj));
        if (updated) setSelectedProj(updated);
      }
    } catch (err) {}
  };

  useEffect(() => {
    loadProjects();
  }, []);

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

  const handleCloseProject = async () => {
    if (!selectedProj) return;
    setLoading(true);
    setError('');
    try {
      await closeProject(getId(selectedProj), {
        disposition_type: dispositionType,
        notes: dispositionNotes || undefined,
      });
      setToast('Project closed and disposition recorded!');
      setShowCloseModal(false);
      setDispositionNotes('');
      await loadProjects();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to close project');
    } finally {
      setLoading(false);
    }
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
            className={`w-full py-2 px-4 rounded-lg text-sm font-bold transition-colors ${
              !selectedProj ? 'bg-brandBlue text-white' : 'bg-brandBlueTint text-brandBlueDark hover:bg-blue-100'
            }`}
          >
            + Create New Protocol
          </button>
        )}

        <div className="rounded-xl border border-border bg-white p-4 shadow-sm space-y-2 flex-1 overflow-hidden flex flex-col max-h-[80vh]">
          <h3 className="text-sm font-bold text-textPrimary border-b border-border pb-2">Protocols List</h3>
          <div className="space-y-1 overflow-y-auto flex-1 pr-1">
            {projects.map(p => (
              <button key={getId(p)} onClick={() => setSelectedProj(p)}
                className={`w-full text-left p-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between
                  ${selectedProj && getId(selectedProj) === getId(p) ? 'bg-brandBlueTint text-brandBlueDark font-bold' : 'text-textPrimary hover:bg-surface'}`}>
                <span>{p.title} ({p.aupp_number})</span>
                <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase
                  ${p.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {p.status}
                </span>
              </button>
            ))}
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
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase mb-1
                  ${selectedProj.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {selectedProj.status}
                </span>
                <h2 className="text-xl font-bold text-textPrimary">{selectedProj.title}</h2>
              </div>
              {selectedProj.status === 'active' && isManagerPlus && (
                <button onClick={() => setShowCloseModal(true)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors">
                  Close Project
                </button>
              )}
            </div>

            {selectedProj.status === 'closed' && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-1">
                <span className="block text-xs font-bold text-red-800 uppercase">Project Closed</span>
                <p className="text-sm text-red-700 font-medium">
                  No further fish movement or population updates are permitted.
                </p>
                <div className="text-xs text-red-600 mt-2">
                  <div><strong>Closed At:</strong> {formatDate(selectedProj.closed_at)}</div>
                  <div><strong>Disposition:</strong> <span className="capitalize">{selectedProj.disposition_type}</span></div>
                  {selectedProj.disposition_notes && <div><strong>Notes:</strong> {selectedProj.disposition_notes}</div>}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
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
        )}
      </div>

      {/* Close project Modal */}
      {showCloseModal && selectedProj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form 
            onSubmit={(e) => { e.preventDefault(); handleCloseProject(); }}
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-lg font-bold text-textPrimary">Close Project & Disposition</h3>
            <p className="text-xs text-textSecondary">
              Closing Project <strong>{selectedProj.title}</strong> permanently. This action cannot be undone.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-textSecondary uppercase">Disposition Type</label>
                <select value={dispositionType} onChange={e => setDispositionType(e.target.value as any)}
                  className="w-full rounded border border-border px-3 py-1.5 text-xs focus:outline-none">
                  <option value="euthanized">Euthanized</option>
                  <option value="transferred_external">Transferred External</option>
                  <option value="adopted">Adopted</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-textSecondary uppercase">Notes / Explanations</label>
                <textarea rows={3} value={dispositionNotes} onChange={e => setDispositionNotes(e.target.value)} required
                  placeholder="Explain final disposition outcome..."
                  className="w-full rounded border border-border px-3 py-1.5 text-xs focus:outline-none" />
              </div>
            </div>

            {error && <p className="text-xs text-red-600 font-medium bg-red-50 p-2 rounded">{error}</p>}

            <div className="flex justify-end space-x-3 pt-2">
              <button type="button" onClick={() => setShowCloseModal(false)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-textPrimary hover:bg-surface">
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                Confirm Close
              </button>
            </div>
          </form>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-green-600 text-white px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold">
          ✅ {toast}
          <button onClick={() => setToast('')} className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}
    </div>
  );
};

export default ProjectDetailsPage;

