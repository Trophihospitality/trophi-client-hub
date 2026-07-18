import { JourneyStatus, ClientType, PackageType } from './types';

// ============================================================
// CUSTOMER JOURNEY STATUS — ordered pipeline + color coding
// Colors reference CSS variables defined in index.css so the
// palette can be re-branded in one place.
// ============================================================

export const JOURNEY_STATUSES: JourneyStatus[] = [
  'Cold Lead',
  'MQL',
  'SQL',
  'Proposal',
  'Restrictions',
  'Approved',
  'Unresponsive',
  'Last Effort',
  'Lost Contact',
];

interface StatusStyle {
  label: JourneyStatus;
  cssVar: string;          // HSL var name in index.css
  description: string;
}

export const STATUS_CONFIG: Record<JourneyStatus, StatusStyle> = {
  'Cold Lead':     { label: 'Cold Lead',     cssVar: '--status-cold',         description: 'Identified, not yet engaged' },
  'MQL':           { label: 'MQL',           cssVar: '--status-mql',          description: 'Marketing qualified lead' },
  'SQL':           { label: 'SQL',           cssVar: '--status-sql',          description: 'Sales qualified lead' },
  'Proposal':      { label: 'Proposal',      cssVar: '--status-proposal',     description: 'Proposal sent / in review' },
  'Restrictions':  { label: 'Restrictions',  cssVar: '--status-restrictions', description: 'Blocked — contract, budget, or timing' },
  'Approved':      { label: 'Approved',      cssVar: '--status-approved',     description: 'Signed — auto-sent to Onboarding' },
  'Unresponsive':  { label: 'Unresponsive',  cssVar: '--status-unresponsive', description: 'No reply after multiple attempts' },
  'Last Effort':   { label: 'Last Effort',   cssVar: '--status-lasteffort',   description: 'Final outreach before closing out' },
  'Lost Contact':  { label: 'Lost Contact',  cssVar: '--status-lostcontact',  description: 'Closed — no path forward' },
};

/** Inline styles for a status badge (solid tint + readable text). */
export function statusBadgeStyle(status: JourneyStatus): React.CSSProperties {
  const v = STATUS_CONFIG[status].cssVar;
  return {
    backgroundColor: `hsl(var(${v}) / 0.12)`,
    color: `hsl(var(${v}))`,
    border: `1px solid hsl(var(${v}) / 0.35)`,
  };
}

/** Solid dot color for compact indicators. */
export function statusDotStyle(status: JourneyStatus): React.CSSProperties {
  return { backgroundColor: `hsl(var(${STATUS_CONFIG[status].cssVar}))` };
}

export const CLIENT_TYPES: ClientType[] = [
  'Independent Location',
  'Group',
  'Multi-Location',
  'Franchise',
  'Franchisor',
];

export const PACKAGE_TYPES: PackageType[] = [
  'Starter',
  'Growth',
  'Premium',
  'Enterprise',
  'Custom',
  'TBD',
];

export const CONTACT_ROLES = [
  'Owner', 'Partner', 'C-Suite', 'Director',
  'Leadership', 'Manager', 'Admin', 'Other',
] as const;

export const LEAD_SOURCES = [
  'Referral', 'Website', 'Social Media', 'Cold Outreach',
  'Trade Show / Event', 'Email Campaign', 'Paid Ads', 'Partner',
  'Existing Client', 'Networking', 'Inbound Call', 'Other',
] as const;

export const US_STATES: readonly { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];
export const US_STATE_CODES = US_STATES.map((s) => s.code);

// ============================================================
// DEAL FORECASTING — stage win probabilities
// Weighted forecast = budget × probability of the current stage.
// Tune these as real close rates become known.
// ============================================================
export const STAGE_PROBABILITY: Record<JourneyStatus, number> = {
  'Cold Lead': 0.05,
  'MQL': 0.15,
  'SQL': 0.30,
  'Proposal': 0.60,
  'Restrictions': 0.40,
  'Approved': 1.0,
  'Unresponsive': 0.10,
  'Last Effort': 0.05,
  'Lost Contact': 0,
};

/** Statuses that count as an active, workable pipeline. */
export const ACTIVE_STATUSES: JourneyStatus[] = [
  'Cold Lead', 'MQL', 'SQL', 'Proposal', 'Restrictions', 'Unresponsive', 'Last Effort',
];

// ============================================================
// FOLLOW-UP / OVERDUE RULES
// A client "needs attention" when their scheduled follow-up date
// has passed, or when an active lead hasn't been contacted in
// STALE_CONTACT_DAYS.
// ============================================================
export const STALE_CONTACT_DAYS = 14;

export function isOverdue(client: {
  journeyStatus: JourneyStatus;
  nextFollowUpDate?: string;
  lastContactDate: string;
}): { overdue: boolean; reason: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (client.nextFollowUpDate && client.nextFollowUpDate < today) {
    return { overdue: true, reason: `Follow-up was due ${client.nextFollowUpDate}` };
  }
  if (ACTIVE_STATUSES.includes(client.journeyStatus) && client.lastContactDate) {
    const days = Math.floor((Date.now() - new Date(client.lastContactDate).getTime()) / 86400000);
    if (days > STALE_CONTACT_DAYS) {
      return { overdue: true, reason: `No contact in ${days} days` };
    }
  }
  return { overdue: false, reason: '' };
}
