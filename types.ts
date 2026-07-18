// ============================================================
// TROPHI PORTAL — DOMAIN TYPES
// Business ID + Location IDs are the mapping keys used across
// every module (CRM → Onboarding → Account Mgmt → Support → Client Portal)
// ============================================================

export type ClientType =
  | 'Independent Location'
  | 'Group'
  | 'Multi-Location'
  | 'Franchise'
  | 'Franchisor';

export type JourneyStatus =
  | 'Cold Lead'
  | 'MQL'
  | 'SQL'
  | 'Proposal'
  | 'Restrictions'
  | 'Approved'
  | 'Unresponsive'
  | 'Last Effort'
  | 'Lost Contact';

export type PackageType =
  | 'Starter'
  | 'Growth'
  | 'Premium'
  | 'Enterprise'
  | 'Custom'
  | 'TBD';

export interface Location {
  locationId: string;      // e.g. TRP-4F8K2Q-L01 — maps to businessId
  businessId: string;
  name: string;
  address: string;
  city: string;
  state: string;
}

export interface ClientNote {
  id: string;
  authorName: string;      // sales person who wrote the note
  body: string;
  createdAt: string;       // ISO timestamp
}

export interface ActivityEvent {
  id: string;
  type: 'status_change' | 'note_added' | 'info_updated' | 'contact_logged' | 'created';
  description: string;
  actor: string;
  timestamp: string;
}

export interface SalesPerson {
  id: string;
  name: string;
  email: string;
  role: 'manager' | 'sales_rep';   // managers see all accounts; reps see only their own
}

export interface Attachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;        // bytes
  dataUrl: string;         // base64 for now — swap for Supabase Storage URL when backend is added
  uploadedBy: string;
  uploadedAt: string;
}

export type ContactMethod = 'Email' | 'Phone' | 'In-Person' | 'Video Call' | 'Text' | 'None';

export interface Client {
  businessId: string;      // e.g. TRP-4F8K2Q — the universal mapping key
  company: string;
  brands: string[];
  clientType: ClientType;
  locations: Location[];
  journeyStatus: JourneyStatus;
  lastContactDate: string;         // ISO date
  lastContactMethod: ContactMethod;
  contactName: string;             // point of contact
  contactEmail: string;
  contactPhone: string;
  isDecisionMaker: boolean;
  packageType: PackageType;
  budget: number | null;           // annual budget in USD, null = unknown
  salesPersonId: string;           // account owner
  leadSource?: string;
  nextFollowUpDate?: string;
  notes: ClientNote[];
  attachments: Attachment[];       // proposals, contracts, decks
  activity: ActivityEvent[];
  createdAt: string;
  updatedAt: string;
  sentToOnboarding: boolean;       // set true automatically when status → Approved
  onboardingSentAt?: string;
}
