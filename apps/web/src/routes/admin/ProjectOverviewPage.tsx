import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, AlertTriangle, Search, Calendar, Users, Activity, Plus, X } from 'lucide-react';
import SpeciesDropdown from '../../components/SpeciesDropdown';
import { closeProject } from '../../lib/api';

export const ProjectOverviewPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed' | 'expiring'>('all');
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formError, setFormError] = useState('');

  // Close Project State
  const [closeModalProject, setCloseModalProject] = useState<any | null>(null);
  const [dispositionType, setDispositionType] = useState<'euthanized' | 'adopted' | 'transferred_external' | 'other'>('euthanized');
  const [dispositionNotes, setDispositionNotes] = useState('');
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeError, setCloseError] = useState('');

  const handleCloseProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closeModalProject) return;
    const pid = closeModalProject.id || closeModalProject._id;
    setCloseSubmitting(true);
    setCloseError('');
    try {
      await closeProject(pid, {
        disposition_type: dispositionType,
        notes: dispositionNotes || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['projectsOverview'] });
      setCloseModalProject(null);
      setSelectedProject(null);
    } catch (err: any) {
      setCloseError(err.response?.data?.detail || 'Failed to close project');
    } finally {
      setCloseSubmitting(false);
    }
  };

  // New Project Form State
  const [newProject, setNewProject] = useState({
    title: '',
    pi_name: '',
    aupp_number: '',
    species: '',
    sex: 'both' as 'both' | 'male' | 'female',
    dob: '',
    established_date: new Date().toISOString().slice(0, 10),
    source: '',
    aupp_expiry_date: '',
    room_number: '',
    rfid_tracking_enabled: false,
  });

  const createProjectMutation = useMutation({
    mutationFn: async (payload: typeof newProject) => {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:8000/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...payload,
          dob: payload.dob || undefined,
          aupp_expiry_date: payload.aupp_expiry_date ? new Date(payload.aupp_expiry_date).toISOString() : undefined,
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create project');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectsOverview'] });
      setShowCreateModal(false);
      setFormError('');
      setNewProject({
        title: '',
        pi_name: '',
        aupp_number: '',
        species: '',
        sex: 'both',
        dob: '',
        established_date: new Date().toISOString().slice(0, 10),
        source: '',
        aupp_expiry_date: '',
        room_number: '',
        rfid_tracking_enabled: false,
      });
    },
    onError: (err: any) => {
      setFormError(err.message || 'Error creating project');
    }
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // All fields except DOB are compulsory
    if (
      !newProject.title.trim() ||
      !newProject.pi_name.trim() ||
      !newProject.aupp_number.trim() ||
      !newProject.species.trim() ||
      !newProject.sex ||
      !newProject.established_date ||
      !newProject.source.trim() ||
      !newProject.aupp_expiry_date ||
      !newProject.room_number.trim()
    ) {
      setFormError('All fields except Date of Birth (DOB) are compulsory.');
      return;
    }

    createProjectMutation.mutate(newProject);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['projectsOverview'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:8000/projects/overview', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch projects overview');
      return res.json();
    }
  });

  const projects = data?.projects || [];

  const filteredProjects = projects.filter((p: any) => {
    const matchesSearch =
      p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.pi_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.aupp_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.species.toLowerCase().includes(searchTerm.toLowerCase());

    if (statusFilter === 'active') return matchesSearch && p.status === 'active';
    if (statusFilter === 'closed') return matchesSearch && p.status === 'closed';
    if (statusFilter === 'expiring') return matchesSearch && p.is_expiring;
    return matchesSearch;
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#005596] flex items-center gap-2">
            <BookOpen className="w-7 h-7 text-[#005596]" />
            Research Projects & Protocol Overview
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            High-level monitoring of active Animal Use Protocol Numbers (AUPP#), allocated animal census, and compliance status.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-[#005596] hover:bg-[#002B51] text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow transition-colors flex items-center gap-2 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Create Project
        </button>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Projects</span>
            <div className="p-2 bg-blue-50 text-[#005596] rounded-lg">
              <BookOpen className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-900 mt-2">{data?.active_projects || 0}</p>
          <span className="text-xs text-slate-500 mt-1 block">Out of {data?.total_projects || 0} total protocols</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Expiring / Expired AUPP</span>
            <div className={`p-2 rounded-lg ${
              (data?.expiring_soon || 0) > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
            }`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-900 mt-2">{data?.expiring_soon || 0}</p>
          <span className="text-xs text-amber-600 font-medium mt-1 block">Requires protocol renewal</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Allocated Fish</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-900 mt-2">
            {projects.reduce((sum: number, p: any) => sum + (p.total_animals || 0), 0)}
          </p>
          <span className="text-xs text-slate-500 mt-1 block">Across active tank assignments</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Project Incidents</span>
            <div className="p-2 bg-red-50 text-red-600 rounded-lg">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-900 mt-2">
            {projects.reduce((sum: number, p: any) => sum + (p.total_incidents || 0), 0)}
          </p>
          <span className="text-xs text-slate-500 mt-1 block">Total flags logged</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search title, PI, AUPP# or species..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#005596]"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              statusFilter === 'all' ? 'bg-[#005596] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Projects ({projects.length})
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              statusFilter === 'active' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Active ({data?.active_projects || 0})
          </button>
          <button
            onClick={() => setStatusFilter('expiring')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              statusFilter === 'expiring' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Expiring / Alert ({data?.expiring_soon || 0})
          </button>
          <button
            onClick={() => setStatusFilter('closed')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              statusFilter === 'closed' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Closed ({data?.closed_projects || 0})
          </button>
        </div>
      </div>

      {/* Projects Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="animate-spin h-8 w-8 border-4 border-[#005596] border-t-transparent rounded-full mx-auto mb-3" />
            Loading project data...
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No projects match the selected filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <th className="p-4">Project Title & AUPP</th>
                  <th className="p-4">Principal Investigator</th>
                  <th className="p-4">Species</th>
                  <th className="p-4">Tanks Assigned</th>
                  <th className="p-4">Live Census</th>
                  <th className="p-4">Incidents / Deaths</th>
                  <th className="p-4">AUPP Expiry</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredProjects.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-900">{p.title}</div>
                      <div className="text-xs font-mono text-slate-500 mt-0.5">AUPP# {p.aupp_number}</div>
                    </td>
                    <td className="p-4 font-semibold text-slate-700">{p.pi_name}</td>
                    <td className="p-4 text-slate-600 capitalize">{p.species}</td>
                    <td className="p-4 font-medium text-slate-800">{p.assigned_tanks_count} tanks</td>
                    <td className="p-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {p.total_animals} fish
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="text-xs space-y-0.5">
                        <span className="font-medium text-slate-700">{p.total_incidents} Incidents</span>
                        <span className="text-slate-400 block">{p.total_mortality} Deaths</span>
                      </div>
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold ${
                        p.is_expiring ? 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse' : 'bg-slate-100 text-slate-700'
                      }`}>
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(p.aupp_expiry_date)}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => setSelectedProject(p)}
                        className="px-3 py-1.5 text-xs font-semibold bg-brandBlueTint text-brandBlueDark hover:bg-[#005596] hover:text-white rounded-lg transition-colors"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Project Detail Modal */}
      {selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase mb-1 ${
                  selectedProject.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {selectedProject.status}
                </span>
                <h3 className="text-xl font-bold text-[#005596]">{selectedProject.title}</h3>
                <span className="text-xs font-mono text-slate-400">AUPP# {selectedProject.aupp_number}</span>
              </div>
              <button
                onClick={() => setSelectedProject(null)}
                className="text-slate-400 hover:text-slate-600 text-base font-bold p-1"
              >
                ✕
              </button>
            </div>

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                <span className="block text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Total Fish Count</span>
                <span className="text-xl font-extrabold text-emerald-700 mt-1 block">
                  {selectedProject.total_fish_count ?? selectedProject.total_animals ?? 0} Fish
                </span>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                <span className="block text-[10px] font-bold text-blue-800 uppercase tracking-wider">Occupied Tanks</span>
                <span className="text-xl font-extrabold text-blue-700 mt-1 block">
                  {selectedProject.assigned_tanks_count || 0} Tanks
                </span>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
                <span className="block text-[10px] font-bold text-amber-800 uppercase tracking-wider">Quarantine Status</span>
                <span className="text-xl font-extrabold text-amber-700 mt-1 block">
                  {selectedProject.occupied_tanks?.filter((t: any) => t.is_quarantined).length || 0} Quarantined
                </span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tracking Mode</span>
                <span className="text-xs font-bold text-slate-800 mt-2 block">
                  {selectedProject.rfid_tracking_enabled ? 'RFID Individual' : 'Population Count'}
                </span>
              </div>
            </div>

            {selectedProject.is_expiring && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-xs text-amber-800 font-medium">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                This protocol is expiring soon ({formatDate(selectedProject.aupp_expiry_date)}). Please prepare renewal docs.
              </div>
            )}

            {/* Complete Project Details Grid */}
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 border-b border-slate-100 pb-1">
                Project Protocol & Specifications
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Principal Investigator</span>
                  <span className="font-semibold text-slate-800">{selectedProject.pi_name}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">AUPP Protocol #</span>
                  <span className="font-semibold text-slate-800">{selectedProject.aupp_number}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Species</span>
                  <span className="font-semibold text-slate-800 capitalize">{selectedProject.species}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Sex</span>
                  <span className="font-semibold text-slate-800 capitalize">{selectedProject.sex || 'N/A'}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Date of Birth (DOB)</span>
                  <span className="font-semibold text-slate-800">{formatDate(selectedProject.dob)}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Established Date</span>
                  <span className="font-semibold text-slate-800">{formatDate(selectedProject.established_date)}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Source</span>
                  <span className="font-semibold text-slate-800">{selectedProject.source || 'N/A'}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">AUPP Expiry Date</span>
                  <span className="font-semibold text-slate-800">{formatDate(selectedProject.aupp_expiry_date)}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Room Number (RM#)</span>
                  <span className="font-semibold text-slate-800">RM {selectedProject.room_number || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* Currently Occupied Tanks */}
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 border-b border-slate-100 pb-1">
                Currently Occupied Tanks ({selectedProject.occupied_tanks?.length || 0})
              </h4>
              {selectedProject.occupied_tanks && selectedProject.occupied_tanks.length > 0 ? (
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
                      {selectedProject.occupied_tanks.map((t: any) => (
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
                                Quarantined {t.quarantine_end_date ? `(until ${formatDate(t.quarantine_end_date)})` : ''}
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

            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => {
                    const pid = selectedProject.id || selectedProject._id;
                    setSelectedProject(null);
                    navigate(`/admin/projects/${pid}/report`);
                  }}
                  className="w-full sm:w-auto px-4 py-2 bg-[#005596] hover:bg-blue-800 text-white text-xs font-bold rounded-lg shadow transition-colors"
                >
                  View Full Project Audit &amp; Comprehensive Report
                </button>
                {selectedProject.status === 'active' && (
                  <button
                    onClick={() => {
                      setCloseModalProject(selectedProject);
                      setDispositionType('euthanized');
                      setDispositionNotes('');
                      setCloseError('');
                    }}
                    className="w-full sm:w-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow transition-colors"
                  >
                    Close Project &amp; Disposition
                  </button>
                )}
              </div>
              <button
                onClick={() => setSelectedProject(null)}
                className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Project Modal */}
      {closeModalProject && (
        <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase bg-red-100 text-red-800 mb-1">
                  Project Termination / Closure
                </span>
                <h3 className="text-xl font-bold text-red-900">{closeModalProject.title}</h3>
                <span className="text-xs font-mono text-slate-500">AUPP# {closeModalProject.aupp_number}</span>
              </div>
              <button
                onClick={() => setCloseModalProject(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-1 text-xs text-amber-900">
              <div className="font-bold flex items-center gap-1.5 text-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-600" /> Confirm Final Project Closure
              </div>
              <p>
                Closing this project will set all remaining fish counts to 0, mark occupied tanks as <strong>Empty</strong>, and record a final project closure audit event.
              </p>
              <div className="pt-1 flex gap-4 font-semibold text-amber-800">
                <span>Remaining Fish: {closeModalProject.total_fish_count ?? closeModalProject.total_animals ?? 0}</span>
                <span>Occupied Tanks: {closeModalProject.occupied_tanks?.length || 0}</span>
              </div>
            </div>

            <form onSubmit={handleCloseProjectSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-600 block">
                  Fish Disposition Method <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
                    dispositionType === 'euthanized' ? 'border-red-500 bg-red-50/50 text-red-900 font-bold' : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}>
                    <input
                      type="radio"
                      name="disposition"
                      value="euthanized"
                      checked={dispositionType === 'euthanized'}
                      onChange={(e) => setDispositionType(e.target.value as any)}
                      className="text-red-600 focus:ring-red-500"
                    />
                    <div className="text-xs">
                      <div>Euthanized</div>
                      <div className="text-[10px] font-normal text-slate-500">Protocol Termination</div>
                    </div>
                  </label>

                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
                    dispositionType === 'adopted' ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 font-bold' : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}>
                    <input
                      type="radio"
                      name="disposition"
                      value="adopted"
                      checked={dispositionType === 'adopted'}
                      onChange={(e) => setDispositionType(e.target.value as any)}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="text-xs">
                      <div>Adopted</div>
                      <div className="text-[10px] font-normal text-slate-500">Approved Adoption</div>
                    </div>
                  </label>

                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
                    dispositionType === 'transferred_external' ? 'border-indigo-500 bg-indigo-50/50 text-indigo-900 font-bold' : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}>
                    <input
                      type="radio"
                      name="disposition"
                      value="transferred_external"
                      checked={dispositionType === 'transferred_external'}
                      onChange={(e) => setDispositionType(e.target.value as any)}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="text-xs">
                      <div>Transferred</div>
                      <div className="text-[10px] font-normal text-slate-500">External Lab / Off-site</div>
                    </div>
                  </label>

                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
                    dispositionType === 'other' ? 'border-slate-500 bg-slate-100 text-slate-900 font-bold' : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}>
                    <input
                      type="radio"
                      name="disposition"
                      value="other"
                      checked={dispositionType === 'other'}
                      onChange={(e) => setDispositionType(e.target.value as any)}
                      className="text-slate-600 focus:ring-slate-500"
                    />
                    <div className="text-xs">
                      <div>Other</div>
                      <div className="text-[10px] font-normal text-slate-500">Custom Details</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-600 block">
                  Disposition &amp; Closure Notes
                </label>
                <textarea
                  value={dispositionNotes}
                  onChange={(e) => setDispositionNotes(e.target.value)}
                  placeholder="Describe the final disposition procedure, SOP guidelines followed, or transfer recipient..."
                  className="w-full border border-slate-200 rounded-xl p-3 text-xs focus:ring-2 focus:ring-red-500 focus:outline-none min-h-[80px]"
                />
              </div>

              {closeError && (
                <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-semibold">
                  {closeError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCloseModalProject(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={closeSubmitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow transition-colors disabled:opacity-50"
                >
                  {closeSubmitting ? 'Closing Project...' : 'Confirm & Close Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#005596]">Create New Research Project</h3>
                <p className="text-xs text-slate-500">Project Protocol & Specifications Form</p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs font-medium">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-slate-600 font-bold mb-1">Project Protocol &amp; Specifications Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Freshwater Ecology Behavioral Analysis"
                    value={newProject.title}
                    onChange={(e) => setNewProject({ ...newProject, title: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-[#005596]"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Principal Investigator (PI) *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. PI-1"
                    value={newProject.pi_name}
                    onChange={(e) => setNewProject({ ...newProject, pi_name: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-[#005596]"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">AUPP Protocol # *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 26-01"
                    value={newProject.aupp_number}
                    onChange={(e) => setNewProject({ ...newProject, aupp_number: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-[#005596]"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Species *</label>
                  <SpeciesDropdown
                    species={newProject.species}
                    setSpecies={(val) => setNewProject({ ...newProject, species: val })}
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Sex *</label>
                  <select
                    value={newProject.sex}
                    onChange={(e) => setNewProject({ ...newProject, sex: e.target.value as any })}
                    className="w-full p-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-[#005596]"
                  >
                    <option value="both">Both (Male &amp; Female)</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Date of Birth (DOB) <span className="font-normal text-slate-400">(optional)</span></label>
                  <input
                    type="date"
                    value={newProject.dob}
                    onChange={(e) => setNewProject({ ...newProject, dob: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-[#005596]"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Established Date *</label>
                  <input
                    type="date"
                    required
                    value={newProject.established_date}
                    onChange={(e) => setNewProject({ ...newProject, established_date: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-[#005596]"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Source *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Hatched / External Supplier Co"
                    value={newProject.source}
                    onChange={(e) => setNewProject({ ...newProject, source: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-[#005596]"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">AUPP Expiry Date *</label>
                  <input
                    type="date"
                    required
                    value={newProject.aupp_expiry_date}
                    onChange={(e) => setNewProject({ ...newProject, aupp_expiry_date: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-[#005596]"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Room Number (RM#) *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. RM 1 / RM 301"
                    value={newProject.room_number}
                    onChange={(e) => setNewProject({ ...newProject, room_number: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-[#005596]"
                  />
                </div>

                <div className="sm:col-span-2 pt-2 border-t border-slate-100">
                  <label className="flex items-center gap-2 cursor-pointer p-3 bg-slate-50 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={newProject.rfid_tracking_enabled}
                      onChange={(e) => setNewProject({ ...newProject, rfid_tracking_enabled: e.target.checked })}
                      className="w-4 h-4 text-[#005596] rounded border-slate-300 focus:ring-[#005596]"
                    />
                    <div>
                      <span className="block text-xs font-bold text-slate-800">Enable RFID / Individual Tracking</span>
                      <span className="block text-[11px] text-slate-500">Switch this project from population counts to individual fish scanning mode.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createProjectMutation.isPending}
                  className="px-5 py-2 rounded-xl bg-[#005596] hover:bg-blue-800 text-white font-bold text-xs shadow transition-colors flex items-center gap-2"
                >
                  {createProjectMutation.isPending ? 'Creating Project...' : 'Save & Initialize Protocol'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
