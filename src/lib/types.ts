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
  | 'Prospecting'
  | 'MQL'
  | 'SQL'
  | 'Proposal'
  | 'Restrictions'
  | 'Approved'
  | 'Signed'
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

export type ContactRole =
  | 'Owner' | 'Partner' | 'C-Suite' | 'Director'
  | 'Leadership' | 'Manager' | 'Admin' | 'Other';

export type LeadSource =
  | 'Referral' | 'Website' | 'Social Media' | 'Cold Outreach'
  | 'Trade Show / Event' | 'Email Campaign' | 'Paid Ads' | 'Partner'
  | 'Existing Client' | 'Networking' | 'Inbound Call' | 'Other';

export type LocationStatus = 'active' | 'closed';

export interface Location {
  locationId: string;      // e.g. TRP-4F8K2Q-L01 — maps to businessId
  businessId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  status: LocationStatus;  // 'closed' locations keep their ID but are grayed out
  needsOnboarding: boolean;
  closedAt?: string;
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

export type AppRole = 'admin' | 'manager' | 'sales_rep' | 'onboarding_specialist' | 'account_manager' | 'client_admin';

export interface SalesPerson {
  id: string;
  name: string;
  email: string;
  role: AppRole;
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

export interface ContactLog {
  id: string;
  businessId: string;
  contactDate: string;             // ISO date
  method: ContactMethod;
  discussion: string;
  loggedByName: string;
  createdAt: string;
}

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
  contactRole: ContactRole | '';   // role of point of contact
  isDecisionMaker: boolean;
  packageType: PackageType;
  budget: number | null;           // monthly budget PER ACTIVE LOCATION in USD
  salesPersonId: string;           // account owner
  leadSource: LeadSource | '';
  nextFollowUpDate?: string;
  notes: ClientNote[];
  attachments: Attachment[];       // proposals, contracts, decks
  activity: ActivityEvent[];
  contactLogs: ContactLog[];       // structured touchpoint records (new-format; historical entries stay in activity)
  createdAt: string;
  updatedAt: string;
  sentToOnboarding: boolean;       // set true automatically when status → Approved
  onboardingSentAt?: string;
}
