import React, { useState, useEffect } from 'react';
import { getPending, approveUser, rejectUser, getTanks } from '../lib/api';
import { Check, X, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface PendingUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  requested_role: string;
  created_at: string;
}

interface TankItem {
  id: string;
  tank_number: string;
}

export const ApprovalQueueTable: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [allTanks, setAllTanks] = useState<TankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal state for approve
  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null);
  const [targetRole, setTargetRole] = useState('');
  const [selectedTankIds, setSelectedTankIds] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  // Reject state
  const [rejectUserObj, setRejectUserObj] = useState<PendingUser | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchPendingAndTanks = async () => {
    setLoading(true);
    setError('');
    try {
      const [pendingRes, tanksRes] = await Promise.all([
        getPending(),
        getTanks()
      ]);
      setPendingUsers(pendingRes.data);
      setAllTanks(tanksRes.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingAndTanks();
  }, []);

  const handleOpenApproveModal = (u: PendingUser) => {
    setSelectedUser(u);
    setTargetRole(u.requested_role);
    setSelectedTankIds([]);
  };

  const handleConfirmApprove = async () => {
    if (!selectedUser) return;
    setActionLoading(true);
    try {
      await approveUser(selectedUser.id, {
        role: targetRole,
        facility_ids: [],
        room_ids: [],
        // Ensure no null or undefined IDs are sent
        assigned_tank_ids: selectedTankIds.filter((id) => Boolean(id)),
      });
      setSelectedUser(null);
      await fetchPendingAndTanks();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to approve user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectUserObj) return;
    if (!rejectReason.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }
    setActionLoading(true);
    try {
      await rejectUser(rejectUserObj.id, rejectReason);
      setRejectUserObj(null);
      setRejectReason('');
      await fetchPendingAndTanks();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to reject user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleTank = (tankId: string, isChecked: boolean) => {
    setSelectedTankIds((prev) => {
      if (isChecked) {
        // Add only if not already present to avoid duplicates
        return prev.includes(tankId) ? prev : [...prev, tankId];
      }
      // Remove the tankId when unchecked
      return prev.filter((id) => id !== tankId);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-textPrimary">User Approval Queue</h2>
          <p className="text-sm text-textSecondary">Review and manage incoming registration requests.</p>
        </div>
        <button
          onClick={fetchPendingAndTanks}
          className="rounded-md bg-white border border-border px-3 py-1.5 text-sm font-medium text-textPrimary hover:bg-surface"
        >
          Refresh
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-danger">{error}</div>}

      {loading ? (
        <div className="flex py-12 justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brandBlue border-t-transparent"></div>
        </div>
      ) : pendingUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-white p-12 text-center">
          <UserCheck className="mb-2 h-10 w-10 text-brandGrey" />
          <h3 className="text-base font-semibold text-textPrimary">No Pending Requests</h3>
          <p className="text-sm text-textSecondary">All user approval requests have been processed.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-textSecondary">Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-textSecondary">Email</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-textSecondary">Requested Role</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-textSecondary">Requested On</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-textSecondary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white text-sm">
              {pendingUsers.map((u) => (
                <tr key={u.id} className="hover:bg-surface/50">
                  <td className="whitespace-nowrap px-6 py-4 font-medium text-textPrimary">
                    {u.first_name} {u.last_name}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-textSecondary">{u.email}</td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="inline-flex rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-warning">
                      {u.requested_role}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-textSecondary">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right space-x-2">
                    <button
                      onClick={() => handleOpenApproveModal(u)}
                      className="inline-flex items-center rounded-md bg-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => setRejectUserObj(u)}
                      className="inline-flex items-center rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pending Quarantine Exemption Requests Section */}
      <PendingQuarantineExemptionsSection />
    </div>
  );
};

const PendingQuarantineExemptionsSection: React.FC = () => {
  const [exemptions, setExemptions] = useState<any[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchExemptions = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const [exRes, tanksRes] = await Promise.all([
        fetch('http://localhost:8000/quarantine/exemptions?status_filter=pending', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch('http://localhost:8000/facilities-structure/tanks/summary', {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      if (exRes.ok) {
        const data = await exRes.json();
        setExemptions(data);
      }
      if (tanksRes.ok) {
        const tData = await tanksRes.json();
        setTanks(tData);
      }
    } catch (err) {
      console.error('Failed to load pending exemptions', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExemptions();
  }, []);

  const handleDecide = async (id: string, approved: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:8000/quarantine/exemption/${id}/decide`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ approved })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to decide exemption request');
      }
      fetchExemptions();
    } catch (err: any) {
      alert(err.message || 'Error processing exemption decision');
    }
  };

  return (
    <div className="space-y-4 pt-6 border-t border-slate-200">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Quarantine Transfer Exemption Requests</h2>
          <p className="text-sm text-slate-500">Review and authorize special fish transfers out of quarantine isolations.</p>
        </div>
        <button
          onClick={fetchExemptions}
          className="rounded-md bg-white border border-border px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh Queue
        </button>
      </div>

      {loading ? (
        <div className="flex py-6 justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-600 border-t-transparent"></div>
        </div>
      ) : exemptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-500 italic">No pending quarantine transfer exemption requests.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
              <tr>
                <th className="px-4 py-3 text-left">Requested Date</th>
                <th className="px-4 py-3 text-left">Source → Target Tank</th>
                <th className="px-4 py-3 text-left">Fish Count</th>
                <th className="px-4 py-3 text-left">Urgency</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {exemptions.map((ex: any) => {
                const exId = ex.id || ex._id;
                const sourceNum = tanks.find((t: any) => (t.id || t._id) === ex.tank_id)?.tank_number || 'Unknown';
                const targetNum = tanks.find((t: any) => (t.id || t._id) === ex.target_tank_id)?.tank_number || 'Unknown';
                return (
                  <tr key={exId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {new Date(ex.requested_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900">
                      Tank {sourceNum} → Tank {targetNum}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#005596]">
                      {ex.fish_count || ex.count} fish
                    </td>
                    <td className="px-4 py-3 uppercase text-xs font-bold text-amber-600">
                      {ex.urgency}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                      {ex.reason}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => handleDecide(exId, true)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-md shadow-sm transition-colors"
                      >
                        Accept &amp; Transfer
                      </button>
                      <button
                        onClick={() => handleDecide(exId, false)}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-md shadow-sm transition-colors"
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Approve Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-textPrimary">Approve User Request</h3>
            <p className="text-sm text-textSecondary">
              Approving account for <strong className="text-textPrimary">{selectedUser.first_name} {selectedUser.last_name}</strong> ({selectedUser.email})
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-textSecondary">Confirm/Assign Role</label>
                <select
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-brandBlue focus:outline-none"
                >
                  {currentUser?.role === 'super_admin' && (
                    <>
                      <option value="chair">Chair</option>
                      <option value="admin">Admin</option>
                    </>
                  )}
                  <option value="manager">Manager</option>
                  <option value="staff">Staff</option>
                </select>
              </div>

              {targetRole === 'staff' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold uppercase text-textSecondary">
                      Assign Tanks Access
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTankIds(allTanks.map((t) => t.id || (t as any)._id || ''))}
                        className="text-xs text-brandBlue hover:underline"
                      >
                        Select All
                      </button>
                      <span className="text-xs text-textSecondary">·</span>
                      <button
                        type="button"
                        onClick={() => setSelectedTankIds([])}
                        className="text-xs text-textSecondary hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 border border-border rounded-md p-3 max-h-48 overflow-y-auto bg-surface">
                    {allTanks.map((t) => {
                      const tankId = t.id || (t as any)._id || '';
                      return (
                        <div key={tankId} className="flex items-center gap-2 p-1.5 rounded hover:bg-white transition-colors">
                          <input
                            id={`appr-tank-${tankId}`}
                            type="checkbox"
                            value={tankId}
                            checked={selectedTankIds.includes(tankId)}
                            onChange={(e) => handleToggleTank(tankId, e.target.checked)}
                            className="h-4 w-4 flex-shrink-0 rounded border-border text-brandBlue focus:ring-brandBlue cursor-pointer"
                          />
                          <label
                            htmlFor={`appr-tank-${tankId}`}
                            className="text-sm font-medium text-textPrimary cursor-pointer select-none"
                          >
                            Tank {t.tank_number}
                          </label>
                        </div>
                      );
                    })}
                    {allTanks.length === 0 && (
                      <span className="text-xs text-textSecondary col-span-2">No active tanks available</span>
                    )}
                  </div>
                  {selectedTankIds.length > 0 && (
                    <p className="mt-1 text-xs text-textSecondary">{selectedTankIds.length} tank(s) selected</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                onClick={() => setSelectedUser(null)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-textPrimary hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmApprove}
                disabled={actionLoading}
                className="rounded-md bg-success px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {actionLoading ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectUserObj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-textPrimary">Reject User Request</h3>
            <p className="text-sm text-textSecondary">
              Rejecting account for <strong className="text-textPrimary">{rejectUserObj.first_name} {rejectUserObj.last_name}</strong>
            </p>

            <div>
              <label className="block text-xs font-semibold uppercase text-textSecondary">Rejection Reason</label>
              <textarea
                rows={3}
                placeholder="Reason for rejecting user access request..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-brandBlue focus:outline-none"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                onClick={() => setRejectUserObj(null)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-textPrimary hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReject}
                disabled={actionLoading}
                className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
