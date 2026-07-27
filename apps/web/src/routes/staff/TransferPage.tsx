import React, { useEffect, useState } from 'react';
import { getTanks, getTankAssignments, postTankTransfer } from '../../lib/api';

interface Tank {
  id?: string;
  _id?: string;
  tank_number: string;
  is_quarantined?: boolean;
}


interface TankAssignment {
  id?: string;
  _id?: string;
  tank_id: string;
  project_id: string;
  current_count: number;
  pi_name?: string;
  aupp_number?: string;
}

const getId = (obj: { id?: string; _id?: string }): string => obj.id || obj._id || '';

export const TransferPage: React.FC = () => {
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [assignments, setAssignments] = useState<TankAssignment[]>([]);
  
  const [sourceAssignmentId, setSourceAssignmentId] = useState('');
  const [destTankId, setDestTankId] = useState('');
  const [countStr, setCountStr] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    Promise.all([getTanks(), getTankAssignments()])
      .then(([tRes, aRes]) => {
        setTanks(tRes.data);
        setAssignments(aRes.data);
      })
      .catch(() => {});
  }, []);

  const sourceAssignment = assignments.find(a => getId(a) === sourceAssignmentId);
  const sourceTank = sourceAssignment ? tanks.find(t => getId(t) === sourceAssignment.tank_id) : null;
  const destTank = tanks.find(t => getId(t) === destTankId);

  // Find destination occupant if any
  const destAssignment = assignments.find(a => a.tank_id === destTankId && a.current_count > 0);


  const transferCount = parseInt(countStr, 10) || 0;
  const sourceCurrentCount = sourceAssignment ? sourceAssignment.current_count : 0;
  const destCurrentCount = destAssignment ? destAssignment.current_count : 0;

  const sourceAfter = sourceCurrentCount - transferCount;
  const destAfter = destCurrentCount + transferCount;

  // Validation checks
  const hasAUPPMismatch = destAssignment && sourceAssignment && destAssignment.project_id !== sourceAssignment.project_id;
  const isSourceQuarantined = sourceTank?.is_quarantined;

  const isInvalid =
    !sourceAssignmentId ||
    !destTankId ||
    transferCount <= 0 ||
    transferCount > sourceCurrentCount ||
    hasAUPPMismatch;

  const handleConfirmSubmit = async () => {
    setShowConfirm(false);
    setLoading(true);
    setError('');
    try {
      await postTankTransfer({
        source_assignment_id: sourceAssignmentId,
        destination_tank_id: destTankId,
        count: transferCount,
        notes: notes || undefined,
      });
      setToast('Transfer successful!');
      setCountStr('');
      setNotes('');
      setSourceAssignmentId('');
      setDestTankId('');
      // Reload values
      const [tRes, aRes] = await Promise.all([getTanks(), getTankAssignments()]);
      setTanks(tRes.data);
      setAssignments(aRes.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to complete tank transfer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-textPrimary">Tank Transfers</h1>
        <p className="text-sm text-textSecondary mt-1">
          Move fish safely between tanks. System validation prevents project mix-ups.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!isInvalid) setShowConfirm(true);
          }}
          className="space-y-4"
        >
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-300 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}
          
          {hasAUPPMismatch && (
            <div className="rounded-lg bg-red-50 border border-red-300 text-red-700 px-4 py-3 text-sm flex items-start space-x-2">
              <svg className="h-5 w-5 flex-shrink-0 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div>
                <strong>Transfer Blocked:</strong> The destination tank is currently occupied by a different AUPP project. Fish can only be transferred to empty tanks or tanks with the same AUPP project.
              </div>
            </div>
          )}

          {isSourceQuarantined && !hasAUPPMismatch && destTankId && (
            <div className="rounded-lg bg-yellow-50 border border-yellow-300 text-yellow-800 px-4 py-3 text-sm flex items-start space-x-2">
              <svg className="h-5 w-5 flex-shrink-0 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <strong>Quarantine Warning:</strong> The source tank is currently under quarantine. Transferring these fish will automatically place the destination tank under quarantine with the same dates.
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
                Source Tank Assignment
              </label>
              <select
                value={sourceAssignmentId}
                onChange={(e) => setSourceAssignmentId(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
                required
              >
                <option value="">Select source assignment...</option>
                {assignments
                  .filter((a) => a.current_count > 0)
                  .map((a) => {
                    const t = tanks.find((tk) => getId(tk) === a.tank_id);
                    return (
                      <option key={getId(a)} value={getId(a)}>
                        Tank {t?.tank_number || 'N/A'} — AUPP {a.aupp_number || 'N/A'} (Count: {a.current_count})
                      </option>
                    );
                  })}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
                Destination Tank
              </label>
              <select
                value={destTankId}
                onChange={(e) => setDestTankId(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
                required
              >
                <option value="">Select destination tank...</option>
                {tanks
                  .filter((t) => !sourceAssignment || getId(t) !== sourceAssignment.tank_id)
                  .map((t) => {
                    const da = assignments.find((a) => a.tank_id === getId(t) && a.current_count > 0);
                    const occupantDesc = da ? ` (AUPP: ${da.aupp_number})` : ' (Empty)';
                    return (
                      <option key={getId(t)} value={getId(t)}>
                        Tank {t.tank_number} {occupantDesc}
                      </option>
                    );
                  })}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
              Transfer Count
            </label>
            <input
              type="number"
              min="1"
              max={sourceCurrentCount}
              value={countStr}
              onChange={(e) => setCountStr(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
              Notes
            </label>
            <textarea
              rows={2}
              placeholder="Reason for transfer or redistribution..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
            />
          </div>

          {/* Live Preview section */}
          {sourceAssignmentId && destTankId && (
            <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
              <span className="block text-xs font-bold text-textSecondary uppercase">Transfer Live Preview</span>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 bg-white rounded-lg border border-border space-y-1">
                  <span className="block text-xs font-bold text-textSecondary uppercase">Source (Tank {sourceTank?.tank_number})</span>
                  <div>Current: <strong className="text-textPrimary">{sourceCurrentCount}</strong></div>
                  <div>Transferring: <strong className="text-red-600">-{transferCount}</strong></div>
                  <div className="border-t border-border pt-1 mt-1 font-bold text-brandBlue">
                    Remaining: {sourceAfter}
                  </div>
                </div>

                <div className="p-3 bg-white rounded-lg border border-border space-y-1">
                  <span className="block text-xs font-bold text-textSecondary uppercase">Destination (Tank {destTank?.tank_number})</span>
                  <div>Current: <strong className="text-textPrimary">{destCurrentCount}</strong></div>
                  <div>Receiving: <strong className="text-green-600">+{transferCount}</strong></div>
                  <div className="border-t border-border pt-1 mt-1 font-bold text-brandBlue">
                    Final Count: {destAfter}
                  </div>
                </div>
              </div>

              {destAssignment && destAssignment.project_id !== sourceAssignment?.project_id && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 font-bold">
                  ⚠ Error: Destination tank is occupied by another project (AUPP: {destAssignment.aupp_number}). Mixing projects is forbidden.
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || isInvalid}
            className="w-full rounded-xl bg-brandBlue py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Continue
          </button>
        </form>
      </div>

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-textPrimary">Confirm Fish Transfer</h3>
            <p className="text-sm text-textSecondary">
              Are you sure you want to transfer <strong className="text-textPrimary">{transferCount}</strong> fish from{' '}
              <strong className="text-textPrimary">Tank {sourceTank?.tank_number}</strong> to{' '}
              <strong className="text-textPrimary">Tank {destTank?.tank_number}</strong>?
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-textPrimary hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSubmit}
                className="rounded-md bg-brandBlue px-4 py-2 text-sm font-semibold text-white hover:bg-brandBlueDark"
              >
                Confirm
              </button>
            </div>
          </div>
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

export default TransferPage;
