import React, { useEffect, useState } from 'react';
import {
  getTankAssignments,
  postCensusEvent,
  postFishIntake,
  getProject,
  getTanks,
  getProjects,
} from '../../lib/api';

/* ─── Types ─── */
interface TankAssignment {
  id?: string;
  _id?: string;
  tank_id: string;
  project_id: string;
  current_count: number;
  pi_name?: string;
  aupp_number?: string;
}

interface Tank {
  id?: string;
  _id?: string;
  tank_number: string;
  status: string;
}

interface Project {
  id?: string;
  _id?: string;
  title: string;
  pi_name?: string;
  aupp_number?: string;
  status?: string;
}

/* Helper: Beanie returns _id, some serializers return id */
const getId = (obj: { id?: string; _id?: string }): string => obj.id || obj._id || '';


/* ─── Constants ─── */
const EVENT_TYPES = [
  { value: 'arrival', label: 'Arrival (+)' },
  { value: 'hatch', label: 'Hatch (+)' },
  { value: 'death', label: 'Death (−)' },
  { value: 'manual_adjustment', label: 'Manual Adjustment (+/−)' },
];

const ADDITIVE_EVENTS = ['arrival', 'hatch'];

/* ─── Component ─── */
export const CensusPage: React.FC = () => {
  /* shared state */
  const [eventType, setEventType] = useState('arrival');
  const [changeStr, setChangeStr] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  /* data for ADDITIVE mode (arrival / hatch) */
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedTankId, setSelectedTankId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');

  /* data for SUBTRACTIVE mode (death / manual_adjustment) */
  const [assignments, setAssignments] = useState<TankAssignment[]>([]);
  const [selectedTaId, setSelectedTaId] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const isAdditive = ADDITIVE_EVENTS.includes(eventType);

  /* ── Load tanks + projects (for arrival/hatch) ── */
  useEffect(() => {
    getTanks().then(r => setTanks(r.data)).catch(() => {});
    getProjects().then(r => {
      const rawList = Array.isArray(r.data) ? r.data : (r.data?.projects || []);
      const active = (rawList as Project[]).filter(p => p.status !== 'closed');
      setProjects(active);
    }).catch(() => {});

  }, []);

  /* ── Load assignments (for death/adjustment) ── */
  useEffect(() => {
    getTankAssignments()
      .then(r => setAssignments(r.data))
      .catch(() => {});
  }, []);

  /* ── Reset selections when switching mode ── */
  useEffect(() => {
    setSelectedTankId('');
    setSelectedProjectId('');
    setSelectedTaId('');
    setSelectedProject(null);
    setChangeStr('');
    setReason('');
    setNotes('');
    setError('');
  }, [eventType]);

  /* ── Fetch project details for subtractive mode ── */
  const selectedTa = assignments.find(a => getId(a) === selectedTaId);
  const currentCount = selectedTa ? selectedTa.current_count : 0;

  useEffect(() => {
    if (!isAdditive && selectedTa?.project_id) {
      getProject(selectedTa.project_id)
        .then(r => setSelectedProject(r.data))
        .catch(() => setSelectedProject(null));
    } else {
      setSelectedProject(null);
    }
  }, [selectedTa?.project_id, isAdditive]);

  /* ── Derived helpers ── */
  const selectedProjectForAdditive = projects.find(p => getId(p) === selectedProjectId);
  const selectedTankForAdditive = tanks.find(t => getId(t) === selectedTankId);
  const existingAssignment = selectedTankId ? assignments.find(a => a.tank_id === selectedTankId && a.current_count > 0) : null;
  const isAuppMismatch = Boolean(existingAssignment && selectedProjectId && existingAssignment.project_id !== selectedProjectId);

  const rawChange = parseInt(changeStr, 10) || 0;
  let changeValue: number;
  if (isAdditive) {
    changeValue = Math.abs(rawChange);
  } else {
    changeValue = eventType === 'death' ? -Math.abs(rawChange) : rawChange;
  }

  const previewCount = isAdditive
    ? (existingAssignment && existingAssignment.project_id === selectedProjectId ? existingAssignment.current_count + rawChange : rawChange)
    : currentCount + changeValue;

  const isInvalid = isAdditive
    ? rawChange <= 0 || !selectedTankId || !selectedProjectId || isAuppMismatch
    : previewCount < 0 || changeValue === 0 || !selectedTaId;

  /* ── Submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isInvalid) return;
    setLoading(true);
    setError('');
    try {
      if (isAdditive) {
        /* Use the intake endpoint – creates/updates TankAssignment + logs arrival event */
        await postFishIntake({
          tank_id: selectedTankId,
          project_id: selectedProjectId,
          count: Math.abs(rawChange),
          event_type: eventType,
          notes: notes || `Fish ${eventType}`,
        });
        setToast(`${eventType === 'arrival' ? 'Arrival' : 'Hatch'} recorded — ${rawChange} fish added!`);
        /* Refresh assignments so subtractive mode has latest data */
        getTankAssignments().then(r => setAssignments(r.data)).catch(() => {});
      } else {
        /* Use the census endpoint for death / manual adjustments */
        const res = await postCensusEvent({
          tank_assignment_id: selectedTaId,
          event_type: eventType,
          change: changeValue,
          reason: reason || undefined,
          notes: notes || undefined,
        });
        setToast('Census recorded successfully!');
        setAssignments(prev =>
          prev.map(a => (getId(a) === selectedTaId ? { ...a, current_count: res.data.new_count } : a))
        );
      }
      setChangeStr('');
      setReason('');
      setNotes('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to record census event');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-textPrimary">Population Census Entry</h1>
        <p className="text-sm text-textSecondary mt-1">
          Record arrivals, hatching, mortality, or manual adjustments. Census records are immutable.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-300 text-red-700 px-4 py-3 text-sm">{error}</div>
          )}

          {/* ─── Event Type (first, so UI adapts) ─── */}
          <div>
            <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
              Event Type
            </label>
            <select
              value={eventType}
              onChange={e => setEventType(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
            >
              {EVENT_TYPES.map(ev => (
                <option key={ev.value} value={ev.value}>
                  {ev.label}
                </option>
              ))}
            </select>
          </div>

          {/* ─── MODE HINT ─── */}
          <div className={`rounded-lg px-4 py-2.5 text-xs font-medium ${isAdditive ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
            {isAdditive
              ? 'Adding fish — select a tank and project below. A new assignment will be created if needed.'
              : 'Adjusting existing population — select an active tank assignment below.'}
          </div>

          {/* ═══════════════════════════════════════════════ */}
          {/*  ADDITIVE MODE: Tank + Project pickers          */}
          {/* ═══════════════════════════════════════════════ */}
          {isAdditive && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
                    Destination Tank
                  </label>
                  <select
                    value={selectedTankId}
                    onChange={e => setSelectedTankId(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
                    required
                  >
                    <option value="">Select a tank...</option>
                    {tanks.filter(t => t.status === 'active').map(t => {
                      const da = assignments.find(a => a.tank_id === getId(t) && a.current_count > 0);
                      const occupantDesc = da ? ` (AUPP: ${da.aupp_number || 'N/A'} - Count: ${da.current_count})` : ' (Empty)';
                      return (
                        <option key={getId(t)} value={getId(t)}>
                          Tank {t.tank_number} {occupantDesc}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
                    Project
                  </label>
                  <select
                    value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
                    required
                  >
                    <option value="">Select a project...</option>
                    {projects.map(p => (
                      <option key={getId(p)} value={getId(p)}>
                        {p.title} {p.aupp_number ? `(AUPP: ${p.aupp_number})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── Warning & Notice Cards ── */}
              {isAuppMismatch && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm flex items-start space-x-3">
                  <div>
                    <h4 className="font-bold text-red-800">Destination Occupied (AUPP Conflict)</h4>
                    <p className="text-red-700 text-xs mt-0.5 leading-relaxed">
                      Tank <strong>{selectedTankForAdditive?.tank_number}</strong> is currently occupied by a different AUPP project (AUPP: <strong>{existingAssignment?.aupp_number || 'N/A'}</strong>). Mixing different projects in the same tank is strictly prohibited.
                    </p>
                  </div>
                </div>
              )}

              {!isAuppMismatch && existingAssignment && selectedProjectId && (
                eventType === 'arrival' ? (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm flex items-start space-x-3">
                    <div>
                      <h4 className="font-bold text-amber-900">Existing Population & Quarantine Warning</h4>
                      <p className="text-amber-800 text-xs mt-0.5 leading-relaxed">
                        Tank <strong>{selectedTankForAdditive?.tank_number}</strong> currently contains <strong>{existingAssignment.current_count} fish</strong> for this project. Adding new arrivals will merge into this existing population and automatically place (or reset) the tank into a <strong>14-day mandatory quarantine</strong>.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm flex items-start space-x-3">
                    <div>
                      <h4 className="font-bold text-blue-900">Existing Population Info</h4>
                      <p className="text-blue-800 text-xs mt-0.5 leading-relaxed">
                        Tank <strong>{selectedTankForAdditive?.tank_number}</strong> currently contains <strong>{existingAssignment.current_count} fish</strong> for this project. New hatchlings will be added to this tank's population without triggering quarantine.
                      </p>
                    </div>
                  </div>
                )
              )}

              {!isAuppMismatch && !existingAssignment && selectedTankId && eventType === 'arrival' && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm flex items-start space-x-3">
                  <div>
                    <h4 className="font-bold text-blue-900">Quarantine Activation Notice</h4>
                    <p className="text-blue-800 text-xs mt-0.5 leading-relaxed">
                      New fish arrival to Tank <strong>{selectedTankForAdditive?.tank_number}</strong> will automatically activate a <strong>14-day mandatory quarantine</strong> on this tank.
                    </p>
                  </div>
                </div>
              )}

              {selectedProjectForAdditive && (
                <div className="rounded-xl border border-border bg-surface p-4 text-sm space-y-1">
                  <div><span className="text-xs font-semibold text-textSecondary uppercase">Project:</span> <span className="font-semibold text-textPrimary">{selectedProjectForAdditive.title}</span></div>
                  <div><span className="text-xs font-semibold text-textSecondary uppercase">PI:</span> <span className="font-semibold text-textPrimary">{selectedProjectForAdditive.pi_name || 'N/A'}</span></div>
                  {selectedProjectForAdditive.aupp_number && (
                    <div><span className="text-xs font-semibold text-textSecondary uppercase">AUPP #:</span> <span className="font-semibold text-textPrimary">{selectedProjectForAdditive.aupp_number}</span></div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════════ */}
          {/*  SUBTRACTIVE MODE: Tank Assignment picker       */}
          {/* ═══════════════════════════════════════════════ */}
          {!isAdditive && (
            <>
              <div>
                <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
                  Select Tank Assignment
                </label>
                <select
                  value={selectedTaId}
                  onChange={e => setSelectedTaId(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
                  required
                >
                  <option value="">Select an active assignment...</option>
                  {assignments
                    .filter(a => a.current_count > 0)
                    .map(a => {
                      const tk = tanks.find(t => getId(t) === a.tank_id);
                      const tankLabel = tk ? tk.tank_number : a.tank_id.slice(-4);
                      return (
                        <option key={getId(a)} value={getId(a)}>
                          Tank {tankLabel} — AUPP {a.aupp_number || 'N/A'} (Count: {a.current_count})
                        </option>
                      );
                    })}
                </select>
                {assignments.filter(a => a.current_count > 0).length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">
                    No active assignments with fish. Use <strong>Arrival</strong> or <strong>Hatch</strong> to add fish first.
                  </p>
                )}
              </div>

              {selectedTa && (
                <div className="rounded-xl border border-border bg-surface p-4 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="block text-xs font-semibold text-textSecondary uppercase">Principal Investigator</span>
                    <span className="font-semibold text-textPrimary">{selectedTa.pi_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-textSecondary uppercase">AUPP #</span>
                    <span className="font-semibold text-textPrimary">{selectedTa.aupp_number || 'N/A'}</span>
                  </div>
                  {selectedProject && (
                    <div className="col-span-2 mt-2">
                      <strong>Project:</strong> {selectedProject.title}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ─── Count input ─── */}
          <div>
            <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
              {isAdditive ? 'Number of Fish' : 'Change Magnitude'}
            </label>
            <input
              type="number"
              min="1"
              placeholder="e.g. 5"
              value={changeStr}
              onChange={e => setChangeStr(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
              required
            />
          </div>

          {/* ─── Live Count Preview ─── */}
          {(isAdditive ? (selectedTankId && selectedProjectId) : selectedTaId) && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-2">
              <span className="block text-xs font-bold text-blue-800 uppercase">Live Count Preview</span>
              {isAdditive && existingAssignment && existingAssignment.project_id === selectedProjectId && (
                <div className="flex items-center justify-between text-sm">
                  <span>Existing Population:</span>
                  <span className="font-bold text-textPrimary">{existingAssignment.current_count}</span>
                </div>
              )}
              {!isAdditive && (
                <div className="flex items-center justify-between text-sm">
                  <span>Current Population:</span>
                  <span className="font-bold text-textPrimary">{currentCount}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span>{isAdditive ? 'Fish to add:' : 'Adjustment:'}</span>
                <span className={`font-bold ${isAdditive || changeValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {isAdditive ? `+${rawChange}` : (changeValue >= 0 ? `+${changeValue}` : changeValue)}
                </span>
              </div>
              <div className="border-t border-blue-200 my-2 pt-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-blue-900">Projected Total:</span>
                <span className={`font-black text-lg ${previewCount < 0 ? 'text-red-600 animate-pulse' : 'text-blue-900'}`}>
                  {previewCount}
                </span>
              </div>
              {!isAdditive && previewCount < 0 && (
                <p className="text-xs text-red-600 font-semibold mt-1">Error: Population count cannot drop below 0.</p>
              )}
            </div>
          )}

          {/* ─── Reason (subtractive only) ─── */}
          {!isAdditive && (
            <div>
              <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
                Reason / Cause
              </label>
              <input
                type="text"
                placeholder="e.g. Natural mortality, hatching batch A..."
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
              />
            </div>
          )}

          {/* ─── Notes ─── */}
          <div>
            <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
              Notes
            </label>
            <textarea
              rows={2}
              placeholder="Additional inspection notes..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
            />
          </div>

          {/* ─── Submit ─── */}
          <button
            type="submit"
            disabled={loading || isInvalid}
            className={`w-full rounded-xl py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-50 ${
              isAdditive
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-brandBlue hover:bg-blue-700'
            }`}
          >
            {loading
              ? 'Recording...'
              : isAdditive
                ? `Record ${eventType === 'arrival' ? 'Arrival' : 'Hatch'}`
                : 'Submit Census Event'}
          </button>
        </form>
      </div>

      {/* ─── Toast ─── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-green-600 text-white px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold">
          {toast}
          <button onClick={() => setToast('')} className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}
    </div>
  );
};

export default CensusPage;
