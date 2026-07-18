import { Client, SalesPerson } from '@/lib/types';

// ============================================================
// SEED DATA — replace with Supabase queries when backend is connected.
// ============================================================

export const SALES_TEAM: SalesPerson[] = [
  { id: 'sp-01', name: 'Avery Collins', email: 'avery@trophihospitality.com', role: 'manager' },
  { id: 'sp-02', name: 'Jordan Reyes', email: 'jordan@trophihospitality.com', role: 'sales_rep' },
  { id: 'sp-03', name: 'Sam Whitfield', email: 'sam@trophihospitality.com', role: 'sales_rep' },
];

export const SEED_CLIENTS: Client[] = [
  {
    businessId: 'TRP-4F8K2Q',
    company: 'Harvest & Vine Restaurant Group',
    brands: ['Harvest Table', 'Vine & Barrel'],
    clientType: 'Group',
    locations: [
      { locationId: 'TRP-4F8K2Q-L01', businessId: 'TRP-4F8K2Q', name: 'Harvest Table — Franklin', address: '212 Main St', city: 'Franklin', state: 'TN' },
      { locationId: 'TRP-4F8K2Q-L02', businessId: 'TRP-4F8K2Q', name: 'Vine & Barrel — Nashville', address: '88 Demonbreun St', city: 'Nashville', state: 'TN' },
    ],
    journeyStatus: 'Proposal',
    lastContactDate: '2026-07-14',
    lastContactMethod: 'Video Call',
    contactName: 'Maria Delgado',
    contactEmail: 'maria@harvestvine.com',
    contactPhone: '(615) 555-0142',
    isDecisionMaker: true,
    packageType: 'Growth',
    budget: 48000,
    salesPersonId: 'sp-01',
    leadSource: 'Referral',
    nextFollowUpDate: '2026-07-21',
    notes: [
      {
        id: 'n-001',
        authorName: 'Avery Collins',
        body: 'Walked Maria through the Growth proposal. She wants location-level reporting broken out before the partners meeting on the 22nd.',
        createdAt: '2026-07-14T15:30:00Z',
      },
    ],
    attachments: [],
    activity: [
      { id: 'a-001', type: 'created', description: 'Client created', actor: 'Avery Collins', timestamp: '2026-06-02T10:00:00Z' },
      { id: 'a-002', type: 'status_change', description: 'Status changed: SQL → Proposal', actor: 'Avery Collins', timestamp: '2026-07-10T09:15:00Z' },
      { id: 'a-003', type: 'note_added', description: 'Note added', actor: 'Avery Collins', timestamp: '2026-07-14T15:30:00Z' },
    ],
    createdAt: '2026-06-02T10:00:00Z',
    updatedAt: '2026-07-14T15:30:00Z',
    sentToOnboarding: false,
  },
  {
    businessId: 'TRP-9N3XWV',
    company: 'Blue Ember Hospitality',
    brands: ['Blue Ember Steakhouse'],
    clientType: 'Multi-Location',
    locations: [
      { locationId: 'TRP-9N3XWV-L01', businessId: 'TRP-9N3XWV', name: 'Blue Ember — Brentwood', address: '410 Maryland Way', city: 'Brentwood', state: 'TN' },
      { locationId: 'TRP-9N3XWV-L02', businessId: 'TRP-9N3XWV', name: 'Blue Ember — Murfreesboro', address: '75 Medical Center Pkwy', city: 'Murfreesboro', state: 'TN' },
      { locationId: 'TRP-9N3XWV-L03', businessId: 'TRP-9N3XWV', name: 'Blue Ember — Chattanooga', address: '301 Market St', city: 'Chattanooga', state: 'TN' },
    ],
    journeyStatus: 'Approved',
    lastContactDate: '2026-07-16',
    lastContactMethod: 'Email',
    contactName: 'Derrick Boone',
    contactEmail: 'dboone@blueember.com',
    contactPhone: '(615) 555-0198',
    isDecisionMaker: true,
    packageType: 'Premium',
    budget: 96000,
    salesPersonId: 'sp-02',
    leadSource: 'Trade Show',
    notes: [],
    attachments: [],
    activity: [
      { id: 'a-101', type: 'created', description: 'Client created', actor: 'Jordan Reyes', timestamp: '2026-05-11T14:00:00Z' },
      { id: 'a-102', type: 'status_change', description: 'Status changed: Proposal → Approved · Sent to Onboarding', actor: 'Jordan Reyes', timestamp: '2026-07-16T11:00:00Z' },
    ],
    createdAt: '2026-05-11T14:00:00Z',
    updatedAt: '2026-07-16T11:00:00Z',
    sentToOnboarding: true,
    onboardingSentAt: '2026-07-16T11:00:00Z',
  },
  {
    businessId: 'TRP-2QH7RD',
    company: 'Sunrise Biscuit Co.',
    brands: ['Sunrise Biscuit Co.'],
    clientType: 'Franchisor',
    locations: [
      { locationId: 'TRP-2QH7RD-L01', businessId: 'TRP-2QH7RD', name: 'Sunrise HQ / Flagship', address: '900 Broadway', city: 'Nashville', state: 'TN' },
    ],
    journeyStatus: 'Cold Lead',
    lastContactDate: '2026-07-02',
    lastContactMethod: 'Email',
    contactName: 'Priya Nair',
    contactEmail: 'priya@sunrisebiscuit.com',
    contactPhone: '(629) 555-0110',
    isDecisionMaker: false,
    packageType: 'TBD',
    budget: null,
    salesPersonId: 'sp-03',
    leadSource: 'Outbound',
    nextFollowUpDate: '2026-07-24',
    notes: [],
    attachments: [],
    activity: [
      { id: 'a-201', type: 'created', description: 'Client created', actor: 'Sam Whitfield', timestamp: '2026-07-02T09:00:00Z' },
    ],
    createdAt: '2026-07-02T09:00:00Z',
    updatedAt: '2026-07-02T09:00:00Z',
    sentToOnboarding: false,
  },
];
