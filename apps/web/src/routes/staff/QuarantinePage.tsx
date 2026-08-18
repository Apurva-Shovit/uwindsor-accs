import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, ShieldAlert, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { parseApiDate, formatQuarantineRemaining } from '../../utils/formatters';
import type { QuarantineTone } from '../../utils/formatters';
import {
  getTanksSummary,
  getQuarantineExemptions,
  postExemptionRequest,
  toggleTankQuarantine,
  decideExemption,
} from '../../lib/api';
import { Paginator } from '../../components/ui/Paginator';

const REMAINING_BADGE_STYLES: Record<QuarantineTone, string> = {
  steady: 'bg-amber-200 text-amber-800',
  soon: 'bg-orange-200 text-orange-900',
  urgent: 'bg-red-100 text-red-700 border border-red-300',
  critical: 'bg-red-600 text-white animate-pulse',
  expired: 'bg-slate-200 text-slate-700',
};

export const QuarantinePage: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSourceTank, setSelectedSourceTank] = useState('');
  const [targetTankId, setTargetTankId] = useState('');
  const [transferCount, setTransferCount] = useState(1);
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState('normal');
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);

  const { user } = useAuth();
  const isManagerPlus = ['super_admin', 'admin', 'chair', 'manager'].includes(user?.role || '');

  const [liftModalTank, setLiftModalTank] = useState<any>(null);
  const [liftVerification, setLiftVerification] = useState('');

  // Approving an exemption moves fish, so the decision has to be in flight only
  // once: a second click while the first request is open would transfer twice.
  const [deciding, setDeciding] = useState<{ id: string; approved: boolean } | null>(null);

  // The countdown now resolves down to the minute, so it has to tick rather than
  // only recomputing when the tank query happens to refetch.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch tanks
  const { data: tanks, refetch: refetchTanks } = useQuery({
    queryKey: ['tanksList'],
    queryFn: async () => {
      const res = await getTanksSummary();
      return res.data;
    }
  });

  const sortedTanks = React.useMemo(() => {
    return [...(tanks || [])].sort((a: any, b: any) => {
      const numA = parseInt(a.tank_number, 10);
      const numB = parseInt(b.tank_number, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return (a.tank_number || '').localeCompare(b.tank_number || '', undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [tanks]);

  // The backend releases a tank on the next read once its window closes, so pull
  // fresh data the moment the countdown runs out instead of leaving an "Expired"
  // card on screen until someone reloads. Keyed on the transition rather than on
  // `now`, so a tank that fails to release does not retry every second.
  const hasElapsedWindow = React.useMemo(
    () => (tanks || []).some((t: any) => {
      if (!t.is_quarantined) return false;
      const end = parseApiDate(t.quarantine_end_date);
      return !!end && end.getTime() <= now.getTime();
    }),
    [tanks, now],
  );

  useEffect(() => {
    if (hasElapsedWindow) refetchTanks();
  }, [hasElapsedWindow, refetchTanks]);

  // Fetch exemptions history
  const { data: exemptionsResponse, refetch: refetchExemptions } = useQuery({
    queryKey: ['quarantineExemptions', page],
    queryFn: async () => {
      const res = await getQuarantineExemptions({ page, limit: 20 });
      return res.data;
    }
  });

  const exemptions = Array.isArray(exemptionsResponse) ? exemptionsResponse : (exemptionsResponse?.items || []);
  const totalExemptions = Array.isArray(exemptionsResponse) ? exemptions.length : (exemptionsResponse?.total || 0);
  const totalPages = Array.isArray(exemptionsResponse) ? 1 : (exemptionsResponse?.total_pages || 1);

  const handleRequestExemption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSourceTank || !targetTankId || !reason.trim()) return;

    setSubmitting(true);
    try {
      await postExemptionRequest({
        tank_id: selectedSourceTank,
        target_tank_id: targetTankId,
        fish_count: Number(transferCount),
        reason,
        urgency,
      });
      setIsModalOpen(false);
      setReason('');
      refetchExemptions();
    } catch (err: any) {
      alert(err.response?.data?.detail || err.message || 'Error requesting exemption');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmLiftQuarantine = async () => {
    if (!liftModalTank) return;
    if (liftVerification !== `TANK ${liftModalTank.tank_number}`) {
      alert("Verification failed. Please type the exact text.");
      return;
    }

    try {
      await toggleTankQuarantine(liftModalTank.id || liftModalTank._id, false);
      refetchTanks();
      setLiftModalTank(null);
    } catch (err: any) {
      alert(err.response?.data?.detail || err.message || 'Error lifting quarantine');
    }
  };

  const handleDecideExemption = async (exemptionId: string, approved: boolean) => {
    if (deciding) return;

    setDeciding({ id: exemptionId, approved });
    try {
      await decideExemption(exemptionId, { approved });
      // Wait for the refreshed list before releasing the buttons, so the row has
      // already flipped out of "pending" by the time it becomes clickable again.
      await Promise.all([refetchExemptions(), refetchTanks()]);
    } catch (err: any) {
      // The request was rejected before anything moved, so the row stays pending
      // and both buttons come back for another attempt.
      alert(err.response?.data?.detail || err.message || 'Error deciding exemption');
    } finally {
      setDeciding(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#005596] flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-amber-600" />
            14-Day Mandatory Quarantine Monitor
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Tracking isolation windows for newly acquired fish. Transfers are restricted during active quarantine unless authorized by Admin/Chair.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-4 py-2 rounded-lg text-sm shadow-sm transition-colors flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4" />
          Request Special Transfer Exemption
        </button>
      </div>

      {/* Active Quarantined Tanks */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
          <Clock className="w-5 h-5 text-[#005596]" />
          Currently Quarantined Tanks
        </h2>

        {!tanks ? (
          <div className="text-center py-4 text-slate-400 text-sm italic">Loading tanks...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedTanks.filter((t: any) => t.is_quarantined === true).map((t: any) => {
              const start = parseApiDate(t.quarantine_start_date);
              const end = parseApiDate(t.quarantine_end_date);
              const remaining = formatQuarantineRemaining(end, now);

              return (
                <div key={t.id || t._id} className="border border-amber-200 bg-amber-50 rounded-lg p-4 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-amber-900 text-lg">Tank {t.tank_number}</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${REMAINING_BADGE_STYLES[remaining.tone]}`}>
                      {remaining.label}
                    </span>
                  </div>
                  <div className="text-xs text-amber-700">
                    <div><strong>Started:</strong> {start ? start.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-'}</div>
                    <div><strong>Ends:</strong> {end ? end.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-'}</div>
                  </div>
                  {isManagerPlus && (
                    <button
                      onClick={() => {
                        setLiftModalTank(t);
                        setLiftVerification('');
                      }}
                      className="mt-2 text-xs font-bold w-full bg-white text-amber-700 border border-amber-300 py-1.5 rounded hover:bg-amber-100 transition-colors"
                    >
                      Lift Quarantine
                    </button>
                  )}
                </div>
              );
            })}
            {sortedTanks.filter((t: any) => t.is_quarantined === true).length === 0 && (
              <div className="col-span-full text-center py-4 text-slate-400 text-sm italic">
                No tanks are currently in quarantine.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quarantine Exemption Requests Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-3">
          Special Exemption Requests History & Decision Queue
        </h2>

        {!exemptions || exemptions.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm italic">
            No quarantine exemption requests filed.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <th className="p-3">Requested Date</th>
                  <th className="p-3">Source &amp; Target Tank</th>
                  <th className="p-3">Fish Count</th>
                  <th className="p-3">Urgency</th>
                  <th className="p-3">Reason</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Authorized / Decision By</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {exemptions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-sm font-medium text-slate-500">
                      No exemption requests found.
                    </td>
                  </tr>
                ) : (
                  exemptions.map((ex: any) => {
                    const exId = ex.id || ex._id;
                    return (
                      <tr key={exId} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-medium text-slate-900 whitespace-nowrap">
                          {new Date(ex.requested_at).toLocaleDateString()}
                        </td>
                        <td className="p-3 font-semibold text-slate-700">
                          Tank {tanks?.find((t: any) => (t.id || (t as any)._id) === ex.tank_id)?.tank_number || 'Unknown'} → Tank {tanks?.find((t: any) => (t.id || (t as any)._id) === ex.target_tank_id)?.tank_number || 'Unknown'}
                        </td>
                        <td className="p-3 font-bold text-slate-800">{ex.fish_count || ex.count} fish</td>
                        <td className="p-3 uppercase text-xs font-bold text-amber-600">{ex.urgency}</td>
                        <td className="p-3 text-slate-600 text-xs max-w-xs">{ex.reason}</td>
                        <td className="p-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${ex.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                              ex.status === 'rejected' ? 'bg-red-50 text-red-700 border border-red-200' :
                                'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                            }`}>
                            {ex.status === 'approved' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                            {ex.status === 'rejected' && <XCircle className="w-3.5 h-3.5 text-red-600" />}
                            {ex.status === 'pending' && <Clock className="w-3.5 h-3.5 text-amber-600" />}
                            {ex.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3 whitespace-nowrap text-xs">
                          {ex.status === 'pending' ? (
                            <span className="text-slate-400 italic">Pending Review</span>
                          ) : ex.status === 'approved' ? (
                            <div>
                              <span className="font-bold text-emerald-800">Approved by: {ex.decided_by_name || 'System Admin'}</span>
                              {ex.decided_at && (
                                <span className="block text-[10px] text-slate-500 font-mono">
                                  {new Date(ex.decided_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div>
                              <span className="font-bold text-red-800">Rejected by: {ex.decided_by_name || 'System Admin'}</span>
                              {ex.decided_at && (
                                <span className="block text-[10px] text-slate-500 font-mono">
                                  {new Date(ex.decided_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap space-x-2">
                          {ex.status === 'pending' && isManagerPlus ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={() => handleDecideExemption(exId, true)}
                                disabled={!!deciding}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-xs shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
                              >
                                {deciding?.id === exId && deciding.approved ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Transferring...
                                  </>
                                ) : (
                                  <>Accept &amp; Transfer</>
                                )}
                              </button>
                              <button
                                onClick={() => handleDecideExemption(exId, false)}
                                disabled={!!deciding}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded text-xs shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600"
                              >
                                {deciding?.id === exId && !deciding.approved ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Rejecting...
                                  </>
                                ) : (
                                  <>Reject</>
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">
                              {ex.status === 'approved' ? 'Transferred' : ex.status === 'rejected' ? 'Rejected' : 'No Action'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <Paginator
              page={page}
              totalPages={totalPages}
              total={totalExemptions}
              limit={20}
              onPageChange={(p) => setPage(p)}
            />
          </div>
        )}
      </div>

      {/* Exemption Request Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleRequestExemption} className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-[#005596] flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Quarantine Transfer Exemption Request
            </h3>
            <p className="text-xs text-slate-500">
              Provide justification for moving fish out of mandatory 14-day quarantine prior to isolation expiration.
            </p>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Source Quarantine Tank</label>
                <select
                  value={selectedSourceTank}
                  onChange={(e) => setSelectedSourceTank(e.target.value)}
                  required
                  className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-[#005596]"
                >
                  <option value="">Select Quarantined Tank</option>
                  {sortedTanks.filter((t: any) => t.is_quarantined === true).map((t: any) => (
                    <option key={t.id || t._id} value={t.id || t._id}>
                      Tank {t.tank_number} - {t.count} fish (AUPP: {t.aupp})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Target Destination Tank</label>
                <select
                  value={targetTankId}
                  onChange={(e) => setTargetTankId(e.target.value)}
                  required
                  className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-[#005596]"
                >
                  <option value="">Select Destination Tank</option>
                  {sortedTanks.filter((t: any) => t.is_quarantined !== true).map((t: any) => (
                    <option key={t.id || t._id} value={t.id || t._id}>
                      Tank {t.tank_number} - {t.count} fish (AUPP: {t.aupp})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Fish Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={transferCount}
                    onChange={(e) => setTransferCount(Number(e.target.value))}
                    required
                    className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-[#005596]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Urgency Level</label>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-[#005596]"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Justification Reason</label>
                <textarea
                  rows={3}
                  placeholder="Explain why early transfer out of quarantine is necessary..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#005596]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Lift Quarantine Modal */}
      {liftModalTank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-500" />
              Manual Quarantine Lift
            </h3>
            <p className="text-sm text-slate-600">
              You are about to bypass the 14-day mandatory quarantine for <strong>Tank {liftModalTank.tank_number}</strong>. This action is audited.
            </p>
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <label className="block text-xs font-bold text-slate-700 uppercase mb-2">
                Type <span className="text-red-600 select-all">TANK {liftModalTank.tank_number}</span> to verify
              </label>
              <input
                type="text"
                value={liftVerification}
                onChange={(e) => setLiftVerification(e.target.value)}
                placeholder={`TANK ${liftModalTank.tank_number}`}
                className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-red-500 text-sm"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setLiftModalTank(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmLiftQuarantine}
                disabled={liftVerification !== `TANK ${liftModalTank.tank_number}`}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-all"
              >
                Confirm Lift
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
