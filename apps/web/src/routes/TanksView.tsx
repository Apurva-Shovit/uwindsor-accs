import React, { useState, useEffect } from 'react';
import { getTanksSummary, createTank, deleteTank, getTankAssignments, getTankAssignmentHistory, getTankHistory, toggleTankQuarantine } from '../lib/api';

import { Database, Plus } from 'lucide-react';

interface TankSummary {
  id: string;
  tank_number: string;
  status: string;
  display_status: string;
  notes: string;
  species: string;
  aupp: string;
  count: number;
}

interface TanksViewProps {
  isAdminMode?: boolean;
}

export const TanksView: React.FC<TanksViewProps> = ({ isAdminMode = false }) => {
  const [tanks, setTanks] = useState<TankSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTank, setSelectedTank] = useState<TankSummary | null>(null);

  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const getId = (obj: { id?: string; _id?: string }): string => obj.id || obj._id || '';

  useEffect(() => {
    if (!selectedTank) {
      setHistory([]);
      return;
    }
    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const histRes = await getTankHistory(getId(selectedTank));
        setHistory(histRes.data);
      } catch (err) {
        setHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    };
    loadHistory();
  }, [selectedTank]);



  // Add Tank modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTankNumber, setNewTankNumber] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const fetchTanks = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getTanksSummary();
      setTanks(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch tank layouts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTanks();
  }, []);

  const handleAddTank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTankNumber.trim()) return;
    setAddLoading(true);
    try {
      // Pass a dummy room_id for Sprint 1 (our seeded room)
      await createTank({
        room_id: "6a623550f05f34b3e7462320",
        tank_number: newTankNumber,
        notes: newNotes,
      });

      setIsAddOpen(false);
      setNewTankNumber('');
      setNewNotes('');
      await fetchTanks();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to add tank');
    } finally {
      setAddLoading(false);
    }
  };

  // Group tanks for 2x7 visual split
  // Group 1: 1-8, Group 2: 9-14 (and higher)
  const numericTanks = [...tanks].sort((a, b) => {
    const numA = parseInt(a.tank_number, 10);
    const numB = parseInt(b.tank_number, 10);
    if (isNaN(numA) || isNaN(numB)) return a.tank_number.localeCompare(b.tank_number);
    return numA - numB;
  });

  const group1 = numericTanks.filter((t) => {
    const n = parseInt(t.tank_number, 10);
    return !isNaN(n) && n <= 8;
  });

  const group2 = numericTanks.filter((t) => {
    const n = parseInt(t.tank_number, 10);
    return isNaN(n) || n > 8;
  });
