import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, UserCheck, UserX, Shield, Database, Lock, Search, CheckCircle, AlertCircle, RefreshCw, X } from 'lucide-react';
import { formatDate } from '../../utils/formatters';

export const UserManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals state
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [modalType, setModalType] = useState<'role' | 'status' | 'tanks' | 'approve' | null>(null);

  // Form states
  const [newRole, setNewRole] = useState<string>('staff');
  const [assignedTanks, setAssignedTanks] = useState<string[]>([]);
  const [actionError, setActionError] = useState('');

  // 1. Fetch Users List
  const { data: usersList = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['adminUsersList', statusFilter],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const url = statusFilter && statusFilter !== 'all'
        ? `http://localhost:8000/users?status_filter=${statusFilter}`
        : 'http://localhost:8000/users';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch users list');
      return res.json();
    }
  });

  // 2. Fetch Facility Tanks List for Assignment
  const { data: tanksList = [] } = useQuery({
    queryKey: ['facilityTanksForUserMgmt'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:8000/facilities/tanks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return [];
      return res.json();
    }
  });

  // Role Update Mutation
  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:8000/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update role');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
      closeModal();
    },
    onError: (err: any) => setActionError(err.message)
  });

  // Status Update Mutation (Suspend/Reinstate)
  const statusMutation = useMutation({
    mutationFn: async ({ userId, status, reason }: { userId: string; status: string; reason?: string }) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:8000/users/${userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, reason })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update status');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
      closeModal();
    },
    onError: (err: any) => setActionError(err.message)
  });

  // Tank Assignments Mutation
  const tanksMutation = useMutation({
    mutationFn: async ({ userId, tankIds }: { userId: string; tankIds: string[] }) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:8000/users/${userId}/tank-assignments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assigned_tank_ids: tankIds })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update tank assignments');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
      closeModal();
    },
    onError: (err: any) => setActionError(err.message)
  });

  // Approve User Mutation
  const approveMutation = useMutation({
    mutationFn: async ({ userId, role, tankIds }: { userId: string; role: string; tankIds: string[] }) => {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:8000/users/${userId}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role, assigned_tank_ids: tankIds })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to approve user');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
      closeModal();
    },
    onError: (err: any) => setActionError(err.message)
  });

  const closeModal = () => {
    setSelectedUser(null);
    setModalType(null);
    setActionError('');
  };

  const openModal = (user: any, type: 'role' | 'status' | 'tanks' | 'approve') => {
    setSelectedUser(user);
    setModalType(type);
    setActionError('');
    setNewRole(user.role || user.requested_role || 'staff');
    setAssignedTanks(user.assigned_tank_ids || []);
  };

  const toggleTankSelection = (tankId: string) => {
    setAssignedTanks((prev) =>
      prev.includes(tankId) ? prev.filter((id) => id !== tankId) : [...prev, tankId]
    );
  };

  const filteredUsers = usersList.filter((u: any) => {
    const term = searchTerm.toLowerCase();
    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
    const email = (u.email || '').toLowerCase();
    const matches = fullName.includes(term) || email.includes(term);

    if (statusFilter === 'all') return matches;
    return matches && u.status === statusFilter;
  });

  // Summary Metrics
  const activeCount = usersList.filter((u: any) => u.status === 'active').length;
  const pendingCount = usersList.filter((u: any) => u.status === 'pending').length;
  const suspendedCount = usersList.filter((u: any) => u.status === 'suspended').length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-[#005596] flex items-center gap-2">
          <Users className="w-7 h-7 text-[#005596]" />
          User Account &amp; Access Control Management
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Approve pending signups, modify system roles, suspend/reinstate accounts, and grant tank access permissions.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Active Accounts</span>
            <span className="text-3xl font-extrabold text-slate-900 mt-1 block">{activeCount}</span>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <UserCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Pending Approvals</span>
            <span className="text-3xl font-extrabold text-slate-900 mt-1 block">{pendingCount}</span>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <AlertCircle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Suspended Users</span>
            <span className="text-3xl font-extrabold text-slate-900 mt-1 block">{suspendedCount}</span>
          </div>
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <UserX className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by user name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#005596]"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {['all', 'active', 'pending', 'suspended'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-bold capitalize rounded-lg transition-colors ${
                statusFilter === st ? 'bg-[#005596] text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loadingUsers ? (
          <div className="p-12 text-center text-slate-500">
            <div className="animate-spin h-8 w-8 border-4 border-[#005596] border-t-transparent rounded-full mx-auto mb-3" />
            Loading user directory...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No user accounts found matching the filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                  <th className="p-4">User</th>
                  <th className="p-4">Assigned Role</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Tank Access</th>
                  <th className="p-4">Registration Date</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-medium">
                {filteredUsers.map((u: any) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="p-4">
                      <div className="font-bold text-slate-900">{u.first_name} {u.last_name}</div>
                      <div className="text-slate-500 text-[11px]">{u.email}</div>
                    </td>

                    <td className="p-4">
                      {u.role ? (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold capitalize border ${
                          u.role === 'super_admin' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                          u.role === 'chair' || u.role === 'admin' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          u.role === 'manager' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                          'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          <Shield className="w-3 h-3 mr-1" />
                          {u.role.replace(/_/g, ' ')}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Requested: {u.requested_role}</span>
                      )}
                    </td>

                    <td className="p-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold capitalize border ${
                        u.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        u.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        u.status === 'suspended' ? 'bg-red-50 text-red-700 border-red-200' :
                        'bg-slate-100 text-slate-600 border-slate-200'
                      }`}>
                        {u.status}
                      </span>
                    </td>

                    <td className="p-4">
                      {u.assigned_tank_ids && u.assigned_tank_ids.length > 0 ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-[#005596] border border-blue-100">
                          <Database className="w-3 h-3 mr-1" />
                          {u.assigned_tank_ids.length} Tanks Assigned
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">All / General</span>
                      )}
                    </td>

                    <td className="p-4 text-slate-500 font-mono text-[11px]">
                      {formatDate(u.created_at)}
                    </td>

                    <td className="p-4 text-right space-x-2 whitespace-nowrap">
                      {u.status === 'pending' ? (
                        <button
                          onClick={() => openModal(u, 'approve')}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors shadow-sm text-xs"
                        >
                          Review &amp; Approve
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => openModal(u, 'role')}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-[#005596] font-bold rounded-lg border border-blue-200 transition-colors text-xs"
                          >
                            Edit Role
                          </button>

                          <button
                            onClick={() => openModal(u, 'tanks')}
                            className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-200 transition-colors text-xs"
                          >
                            Tanks Access
                          </button>

                          <button
                            onClick={() => openModal(u, 'status')}
                            className={`px-2.5 py-1 font-bold rounded-lg border transition-colors text-xs ${
                              u.status === 'suspended'
                                ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                                : 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200'
                            }`}
                          >
                            {u.status === 'suspended' ? 'Reinstate' : 'Suspend'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Modals */}
      {modalType && selectedUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-[#005596]">
                {modalType === 'approve' && `Approve Registration: ${selectedUser.first_name} ${selectedUser.last_name}`}
                {modalType === 'role' && `Promote / Change Role: ${selectedUser.first_name}`}
                {modalType === 'status' && `Account Status Control: ${selectedUser.first_name}`}
                {modalType === 'tanks' && `Assign Tank Permissions: ${selectedUser.first_name}`}
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg font-semibold">
                {actionError}
              </div>
            )}

            {/* Approve Modal */}
            {modalType === 'approve' && (
              <div className="space-y-4 text-xs font-medium">
                <div>
                  <label className="block text-slate-600 font-bold mb-1">Confirm System Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-lg font-semibold text-slate-800"
                  >
                    <option value="staff">Staff / Technician</option>
                    <option value="manager">Facility Manager</option>
                    <option value="admin">Administrator</option>
                    <option value="chair">ACC Chair</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Assign Tank Access (Optional)</label>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                    {tanksList.map((t: any) => (
                      <label key={t.id} className="flex items-center gap-2 text-slate-700 cursor-pointer p-1 hover:bg-white rounded">
                        <input
                          type="checkbox"
                          checked={assignedTanks.includes(t.id)}
                          onChange={() => toggleTankSelection(t.id)}
                          className="rounded text-[#005596]"
                        />
                        <span>Tank {t.tank_number}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button onClick={closeModal} className="px-4 py-2 bg-slate-100 rounded-lg font-bold">Cancel</button>
                  <button
                    onClick={() => approveMutation.mutate({ userId: selectedUser.id, role: newRole, tankIds: assignedTanks })}
                    disabled={approveMutation.isPending}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold"
                  >
                    {approveMutation.isPending ? 'Approving...' : 'Confirm Approval'}
                  </button>
                </div>
              </div>
            )}

            {/* Role Modal */}
            {modalType === 'role' && (
              <div className="space-y-4 text-xs font-medium">
                <div>
                  <label className="block text-slate-600 font-bold mb-1">Select New System Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-lg font-semibold text-slate-800"
                  >
                    <option value="staff">Staff / Technician</option>
                    <option value="manager">Facility Manager</option>
                    <option value="admin">Administrator</option>
                    <option value="chair">ACC Chair</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button onClick={closeModal} className="px-4 py-2 bg-slate-100 rounded-lg font-bold">Cancel</button>
                  <button
                    onClick={() => roleMutation.mutate({ userId: selectedUser.id, role: newRole })}
                    disabled={roleMutation.isPending}
                    className="px-4 py-2 bg-[#005596] text-white rounded-lg font-bold"
                  >
                    {roleMutation.isPending ? 'Updating...' : 'Save Role'}
                  </button>
                </div>
              </div>
            )}

            {/* Status Modal (Suspend / Reinstate) */}
            {modalType === 'status' && (
              <div className="space-y-4 text-xs font-medium">
                <p className="text-slate-600">
                  Are you sure you want to change status for <strong>{selectedUser.first_name} {selectedUser.last_name}</strong> to{' '}
                  <strong className="uppercase">{selectedUser.status === 'suspended' ? 'ACTIVE' : 'SUSPENDED'}</strong>?
                </p>

                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button onClick={closeModal} className="px-4 py-2 bg-slate-100 rounded-lg font-bold">Cancel</button>
                  <button
                    onClick={() =>
                      statusMutation.mutate({
                        userId: selectedUser.id,
                        status: selectedUser.status === 'suspended' ? 'active' : 'suspended'
                      })
                    }
                    disabled={statusMutation.isPending}
                    className={`px-4 py-2 text-white rounded-lg font-bold ${
                      selectedUser.status === 'suspended' ? 'bg-emerald-600' : 'bg-red-600'
                    }`}
                  >
                    {statusMutation.isPending ? 'Processing...' : selectedUser.status === 'suspended' ? 'Confirm Reinstate' : 'Confirm Suspend'}
                  </button>
                </div>
              </div>
            )}

            {/* Tanks Access Modal */}
            {modalType === 'tanks' && (
              <div className="space-y-4 text-xs font-medium">
                <p className="text-slate-500">Select specific tanks to grant access to this user. Leave empty for all facility tanks.</p>
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                  {tanksList.map((t: any) => (
                    <label key={t.id} className="flex items-center gap-2 text-slate-700 cursor-pointer p-1 hover:bg-white rounded">
                      <input
                        type="checkbox"
                        checked={assignedTanks.includes(t.id)}
                        onChange={() => toggleTankSelection(t.id)}
                        className="rounded text-[#005596]"
                      />
                      <span>Tank {t.tank_number}</span>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button onClick={closeModal} className="px-4 py-2 bg-slate-100 rounded-lg font-bold">Cancel</button>
                  <button
                    onClick={() => tanksMutation.mutate({ userId: selectedUser.id, tankIds: assignedTanks })}
                    disabled={tanksMutation.isPending}
                    className="px-4 py-2 bg-[#005596] text-white rounded-lg font-bold"
                  >
                    {tanksMutation.isPending ? 'Saving...' : 'Save Tank Access'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
