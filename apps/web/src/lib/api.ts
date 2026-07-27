import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:8000' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');   // NOTE: fine for local demo only
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;

export const signup = (data: any) => api.post('/auth/signup', data);
export const login = (data: any) => api.post('/auth/login', data);
export const getMe = () => api.get('/auth/me');
export const getPending = () => api.get('/users/pending');
export const approveUser = (id: string, body: any) => api.patch(`/users/${id}/approve`, body);
export const rejectUser = (id: string, reason: string) => api.patch(`/users/${id}/reject`, { reason });

export interface Tank {
  id?: string;
  _id?: string;
  room_id: string;
  tank_number: string;
  status: string;
  notes?: string;
  is_quarantined?: boolean;
}

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
export const getWaterQualityLogs = (tankId?: string) =>
  api.get('/water-quality-logs', { params: tankId ? { tank_id: tankId } : {} });

// Incident Reports
export const postIncidentReport = (data: any) => api.post('/incident-reports', data);
export const getIncidentReports = (params?: { vet_contacted?: boolean; tank_id?: string }) =>
  api.get('/incident-reports', { params });

// Projects
export const getSpecies = () => api.get('/species/');
export const createSpecies = (data: any) => api.post('/species', data);
export const getProjects = () => api.get('/projects');
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
export const getTankHistory = (id: string) => api.get(`/facilities-structure/tanks/${id}/history`);



