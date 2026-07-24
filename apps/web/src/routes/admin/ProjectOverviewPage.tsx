import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, AlertTriangle, CheckCircle, Search, Calendar, Users, Activity, FileText } from 'lucide-react';

export const ProjectOverviewPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed' | 'expiring'>('all');
  const [selectedProject, setSelectedProject] = useState<any | null>(null);

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
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-[#005596] flex items-center gap-2">
          <BookOpen className="w-7 h-7 text-[#005596]" />
          Research Projects & Protocol Overview
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          High-level monitoring of active Animal Use Protocol Numbers (AUPP#), allocated animal census, and compliance status.
        </p>
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
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#005596]">{selectedProject.title}</h3>
                <span className="text-xs font-mono text-slate-400">AUPP# {selectedProject.aupp_number}</span>
              </div>
              <button
                onClick={() => setSelectedProject(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase block">Principal Investigator</span>
                <span className="font-semibold text-slate-800">{selectedProject.pi_name}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase block">Species</span>
                <span className="font-semibold text-slate-800 capitalize">{selectedProject.species}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase block">Assigned Tanks</span>
                <span className="font-semibold text-slate-800">{selectedProject.assigned_tanks_count} Tanks</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase block">Live Fish Count</span>
                <span className="font-semibold text-emerald-600">{selectedProject.total_animals} Fish</span>
              </div>
            </div>

            {selectedProject.is_expiring && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-xs text-amber-800 font-medium">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                This protocol is expiring soon ({formatDate(selectedProject.aupp_expiry_date)}). Please prepare renewal docs.
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedProject(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
