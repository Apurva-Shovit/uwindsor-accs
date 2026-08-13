import axios from 'axios';
import { getToken } from './session';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const detail = error.response?.data?.detail;
    const message = typeof detail === 'string' ? detail : 'An unexpected server error occurred';
    window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
    return Promise.reject(error);
  }
);

export default api;

// Auth APIs
export const signup = (data: any) => api.post('/auth/signup', data);
export const login = (data: any) => api.post('/auth/login', data);
export const logout = () => api.post('/auth/logout');
export const getMe = () => api.get('/auth/me');

// User Management APIs
export const getUsers = (params?: { status_filter?: string; search?: string; page?: number; limit?: number }) =>
  api.get('/users', { params });

export const getPending = () => api.get('/users/pending');
export const approveUser = (id: string, body: any) => api.patch(`/users/${id}/approve`, body);
export const rejectUser = (id: string, reason: string) => api.patch(`/users/${id}/reject`, { reason });
export const updateUserRole = (id: string, role: string) => api.patch(`/users/${id}/role`, { role });
export const updateUserStatus = (id: string, status: string) => api.patch(`/users/${id}/status`, { status });
export const updateTankAssignments = (id: string, tank_ids: string[]) =>
  api.patch(`/users/${id}/tank-assignments`, { assigned_tank_ids: tank_ids });

// Facilities, Rooms, and Tanks APIs
export const getFacilities = () => api.get('/facilities-structure/facilities');
export const getRooms = (facilityId?: string) => api.get('/facilities-structure/rooms', { params: { facility_id: facilityId } });
export const getTanks = (roomId?: string) => api.get('/facilities-structure/tanks', { params: { room_id: roomId } });
export const getTanksSummary = () => api.get('/facilities-structure/tanks/summary');
export const createTank = (data: any) => api.post('/facilities-structure/tanks', data);
export const updateTankStatus = (id: string, status: string) => api.patch(`/facilities-structure/tanks/${id}`, { status });
export const deleteTank = (id: string) => api.delete(`/facilities-structure/tanks/${id}`);
export const toggleTankQuarantine = (id: string, is_quarantined: boolean) => api.post(`/facilities-structure/tanks/${id}/quarantine`, { is_quarantined });

// Water Quality Logs
export const postWaterQualityLog = (data: any) => api.post('/water-quality-logs', data);
export const postWaterQualityBatch = (data: any) => api.post('/water-quality-logs/batch', data);
export const getWaterQualityLogs = (params?: { tank_id?: string; page?: number; limit?: number }) =>
  api.get('/water-quality-logs', { params });

// Incident Reports
export const postIncidentReport = (data: any) => api.post('/incident-reports', data);
export const getIncidentReports = (params?: { vet_contacted?: boolean; tank_id?: string; page?: number; limit?: number }) =>
  api.get('/incident-reports', { params });

// Projects
export const getSpecies = () => api.get('/species/');
export const createSpecies = (data: any) => api.post('/species', data);
export const getProjects = (params?: { status_filter?: string; page?: number; limit?: number }) =>
  api.get('/projects', { params });
export const getProjectsOverview = (params?: { search?: string; status?: string }) =>
  api.get('/projects/overview', { params });

export const getProject = (id: string) => api.get(`/projects/${id}`);
export const getProjectDetails = (id: string) => api.get(`/projects/${id}/details`);
export const getProjectReport = (
  id: string, 
  timePeriod: string = 'all', 
  page: number = 1, 
  limit: number = 10,
  startDate?: string,
  endDate?: string
) => 
  api.get(`/projects/${id}/report`, { params: { time_period: timePeriod, page, limit, start_date: startDate || undefined, end_date: endDate || undefined } });
export const createProject = (data: any) => api.post('/projects', data);
export const closeProject = (id: string, data: any) => api.post(`/projects/${id}/close`, data);

// Tank Assignments & Intake
export const getTankAssignments = (tankId?: string) =>
  api.get('/tank-assignments', { params: tankId ? { tank_id: tankId } : {} });
export const postFishIntake = (data: any) => api.post('/intake', data);

// Census & Transfers
export const postCensusEvent = (data: any) => api.post('/census-events', data);
export const postTankTransfer = (data: any) => api.post('/tank-transfers', data);
export const getTankAssignmentHistory = (id: string) => api.get(`/tank-assignments/${id}/history`);
export const getTankHistory = (id: string, days?: number) =>
  api.get(`/facilities-structure/tanks/${id}/history`, { params: days ? { days } : {} });

export const searchTankHistory = (params: Record<string, any>) =>
  api.get('/facilities-structure/tanks/history/search', { params });

// Quarantine Exemptions
export const getQuarantineExemptions = (params?: { status_filter?: string; page?: number; limit?: number }) =>
  api.get('/quarantine/exemptions', { params });
export const postExemptionRequest = (data: any) => api.post('/quarantine/exemption-request', data);
export const decideExemption = (id: string, data: any) => api.patch(`/quarantine/exemption/${id}/decide`, data);

// Audit Logs & Reports
export const getAuditLogs = (params?: Record<string, any>) => api.get('/audit-logs', { params });
export const getReportsSummary = (params?: Record<string, any>) => api.get('/reports/summary', { params });
export const getExecutiveSummary = (params?: Record<string, any>) => api.get('/reports/executive-facility-summary', { params });

// Notifications
export const getNotifications = (window: 'all' | 'recent' = 'all') =>
  api.get('/notifications', { params: { window } });
export const markNotificationsRead = (body: { keys?: string[]; all?: boolean }) =>
  api.post('/notifications/mark-read', body);

// Dashboard
export const getDashboardSummary = () => api.get('/dashboard/summary');
export const getWaterQualityAnalytics = (params?: Record<string, any>) => api.get('/dashboard/water-quality-analytics', { params });

// Data Export & Backup
export const getExportPreview = (params?: { start_date?: string; end_date?: string }) =>
  api.get('/export/preview', { params });

export const downloadExport = (params: { start_date?: string; end_date?: string; format: 'json' | 'csv' }) =>
  api.get('/export/backup', { params, responseType: 'blob' });
