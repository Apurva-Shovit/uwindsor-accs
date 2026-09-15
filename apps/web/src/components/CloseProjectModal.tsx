import React, { useEffect, useState } from 'react';
import { closeProject, getProjects, getTanks, getTankAssignments } from '../lib/api';
import { submitErrorMessage } from '../lib/submission';

type DispositionType = 'euthanized' | 'transferred_internal' | 'adopted' | 'other';

// "transferred_external" is intentionally absent: it's still readable on
// historic projects (see apps/api/app/models/project.py) but can no longer
// be selected for a new closure.
export const DISPOSITION_LABELS: Record<string, string> = {
  euthanized: 'Euthanized',
  transferred_internal: 'Transferred (Internal)',
  transferred_external: 'Transferred (External)',
  adopted: 'Adopted',
  other: 'Other',
};

interface OccupiedTank {
  tank_assignment_id: string;
  tank_id: string;
  tank_number: string;
  current_count: number;
}

interface CloseableProject {
  id?: string;
  _id?: string;
  title: string;
  aupp_number: string;
  species?: string;
  sex?: string;
  occupied_tanks?: OccupiedTank[];
  total_fish_count?: number;
  total_animals?: number;
}

interface ActiveProject {
  id?: string;
  _id?: string;
  title: string;
  aupp_number: string;
  species?: string;
  sex?: string;
  status: string;
}

interface Tank {
  id?: string;
  _id?: string;
  tank_number: string;
}

interface TankAssignment {
  id?: string;
  _id?: string;
  tank_id: string;
  project_id: string;
  current_count: number;
  aupp_number?: string;
}

interface AllocationRow {
  key: string;
  destinationProjectId: string;
  mode: 'relabel' | 'move';
  destinationTankId: string;
  countStr: string;
}

const getId = (obj: { id?: string; _id?: string } | null | undefined): string =>
  obj ? obj.id || obj._id || '' : '';

let rowKeySeq = 0;
const nextRowKey = () => `row-${++rowKeySeq}`;

interface Props {
  project: CloseableProject;
  onClose: () => void;
  onClosed: () => void;
}

