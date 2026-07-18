import { Client, ClientType, ContactRole, JourneyStatus, LeadSource, PackageType } from './types';
import { CLIENT_TYPES, JOURNEY_STATUSES, PACKAGE_TYPES, CONTACT_ROLES, LEAD_SOURCES } from './statusConfig';
import { generateBusinessId, generateLocationId, uid } from './ids';

// ============================================================
// CSV EXPORT / IMPORT
// Export: one row per client, matching the CRM table headers.
// Import: same column layout; Business/Location IDs are
// auto-generated for every imported row (never trusted from file).
// ============================================================

export const CSV_HEADERS = [
  'Company', 'Brands', 'Client Type', 'Locations', 'Journey Status',
  'Last Contact Date', 'Contact Name', 'Contact Role', 'Email', 'Phone',
  'Decision Maker', 'Package', 'Monthly Budget Per Location', 'Lead Source',
] as const;

function esc(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function clientsToCsv(clients: Client[]): string {
  const rows = clients.map((c) => [
    c.company,
    c.brands.join('; '),
    c.clientType,
    c.locations.map((l) => l.name).join('; '),
    c.journeyStatus,
    c.lastContactDate,
    c.contactName,
    c.contactRole,
    c.contactEmail,
    c.contactPhone,
    c.isDecisionMaker ? 'Yes' : 'No',
    c.packageType,
    c.budget ?? '',
    c.leadSource ?? '',
  ].map(esc).join(','));
  return [CSV_HEADERS.join(','), ...rows].join('\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Minimal RFC-4180-ish parser (handles quoted fields with commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export interface ImportResult {
  clients: Client[];
  skipped: { row: number; reason: string }[];
}

export function csvToClients(
  text: string,
  existingBusinessIds: string[],
  existingCompanyNames: string[],
  defaultSalesPersonId: string,
  actorName: string
): ImportResult {
  const rows = parseCsv(text);
  const skipped: ImportResult['skipped'] = [];
  const clients: Client[] = [];
  if (rows.length < 2) return { clients, skipped: [{ row: 0, reason: 'No data rows found' }] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    company: col('Company'), brands: col('Brands'), type: col('Client Type'),
    locations: col('Locations'), status: col('Journey Status'), lastContact: col('Last Contact Date'),
    contact: col('Contact Name'), email: col('Email'), phone: col('Phone'),
    dm: col('Decision Maker'), pkg: col('Package'), budget: col('Budget'), source: col('Lead Source'),
  };
  if (idx.company === -1) return { clients, skipped: [{ row: 0, reason: 'Missing required "Company" column' }] };

  const usedIds = [...existingBusinessIds];
  const usedNames = existingCompanyNames.map((n) => n.trim().toLowerCase());

  rows.slice(1).forEach((r, i) => {
    const rowNum = i + 2;
    const get = (j: number) => (j >= 0 && r[j] !== undefined ? r[j].trim() : '');
    const company = get(idx.company);
    if (!company) { skipped.push({ row: rowNum, reason: 'Missing company name' }); return; }
    if (usedNames.includes(company.toLowerCase())) {
      skipped.push({ row: rowNum, reason: `Duplicate of existing client "${company}"` });
      return;
    }

    const businessId = generateBusinessId(usedIds);
    usedIds.push(businessId);
    usedNames.push(company.toLowerCase());

    const typeRaw = get(idx.type);
    const clientType = (CLIENT_TYPES.find((t) => t.toLowerCase() === typeRaw.toLowerCase()) ?? 'Independent Location') as ClientType;
    const statusRaw = get(idx.status);
    const journeyStatus = (JOURNEY_STATUSES.find((s) => s.toLowerCase() === statusRaw.toLowerCase()) ?? 'Cold Lead') as JourneyStatus;
    const pkgRaw = get(idx.pkg);
    const packageType = (PACKAGE_TYPES.find((p) => p.toLowerCase() === pkgRaw.toLowerCase()) ?? 'TBD') as PackageType;
    const locNames = get(idx.locations).split(';').map((s) => s.trim()).filter(Boolean);
    if (locNames.length === 0) locNames.push(`${company} — Main`);
    const budgetRaw = get(idx.budget).replace(/[$,]/g, '');
    const now = new Date().toISOString();

    clients.push({
      businessId,
      company,
      brands: get(idx.brands).split(';').map((s) => s.trim()).filter(Boolean),
      clientType,
      locations: locNames.map((name, li) => ({
        locationId: generateLocationId(businessId, li),
        businessId, name, address: '', city: '', state: '',
        status: 'active' as const, needsOnboarding: false,
      })),
      journeyStatus,
      lastContactDate: get(idx.lastContact) || now.slice(0, 10),
      lastContactMethod: 'None',
      contactName: get(idx.contact),
      contactEmail: get(idx.email),
      contactPhone: get(idx.phone),
      isDecisionMaker: /^(yes|y|true|1)$/i.test(get(idx.dm)),
      packageType,
      budget: budgetRaw && !isNaN(Number(budgetRaw)) ? Number(budgetRaw) : null,
      salesPersonId: defaultSalesPersonId,
      leadSource: get(idx.source) || 'CSV Import',
      notes: [],
      attachments: [],
      activity: [{
        id: uid(), type: 'created',
        description: `Imported from CSV · ${locNames.length} location${locNames.length > 1 ? 's' : ''} registered`,
        actor: actorName, timestamp: now,
      }],
      createdAt: now,
      updatedAt: now,
      sentToOnboarding: journeyStatus === 'Approved',
      onboardingSentAt: journeyStatus === 'Approved' ? now : undefined,
    });
  });

  return { clients, skipped };
}
