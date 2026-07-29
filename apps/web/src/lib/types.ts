export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface UserRecord {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  requested_role: string | null;
  role: string | null;
  status: string;
  assigned_tank_ids: string[];
  approved_by?: string;
  approved_at?: string;
  created_at?: string;
}

export interface AuditLogEntry {
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  timestamp: string;
}

export interface Tank {
  id?: string;
  _id?: string;
  room_id: string;
  tank_number: string;
  status: string;
  notes?: string;
  is_quarantined?: boolean;
  quarantine_start_date?: string;
  quarantine_end_date?: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  pi_name: string;
  aupp_number: string;
  species?: string;
  sex?: string;
  status: 'active' | 'closed';
  aupp_expiry_date?: string;
  is_expiring?: boolean;
  assigned_tanks_count?: number;
  total_animals?: number;
  total_fish_count?: number;
  total_incidents?: number;
  total_mortality?: number;
  room_number?: string;
  rfid_tracking_enabled?: boolean;
  created_at?: string;
}

export interface QuarantineExemptionItem {
  id: string;
  tank_id: string;
  target_tank_id: string;
  fish_count: number;
  reason: string;
  urgency: string;
  status: string;
  requested_by: string;
  requested_by_name?: string;
  decided_by?: string;
  decided_by_name?: string;
  requested_at?: string;
  rejection_reason?: string;
}