export const CloseProjectModal: React.FC<Props> = ({ project, onClose, onClosed }) => {
  const projectId = getId(project);
  const occupiedTanks = project.occupied_tanks || [];
  const totalFish =
    project.total_fish_count ?? project.total_animals ?? occupiedTanks.reduce((s, t) => s + t.current_count, 0);

  const [dispositionType, setDispositionType] = useState<DispositionType>('euthanized');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<Record<string, AllocationRow[]>>({});

  const [activeProjects, setActiveProjects] = useState<ActiveProject[]>([]);
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [assignments, setAssignments] = useState<TankAssignment[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (dispositionType !== 'transferred_internal') return;
    let cancelled = false;
    setLoadingOptions(true);
    Promise.all([getProjects({ status_filter: 'active', limit: 500 }), getTanks(), getTankAssignments()])
      .then(([pRes, tRes, aRes]) => {
        if (cancelled) return;
        const list = Array.isArray(pRes.data) ? pRes.data : pRes.data?.items || pRes.data?.projects || [];
        setActiveProjects(list.filter((p: ActiveProject) => getId(p) !== projectId));
        setTanks(tRes.data || []);
        setAssignments(aRes.data || []);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load destination projects/tanks');
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dispositionType, projectId]);

  const isCompatible = (dest: ActiveProject): boolean => {
    const srcSpecies = (project.species || '').trim().toLowerCase();
    const dstSpecies = (dest.species || '').trim().toLowerCase();
    if (srcSpecies !== dstSpecies) return false;
    const srcSex = project.sex || 'both';
    const dstSex = dest.sex || 'both';
    if (srcSex !== 'both' && dstSex !== 'both' && srcSex !== dstSex) return false;
    return true;
  };

  const addRow = (tankAssignmentId: string) => {
    setAllocations((prev) => ({
      ...prev,
      [tankAssignmentId]: [
        ...(prev[tankAssignmentId] || []),
        { key: nextRowKey(), destinationProjectId: '', mode: 'move', destinationTankId: '', countStr: '' },
      ],
    }));
  };

  const updateRow = (tankAssignmentId: string, key: string, patch: Partial<AllocationRow>) => {
    setAllocations((prev) => ({
      ...prev,
      [tankAssignmentId]: (prev[tankAssignmentId] || []).map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }));
  };

  const removeRow = (tankAssignmentId: string, key: string) => {
    setAllocations((prev) => ({
      ...prev,
      [tankAssignmentId]: (prev[tankAssignmentId] || []).filter((r) => r.key !== key),
    }));
  };

  const tankAllocatedCount = (tankAssignmentId: string): number =>
    (allocations[tankAssignmentId] || []).reduce((s, r) => s + (parseInt(r.countStr, 10) || 0), 0);

  const tankOccupant = (tankId: string) => assignments.find((a) => a.tank_id === tankId && a.current_count > 0);

  // A source tank can only be relabeled to one destination; every other split
  // from that tank has to physically move to a different tank.
  const relabelTakenFor = (tankAssignmentId: string, exceptKey?: string) =>
    (allocations[tankAssignmentId] || []).some((r) => r.mode === 'relabel' && r.key !== exceptKey);

  const internalTransferValid = (): boolean => {
    if (dispositionType !== 'transferred_internal') return true;
    if (occupiedTanks.length === 0) return true;
    for (const t of occupiedTanks) {
      const rows = allocations[t.tank_assignment_id] || [];
      if (rows.length === 0) return false;
      let sum = 0;
      for (const r of rows) {
        const c = parseInt(r.countStr, 10) || 0;
        if (c <= 0) return false;
        if (!r.destinationProjectId) return false;
        if (r.mode === 'move' && !r.destinationTankId) return false;
        sum += c;
      }
      if (sum !== t.current_count) return false;
    }
    return true;
  };

  const isInvalid = dispositionType === 'transferred_internal' && !internalTransferValid();

  const buildAllocationsPayload = () => {
    const payload: any[] = [];
    for (const t of occupiedTanks) {
      for (const r of allocations[t.tank_assignment_id] || []) {
        payload.push({
          source_tank_assignment_id: t.tank_assignment_id,
          destination_project_id: r.destinationProjectId,
          count: parseInt(r.countStr, 10) || 0,
          mode: r.mode,
          destination_tank_id: r.mode === 'move' ? r.destinationTankId : undefined,
        });
      }
    }
    return payload;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await closeProject(projectId, {
        disposition_type: dispositionType,
        notes: notes || undefined,
        internal_transfers: dispositionType === 'transferred_internal' ? buildAllocationsPayload() : undefined,
      });
      onClosed();
    } catch (err: any) {
      setShowConfirm(false);
      setError(submitErrorMessage(err, 'Failed to close project'));
    } finally {
      setSubmitting(false);
    }
  };

  const destProjectName = (id: string) => {
    const p = activeProjects.find((ap) => getId(ap) === id);
    return p ? `${p.title} (AUPP ${p.aupp_number})` : 'Unknown project';
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8">
        <div className="flex justify-between items-start border-b border-slate-100 pb-3">
          <div>
            <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase bg-red-100 text-red-800 mb-1">
              Project Termination / Closure
            </span>
            <h3 className="text-xl font-bold text-red-900">{project.title}</h3>
            <span className="text-xs font-mono text-slate-500">AUPP# {project.aupp_number}</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-bold">
            ✕
          </button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-1 text-xs text-amber-900">
          <div className="font-bold text-amber-800">Confirm Final Project Closure</div>
          <p>Closing this project permanently disposes of every fish currently assigned to it. This cannot be undone.</p>
          <div className="pt-1 flex gap-4 font-semibold text-amber-800">
            <span>Remaining Fish: {totalFish}</span>
            <span>Occupied Tanks: {occupiedTanks.length}</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-slate-600 block">
            Fish Disposition Method <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(['euthanized', 'transferred_internal', 'adopted', 'other'] as DispositionType[]).map((dt) => (
              <label
                key={dt}
                className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
                  dispositionType === dt
                    ? 'border-brandBlue bg-brandBlueTint text-brandBlueDark font-bold'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="disposition"
                  value={dt}
                  checked={dispositionType === dt}
                  onChange={() => setDispositionType(dt)}
                  className="text-brandBlue focus:ring-brandBlue"
                />
                <div className="text-xs">
                  <div>{DISPOSITION_LABELS[dt]}</div>
                  <div className="text-[10px] font-normal text-slate-500">
                    {dt === 'euthanized' && 'Protocol Termination'}
                    {dt === 'transferred_internal' && 'Split fish to other AUPPs in this facility'}
                    {dt === 'adopted' && 'Approved Adoption'}
                    {dt === 'other' && 'Custom Details'}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {dispositionType === 'transferred_internal' && occupiedTanks.length > 0 && (
          <div className="space-y-3 border border-slate-200 rounded-xl p-4 bg-slate-50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-600">Split fish across destination AUPPs</span>
              {loadingOptions && <span className="text-[10px] text-slate-400">Loading options...</span>}
            </div>

            {occupiedTanks.map((t) => {
              const rows = allocations[t.tank_assignment_id] || [];
              const allocated = tankAllocatedCount(t.tank_assignment_id);
              const remaining = t.current_count - allocated;
              return (
                <div key={t.tank_assignment_id} className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">
                      Tank {t.tank_number} — {t.current_count} fish
                    </span>
                    <span
                      className={`font-bold ${
                        remaining === 0 ? 'text-emerald-600' : remaining < 0 ? 'text-red-600' : 'text-amber-600'
                      }`}
                    >
                      Allocated {allocated} / {t.current_count} {remaining !== 0 ? `(${remaining} remaining)` : ''}
                    </span>
                  </div>

                  {rows.map((row) => (
                    <div key={row.key} className="grid grid-cols-12 gap-2 items-center bg-slate-50 rounded-lg p-2">
                      <select
                        className="col-span-4 rounded border border-border px-2 py-1 text-[11px]"
                        value={row.destinationProjectId}
                        onChange={(e) => updateRow(t.tank_assignment_id, row.key, { destinationProjectId: e.target.value })}
                      >
                        <option value="">Destination AUPP...</option>
                        {activeProjects.map((ap) => (
                          <option key={getId(ap)} value={getId(ap)} disabled={!isCompatible(ap)}>
                            {ap.title} (AUPP {ap.aupp_number})
                            {!isCompatible(ap) ? ' — incompatible species/sex' : ''}
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        min={1}
                        max={t.current_count}
                        placeholder="Count"
                        className="col-span-2 rounded border border-border px-2 py-1 text-[11px]"
                        value={row.countStr}
                        onChange={(e) => updateRow(t.tank_assignment_id, row.key, { countStr: e.target.value })}
                      />

                      <div className="col-span-3 flex gap-1 text-[10px]">
                        <label
                          className={`flex items-center gap-1 px-1.5 py-1 rounded border cursor-pointer ${
                            row.mode === 'relabel' ? 'border-brandBlue bg-brandBlueTint' : 'border-slate-200'
                          } ${relabelTakenFor(t.tank_assignment_id, row.key) ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type="radio"
                            name={`mode-${row.key}`}
                            disabled={relabelTakenFor(t.tank_assignment_id, row.key)}
                            checked={row.mode === 'relabel'}
                            onChange={() => updateRow(t.tank_assignment_id, row.key, { mode: 'relabel', destinationTankId: '' })}
                          />
                          Relabel
                        </label>
                        <label
                          className={`flex items-center gap-1 px-1.5 py-1 rounded border cursor-pointer ${
                            row.mode === 'move' ? 'border-brandBlue bg-brandBlueTint' : 'border-slate-200'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`mode-${row.key}`}
                            checked={row.mode === 'move'}
                            onChange={() => updateRow(t.tank_assignment_id, row.key, { mode: 'move' })}
                          />
                          Move
                        </label>
                      </div>

                      {row.mode === 'move' ? (
                        <select
                          className="col-span-2 rounded border border-border px-2 py-1 text-[11px]"
                          value={row.destinationTankId}
                          onChange={(e) => updateRow(t.tank_assignment_id, row.key, { destinationTankId: e.target.value })}
                        >
                          <option value="">Tank...</option>
                          {tanks
                            .filter((tk) => getId(tk) !== t.tank_id)
                            .map((tk) => {
                              const occ = tankOccupant(getId(tk));
                              return (
                                <option key={getId(tk)} value={getId(tk)}>
                                  Tank {tk.tank_number} {occ ? `(AUPP ${occ.aupp_number})` : '(Empty)'}
                                </option>
                              );
                            })}
                        </select>
                      ) : (
                        <span className="col-span-2 text-[10px] text-slate-500 italic px-1">
                          Stays in Tank {t.tank_number}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => removeRow(t.tank_assignment_id, row.key)}
                        className="col-span-1 text-red-500 hover:text-red-700 text-xs font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => addRow(t.tank_assignment_id)}
                    className="text-[11px] font-semibold text-brandBlue hover:text-brandBlueDark"
                  >
                    + Add destination
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold uppercase text-slate-600 block">Disposition &amp; Closure Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe the final disposition procedure, SOP guidelines followed, or transfer recipient..."
            className="w-full border border-slate-200 rounded-xl p-3 text-xs focus:ring-2 focus:ring-red-500 focus:outline-none min-h-[80px]"
          />
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-semibold">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isInvalid || submitting}
            onClick={() => setShowConfirm(true)}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow transition-colors disabled:opacity-50"
          >
            Confirm &amp; Close Project
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-textPrimary">Confirm Project Closure</h3>
            <p className="text-sm text-textSecondary">
              Closing <strong>{project.title}</strong> permanently — this cannot be undone.
            </p>
            {dispositionType === 'transferred_internal' && (
              <ul className="text-xs text-textSecondary space-y-1 list-disc pl-4 max-h-40 overflow-y-auto">
                {occupiedTanks.map((t) =>
                  (allocations[t.tank_assignment_id] || []).map((r) => (
                    <li key={r.key}>
                      {parseInt(r.countStr, 10) || 0} fish from Tank {t.tank_number} → {destProjectName(r.destinationProjectId)}
                      {r.mode === 'relabel'
                        ? ' (same tank, relabeled)'
                        : ` (moved to Tank ${tanks.find((tk) => getId(tk) === r.destinationTankId)?.tank_number || '?'})`}
                    </li>
                  ))
                )}
              </ul>
            )}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-textPrimary hover:bg-surface"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Closing...' : 'Confirm Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CloseProjectModal;
