export const DFW_NORMALIZED_SCHEMA_VERSION = 1;

const COMPANY_MARKERS = /\b(LLC|L\.L\.C\.?|INC\.?|INCORPORATED|CORP\.?|CORPORATION|LTD\.?|LP|L\.P\.?|LLP|PLLC|COMPANY|CO\.|GROUP|HOLDINGS?|PARTNERS?|PROPERT(?:Y|IES)|REALTY|DEVELOPMENT|CONSTRUCTION|BUILDERS?|SYSTEMS?|UNIVERSITY|COLLEGE|HOSPITAL|MEDICAL CENTER|CHURCH|AUTHORITY|FOUNDATION|ASSOCIATION|BANK|SCHOOL|DISTRICT|TRUST|CITY OF|COUNTY OF)\b/i;

export function cleanText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s || /^(null|n\/a|na|none)$/i.test(s)) return null;
  return s;
}

export function parseNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, zeroIsNull = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[$,%\s,]/g, ''));
  if (!Number.isFinite(n) || n < min || n > max || (zeroIsNull && n === 0)) return null;
  return n;
}

export function parseMoney(value) {
  return parseNumber(value, { min: 0, max: 10_000_000_000, zeroIsNull: true });
}

export function parseDate(value, { now = Date.now(), maxFutureDays = 7 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  let ms = null;
  if (typeof value === 'number' || /^\d{12,13}$/.test(String(value))) {
    ms = Number(value);
  } else {
    const text = String(value).trim();
    const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (m) {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      ms = Date.UTC(year, Number(m[1]) - 1, Number(m[2]));
    } else {
      const parsed = Date.parse(text);
      if (Number.isFinite(parsed)) ms = parsed;
    }
  }
  if (!Number.isFinite(ms)) return null;
  const maxFuture = now + maxFutureDays * 86_400_000;
  if (ms > maxFuture || ms < Date.UTC(1990, 0, 1)) return null;
  return new Date(ms).toISOString();
}

export function canonicalLifecycle(status) {
  const s = (cleanText(status) || '').toLowerCase();
  if (!s) return 'unknown';
  if (/(void|cancel|withdraw|expired|denied|rejected)/.test(s)) return 'voided';
  if (/(finaled|final|complete|closed|certificate.*occupancy|co issued)/.test(s)) return 'final';
  if (/(inspection|construction|issued)/.test(s)) return 'issued';
  if (/(approve|ready.*issue)/.test(s)) return 'approved';
  if (/(plan review|review|routing|correction|revision)/.test(s)) return 'review';
  if (/(pending|submitted|submittal|received|intake|application)/.test(s)) return 'submitted';
  if (/(pre.?application|predevelopment|pre-development)/.test(s)) return 'pre_application';
  return 'unknown';
}

export function isLikelyOrganization(name) {
  const n = cleanText(name);
  if (!n) return false;
  if (COMPANY_MARKERS.test(n)) return true;
  if (/^[A-Z0-9 &.'\-/]{4,}$/.test(n) && !/^[A-Z.' -]+,\s*[A-Z.' -]+$/.test(n)) return true;
  return false;
}

export function normalizeAddress({
  full,
  number,
  prefix,
  street,
  type,
  suffix,
  unit,
  city,
  state = 'TX',
  zip,
} = {}) {
  const fullText = cleanText(full);
  const streetParts = [number, prefix, street, type, suffix].map(cleanText).filter(Boolean);
  let line1 = fullText || cleanText(streetParts.join(' '));
  const unitText = cleanText(unit);
  if (line1 && unitText && !line1.toLowerCase().includes(unitText.toLowerCase())) line1 += ' #' + unitText;
  const cityText = cleanText(city);
  const zipText = cleanText(zip);
  const locality = [cityText, cleanText(state), zipText].filter(Boolean).join(' ');
  const display = [line1, locality].filter(Boolean).join(', ');
  return {
    line1: line1 || null,
    city: cityText || null,
    state: cleanText(state) || null,
    zip: zipText || null,
    display: display || null,
  };
}

export function coordinatesFromText(value) {
  const s = cleanText(value);
  if (!s) return { latitude: null, longitude: null };
  const m = s.match(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/);
  if (!m) return { latitude: null, longitude: null };
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { latitude: null, longitude: null };
  return { latitude, longitude };
}

export function makeParticipant(role, name, extra = {}) {
  const n = cleanText(name);
  if (!n) return null;
  return {
    role,
    name: n,
    organization: isLikelyOrganization(n),
    ...extra,
  };
}

export function makeNormalizedRecord(input) {
  const participants = (input.participants || []).filter(Boolean);
  const org = participants.find((p) => p.organization && ['contractor', 'occupant', 'owner', 'applicant'].includes(p.role));
  return {
    schemaVersion: DFW_NORMALIZED_SCHEMA_VERSION,
    market: input.market,
    state: 'TX',
    jurisdiction: input.jurisdiction,
    sourceKey: input.sourceKey,
    sourceRecordId: cleanText(input.sourceRecordId),
    permitNumber: cleanText(input.permitNumber),
    recordType: cleanText(input.recordType),
    recordSubtype: cleanText(input.recordSubtype),
    recordCategory: cleanText(input.recordCategory),
    statusRaw: cleanText(input.statusRaw),
    statusCanonical: canonicalLifecycle(input.statusRaw),
    fileDate: input.fileDate || null,
    statusDate: input.statusDate || null,
    eventDate: input.eventDate || input.statusDate || input.fileDate || null,
    address: input.address || normalizeAddress(),
    coordinates: input.coordinates || { latitude: null, longitude: null },
    projectName: cleanText(input.projectName),
    workDescription: cleanText(input.workDescription),
    useType: cleanText(input.useType),
    specificUse: cleanText(input.specificUse),
    valuation: input.valuation ?? null,
    units: input.units ?? null,
    squareFeet: input.squareFeet ?? null,
    participants,
    companyCandidate: org?.name || null,
    sourceUrl: input.sourceUrl,
    sourceUpdatedAt: input.sourceUpdatedAt || null,
    retrievedAt: input.retrievedAt || new Date().toISOString(),
    lineage: input.lineage || {},
    raw: input.raw || null,
  };
}

export function toLeadInput(record) {
  const scopeParts = [record.recordType, record.recordSubtype, record.workDescription, record.useType, record.specificUse].filter(Boolean);
  return {
    market: record.market,
    id: record.sourceRecordId || record.permitNumber,
    name: record.projectName || record.specificUse || record.recordSubtype || record.recordType || 'Permit activity',
    address: record.address?.display || record.market + ', TX',
    date: record.eventDate || record.fileDate,
    company: record.companyCandidate,
    scope: scopeParts.join(' · '),
    permit: record.permitNumber,
    permitStatus: record.statusRaw || record.statusCanonical,
    source: record.sourceKey,
    officialValue: record.valuation,
  };
}