const rackATotal = group1.reduce((sum, t) => sum + (t.count ?? 0), 0);
const rackBTotal = group2.reduce((sum, t) => sum + (t.count ?? 0), 0);


  const getStatusColor = (display_status: string) => {
    switch (display_status) {
      case 'healthy':
        return '#1E8A4C'; // success token
      case 'quarantine':
        return '#005596'; // brandBlue
      case 'attention':
        return '#D97706'; // warning token
      case 'inactive':
        return '#58585B'; // brandGrey
      default:
        return '#1E8A4C';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-textPrimary">Room 301 — Top-View Grid</h1>
          <p className="text-sm text-textSecondary">
            {isAdminMode ? 'Manage tank status and configurations.' : 'View assigned tanks and health states.'}
          </p>
        </div>
        <div className="flex space-x-2">
          {isAdminMode && (
            <button
              onClick={() => setIsAddOpen(true)}
              className="inline-flex items-center rounded-md bg-brandBlue px-4 py-2 text-sm font-semibold text-white hover:bg-brandBlueDark"
            >
              <Plus className="mr-2 h-4 w-4" /> Add Tank
            </button>
          )}
          <button
            onClick={fetchTanks}
            className="rounded-md bg-white border border-border px-4 py-2 text-sm font-medium text-textPrimary hover:bg-surface"
          >
            Refresh Grid
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-danger">{error}</div>}

      {loading ? (
        <div className="flex py-24 justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brandBlue border-t-transparent"></div>
        </div>
      ) : (
        <div className="space-y-8 bg-white border border-border rounded-xl p-8 shadow-sm">
          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs font-semibold uppercase text-textSecondary border-b border-border pb-4">
            <span className="flex items-center">
              <span className="mr-2 h-3.5 w-3.5 rounded bg-success inline-block"></span> Healthy (Green)
            </span>
            <span className="flex items-center">
              <span className="mr-2 h-3.5 w-3.5 rounded bg-brandBlue inline-block"></span> Quarantine (Blue)
            </span>
            <span className="flex items-center">
              <span className="mr-2 h-3.5 w-3.5 rounded bg-warning inline-block"></span> Attention (Amber)
            </span>
            <span className="flex items-center">
              <span className="mr-2 h-3.5 w-3.5 rounded bg-brandGrey inline-block"></span> Inactive (Grey)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
            {/* Visual Tank Layout Rack 1 (Tanks 1-8) */}
            <div className="border border-border rounded-lg p-4 bg-surface/40 space-y-4">
              <h3 className="text-sm font-bold text-textPrimary border-b border-border pb-2">Rack Section A (Tanks 1 - 8) — Total Fish: {rackATotal}</h3>
              <div className="grid grid-cols-4 gap-4">
                {group1.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTank(t)}
                    className="flex flex-col items-center justify-center p-3 rounded-lg border border-border bg-white hover:shadow-md transition-all group"
                  >
                    <svg
                      className="h-10 w-10 text-brandGrey group-hover:scale-105 transition-transform"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect
                        x="2"
                        y="4"
                        width="20"
                        height="14"
                        rx="2"
                        stroke={getStatusColor(t.display_status)}
                        fill={t.display_status === "inactive" ? "#E5E7EB" : "#F0FDF4"}
                      />
                      <line
                        x1="2"
                        y1="9"
                        x2="22"
                        y2="9"
                        stroke={getStatusColor(t.display_status)}
                        strokeWidth="1"
                      />
                      <path
                        d="M4 14 Q 8 12, 12 14 T 20 14"
                        stroke="#60A5FA"
                        strokeWidth="1"
                        fill="none"
                      />
                    </svg>

                    <span className="mt-2 text-xs font-bold text-textPrimary">
                      Tank {t.tank_number} - {t.count} fish
                    </span>
                  </button>
                ))}
              </div>
            </div>


            {/* Visual Tank Layout Rack 2 (Tanks 9-14+) */}
            <div className="border border-border rounded-lg p-4 bg-surface/40 space-y-4">
               <h3 className="text-sm font-bold text-textPrimary border-b border-border pb-2">Rack Section B (Tanks 9 - 14+) - Total Fish: {rackBTotal}</h3>
              <div className="grid grid-cols-4 gap-4">
                {group2.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTank(t)}
                    className="flex flex-col items-center justify-center p-3 rounded-lg border border-border bg-white hover:shadow-md transition-all group"
                  >
                    <svg
                      className="h-10 w-10 text-brandGrey group-hover:scale-105 transition-transform"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect
                        x="2"
                        y="4"
                        width="20"
                        height="14"
                        rx="2"
                        stroke={getStatusColor(t.display_status)}
                        fill={t.display_status === "inactive" ? "#E5E7EB" : "#F0FDF4"}
                      />
                      <line
                        x1="2"
                        y1="9"
                        x2="22"
                        y2="9"
                        stroke={getStatusColor(t.display_status)}
                        strokeWidth="1"
                      />
                      <path
                        d="M4 14 Q 8 12, 12 14 T 20 14"
                        stroke="#60A5FA"
                        strokeWidth="1"
                        fill="none"
                      />
                    </svg>

                    <span className="mt-2 text-xs font-bold text-textPrimary">
                      Tank {t.tank_number} - {t.count} fish
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

      )
      }

      {/* Tank Detail Side Drawer / Modal */}
      {
        selectedTank && (
          <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 p-4">
            <div className="h-full w-full max-w-md rounded-lg bg-white p-6 shadow-xl flex flex-col justify-between">
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <h3 className="text-lg font-bold text-textPrimary flex items-center">
                    <Database className="mr-2 h-5 w-5 text-brandBlue" /> Tank Details
                  </h3>
                  <button onClick={() => setSelectedTank(null)} className="text-textSecondary hover:text-textPrimary text-xl font-bold">
                    &times;
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="block text-xs font-semibold uppercase text-textSecondary">Tank Number</span>
                      <span className="text-base font-bold text-textPrimary">Tank {selectedTank.tank_number}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold uppercase text-textSecondary">Display Status</span>
                      <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-success">
                        {selectedTank.display_status}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-border pt-4 space-y-3">
                    <div>
                      <span className="block text-xs font-semibold uppercase text-textSecondary">Species</span>
                      <span className="text-sm font-medium text-textPrimary">{selectedTank.species}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold uppercase text-textSecondary">AUPP #</span>
                      <span className="text-sm font-medium text-textPrimary">{selectedTank.aupp}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold uppercase text-textSecondary">Current Occupant Count</span>
                      <span className="text-sm font-bold text-textPrimary">{selectedTank.count}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold uppercase text-textSecondary">Operational status</span>
                      <span className="text-sm font-bold text-textPrimary capitalize">{selectedTank.status}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold uppercase text-textSecondary">Notes</span>
                      <p className="text-xs text-textSecondary bg-surface p-2 rounded-md">{selectedTank.notes || 'No notes available'}</p>
                    </div>

                    <div className="border-t border-border pt-4">
                      <span className="block text-xs font-bold uppercase text-textSecondary mb-2">History</span>
                      {historyLoading ? (
                        <div className="text-xs text-textSecondary py-2 flex items-center gap-2">
                          <div className="h-3 w-3 animate-spin rounded-full border border-brandBlue border-t-transparent"></div>
                          Loading history...
                        </div>
                      ) : history.length === 0 ? (
                        <span className="text-xs text-textSecondary italic">No historical logs available for this occupant.</span>
                      ) : (
                        <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                          {history.map((h, index) => (
                            <div key={index} className="text-xs border-b border-border pb-2 last:border-b-0">
                              <div className="flex justify-between text-textSecondary font-semibold">
                                <span className="uppercase text-[10px] tracking-wide">
                                  {h.type === 'census' && `Census: ${h.event_type}`}
                                  {h.type === 'water_quality' && `Water Quality: ${h.log_type}`}
                                  {h.type === 'incident' && 'Incident'}
                                </span>
                                <span>{h.date}</span>
                              </div>

                              {/* Census display */}
                              {h.type === 'census' && (
                                <div className="mt-1">
                                  <span className={`font-bold ${h.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {h.change >= 0 ? `+${h.change}` : h.change} fish
                                  </span>
                                  {h.reason && <span className="text-textSecondary"> ({h.reason})</span>}
                                  {h.transfer_group_id && (
                                    <span className="block text-[10px] text-brandBlue">
                                      🔗 Group ID: {h.transfer_group_id.slice(0, 8)}...
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Water Quality display */}
                              {h.type === 'water_quality' && (
                                <div className="mt-1 text-textPrimary grid grid-cols-3 gap-1 bg-surface p-1 rounded">
                                  {Object.entries(h.parameters).map(([k, val]) => (
                                    <span key={k}>
                                      <strong>{k}:</strong> {String(val)}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Incident display */}
                              {h.type === 'incident' && (
                                <div className="mt-1 text-textPrimary bg-yellow-50 border border-yellow-100 p-1.5 rounded space-y-1">
                                  <div className="font-semibold">⚠️ {h.problem}</div>
                                  {h.treatment && <div><strong>Treatment:</strong> {h.treatment}</div>}
                                  {h.vet_contacted && <div className="text-[10px] text-yellow-800 font-bold">🩺 Vet Contacted</div>}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
                {isAdminMode && (
                  <button
                    onClick={async () => {
                      if (!selectedTank) return;
                      if (window.confirm('Delete this tank permanently?')) {
                        try {
                          await deleteTank(getId(selectedTank));
                          setSelectedTank(null);
                          await fetchTanks();
                        } catch (err) {
                          alert('Failed to delete tank');
                        }
                      }
                    }}
                    className="rounded-md border border-red-200 bg-red-50 text-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-100 hover:border-red-300 transition-colors"
                  >
                    Delete
                  </button>
                )}
                
                {selectedTank?.display_status === 'quarantine' ? (
                  <button
                    onClick={async () => {
                      if (!selectedTank) return;
                      try {
                        await toggleTankQuarantine(getId(selectedTank), false);
                        await fetchTanks();
                        setSelectedTank({ ...selectedTank, display_status: 'healthy' });
                      } catch (err: any) {
                        alert(err.response?.data?.detail || 'Failed to remove quarantine');
                      }
                    }}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                  >
                    Lift Quarantine
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      if (!selectedTank) return;
                      try {
                        await toggleTankQuarantine(getId(selectedTank), true);
                        await fetchTanks();
                        setSelectedTank({ ...selectedTank, display_status: 'quarantine' });
                      } catch (err: any) {
                        alert(err.response?.data?.detail || 'Failed to place in quarantine');
                      }
                    }}
                    className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition-colors"
                  >
                    Place in Quarantine
                  </button>
                )}
                
                <button
                  onClick={() => setSelectedTank(null)}
                  className="rounded-md bg-white border border-border px-4 py-2 text-sm font-medium text-textPrimary hover:bg-surface transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Add Tank Modal */}
      {
        isAddOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <form onSubmit={handleAddTank} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-textPrimary">Add New Tank</h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-textSecondary">Tank Number</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 15"
                    value={newTankNumber}
                    onChange={(e) => setNewTankNumber(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-brandBlue focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-textSecondary">Notes (Optional)</label>
                  <textarea
                    rows={2}
                    placeholder="Tank description or operational details..."
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-brandBlue focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-textPrimary hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="rounded-md bg-brandBlue px-4 py-2 text-sm font-semibold text-white hover:bg-brandBlueDark disabled:opacity-50"
                >
                  {addLoading ? 'Adding...' : 'Confirm Tank'}
                </button>
              </div>
            </form>
          </div>
        )
      }
    </div >
  );
};
