export type UserRole = 'engineer' | 'admin' | 'qa' | 'site_supervisor' | 'electrician' | 'plumber' | 'flooring_team' | 'sales' | 'architect';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface SafetyCheck {
  id: string;
  task: string;
  createdAt: string;
}

export interface LabourEntry {
  name: string;
  count?: string;
  role: 'Mason' | 'Helper' | 'Electrician' | 'Plumber' | 'Carpenter' | 'Painter';
  jobWork: string;
}

export interface SiteReport {
  id: string;
  engineerId: string;
  engineerName: string;
  engineerRole?: string;
  clientId: string;
  clientName: string;
  timestamp: string;
  dateStr: string;
  images: string[]; // Base64 strings
  aiAnalysis: string;
  currentStage?: string;
  labourEntries?: LabourEntry[];
  safetyChecks?: string[];
  nextStages?: string;
  purposeOfVisit?: string;
  materialReport?: {
    materialType: string;
    images: string[];
    analysis: string;
    remarks?: string;
  };
  location: {
    latitude: number;
    longitude: number;
  };
}

export interface Attendance {
  id: string;
  userId?: string;
  laborName: string;
  isEngineer?: boolean;
  engineerRole?: string;
  type: 'check-in' | 'check-out';
  timestamp: string;
  dateStr: string;
  workDetails?: string;
  labourEntries?: LabourEntry[];
  location: {
    latitude: number;
    longitude: number;
  };
  clientId?: string;
  clientName?: string;
  photoUrl?: string;
  safetyChecks?: string[];
}

export interface Client {
  id: string;
  name: string;
  siteLocation: {
    latitude: number;
    longitude: number;
  };
  currentStage?: string;
  geoFenceRadius?: number;
  createdAt: string;
}

export interface ReportHead {
  id: string;
  title: string;
  role: UserRole;
  createdAt: string;
}

export interface DesignRequirement {
  id: string;
  engineerId: string;
  engineerName: string;
  engineerRole?: string;
  clientId: string;
  clientName: string;
  requirement: string;
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  status: 'Pending' | 'In Progress' | 'Resolved';
  timestamp: string;
}

export const CONSTRUCTION_STAGES = [
  'Excavation',
  'Foundation',
  'Plinth Level',
  'RCC Frame',
  'Brickwork',
  'Plastering',
  'Electrical & Plumbing',
  'Flooring & Tiling',
  'Painting & Finishing',
  'Handover'
] as const;
