import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, UserCheck, UserX, Shield, Database, Search, AlertCircle, X } from 'lucide-react';
import { formatDate } from '../../utils/formatters';
import {
  getUsers,
  getTanksSummary,
  getTanks,
  updateUserRole,
  updateUserStatus,
  updateTankAssignments,
  approveUser,
} from '../../lib/api';
import { Paginator } from '../../components/ui/Paginator';
import { useAuth } from '../../context/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';

export const UserManagement: React.FC = () => {
  const { user } = useAuth();
  const isAdminOrChair = ['super_admin', 'chair', 'admin'].includes(user?.role || '');
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 350);
  const [statusFilter, setStatusFilter] = useState('all');
  const [userMgmtPage, setUserMgmtPage] = useState(1);

  // Reset page to 1 whenever debounced search term changes
  useEffect(() => {
    setUserMgmtPage(1);
  }, [debouncedSearchTerm]);

  // Modals state
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [modalType, setModalType] = useState<'role' | 'status' | 'tanks' | 'approve' | null>(null);

  // Form states
  const [newRole, setNewRole] = useState<string>('staff');
  const [assignedTanks, setAssignedTanks] = useState<string[]>([]);
  const [actionError, setActionError] = useState('');

  // 1. Fetch Users List (Debounced search prevents excessive API calls)
  const { data: usersResponse, isLoading: loadingUsers } = useQuery({
    queryKey: ['adminUsersList', statusFilter, debouncedSearchTerm, userMgmtPage],
    queryFn: async () => {
      const params: Record<string, any> = { page: userMgmtPage, limit: 20 };
      if (statusFilter && statusFilter !== 'all') {
        params.status_filter = statusFilter;
      }
      if (debouncedSearchTerm && debouncedSearchTerm.trim()) {
        params.search = debouncedSearchTerm.trim();
      }
      const res = await getUsers(params);
      return res.data;
    }
  });


  const usersList = Array.isArray(usersResponse) ? usersResponse : (usersResponse?.items || []);
  const totalPages = Array.isArray(usersResponse) ? 1 : (usersResponse?.total_pages || 1);
  const totalItems = Array.isArray(usersResponse) ? usersList.length : (usersResponse?.total || usersList.length);
  const summary = usersResponse?.summary;
  const allowedRoles = usersResponse?.allowed_assignable_roles || [
    { value: 'staff', label: 'Staff / Technician' },
    { value: 'manager', label: 'Facility Manager' },
    { value: 'admin', label: 'Administrator' },
    { value: 'chair', label: 'ACC Chair' },
    { value: 'super_admin', label: 'Super Admin' }
  ];

  // Summary Metrics from Backend API Summary Object
  const activeCount = summary?.active ?? usersList.filter((u: any) => u.status === 'active').length;
  const pendingCount = summary?.pending ?? usersList.filter((u: any) => u.status === 'pending').length;
  const suspendedCount = summary?.suspended ?? usersList.filter((u: any) => u.status === 'suspended').length;

  // 2. Fetch Facility Tanks List for Assignment
  const { data: tanksList = [] } = useQuery({
    queryKey: ['facilityTanksForUserMgmt'],
    queryFn: async () => {
      try {
        const res = await getTanksSummary();
        return res.data;
      } catch {
        const fallback = await getTanks();
        return fallback.data;
      }
    }
  });

  const sortedTanksList = React.useMemo(() => {
    return [...tanksList].sort((a: any, b: any) => {
      const numA = parseInt(a.tank_number, 10);
      const numB = parseInt(b.tank_number, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return (a.tank_number || '').localeCompare(b.tank_number || '', undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [tanksList]);

  // Role Update Mutation
  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await updateUserRole(userId, role);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
      closeModal();
    },
    onError: (err: any) => setActionError(err.response?.data?.detail || err.message)
  });

  // Status Update Mutation (Suspend/Reinstate)
  const statusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: string; _reason?: string }) => {
      const res = await updateUserStatus(userId, status);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
      closeModal();
    },
    onError: (err: any) => setActionError(err.response?.data?.detail || err.message)
  });

  // Tank Assignments Mutation
  const tanksMutation = useMutation({
    mutationFn: async ({ userId, tankIds }: { userId: string; tankIds: string[] }) => {
      const res = await updateTankAssignments(userId, tankIds);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
      closeModal();
    },
    onError: (err: any) => setActionError(err.response?.data?.detail || err.message)
  });

  // Approve User Mutation
  const approveMutation = useMutation({
    mutationFn: async ({ userId, role, tankIds }: { userId: string; role: string; tankIds: string[] }) => {
      const res = await approveUser(userId, { role, assigned_tank_ids: tankIds });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
      closeModal();
    },
    onError: (err: any) => setActionError(err.response?.data?.detail || err.message)
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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };


  const handleStatusFilterChange = (st: string) => {
    setStatusFilter(st);
    setUserMgmtPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-[#005596] flex items-center gap-2">
          <Users className="w-7 h-7 text-[#005596]" />
          User Account &amp; Access Control Management
        </h1>
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
            onChange={handleSearchChange}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#005596]"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {['all', 'active', 'pending', 'suspended'].map((st) => (
            <button
              key={st}
              onClick={() => handleStatusFilterChange(st)}
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
        ) : usersList.length === 0 ? (
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
                {usersList.map((u: any) => (
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
                      ) : ['super_admin', 'chair', 'admin', 'manager'].includes(u.role) ? (
                        <span className="text-slate-400 italic text-[11px]">All / General</span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">None</span>
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
                          {isAdminOrChair && (
                            <button
                              onClick={() => openModal(u, 'role')}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-[#005596] font-bold rounded-lg border border-blue-200 transition-colors text-xs"
                            >
                              Edit Role
                            </button>
                          )}

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
            <Paginator
              page={userMgmtPage}
              totalPages={totalPages}
              total={totalItems}
              limit={20}
              onPageChange={(p) => setUserMgmtPage(p)}
            />
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
                    disabled={!isAdminOrChair}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-lg font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    {allowedRoles.map((r: any) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Assign Tank Access (Optional)</label>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                    {sortedTanksList.length === 0 ? (
                      <div className="text-center py-3 text-slate-400 italic">No tanks found in facility structure.</div>
                    ) : (
                      sortedTanksList.map((t: any) => {
                        const tId = t.id || t._id;
                        return (
                          <label key={tId} className="flex items-center gap-2 text-slate-700 cursor-pointer p-1 hover:bg-white rounded">
                            <input
                              type="checkbox"
                              checked={assignedTanks.includes(tId)}
                              onChange={() => toggleTankSelection(tId)}
                              className="rounded text-[#005596]"
                            />
                            <span>Tank {t.tank_number}</span>
                          </label>
                        );
                      })
                    )}
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
                    {allowedRoles.map((r: any) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
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
                        userId: selectedUser.id || selectedUser._id,
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
                  {sortedTanksList.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 italic">No tanks found in facility structure.</div>
                  ) : (
                    sortedTanksList.map((t: any) => {
                      const tId = t.id || t._id;
                      return (
                        <label key={tId} className="flex items-center gap-2 text-slate-700 cursor-pointer p-1 hover:bg-white rounded">
                          <input
                            type="checkbox"
                            checked={assignedTanks.includes(tId)}
                            onChange={() => toggleTankSelection(tId)}
                            className="rounded text-[#005596]"
                          />
                          <span>Tank {t.tank_number}</span>
                        </label>
                      );
                    })
                  )}
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
