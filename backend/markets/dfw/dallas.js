import { DFW_SOURCES } from './sources.js';
import {
  cleanText,
  makeNormalizedRecord,
  makeParticipant,
  normalizeAddress,
  parseDate,
  parseMoney,
  parseNumber,
} from './normalize.js';

const LEGACY_FIELDS = ['permit_number','permit_type','issued_date','mapsco','contractor','value','area','work_description','land_use','street_address','zip_code'];

export function normalizeDallasHistoricalPermit(a, { now = Date.now() } = {}) {
  const eventDate = parseDate(a.issued_date, { now, maxFutureDays: 0 });
  return makeNormalizedRecord({
    market: 'Dallas',
    jurisdiction: 'City of Dallas',
    sourceKey: DFW_SOURCES.dallasHistoricalPermits.key,
    sourceRecordId: a.permit_number,
    permitNumber: a.permit_number,
    recordType: a.permit_type,
    statusRaw: 'Issued',
    fileDate: eventDate,
    statusDate: eventDate,
    eventDate,
    address: normalizeAddress({ full: a.street_address, city: 'Dallas', state: 'TX', zip: a.zip_code }),
    projectName: null,
    workDescription: a.work_description,
    useType: a.land_use,
    valuation: parseMoney(a.value),
    squareFeet: parseNumber(a.area, { min: 0, max: 1_000_000_000, zeroIsNull: true }),
    participants: [makeParticipant('contractor', contractorNameFromLegacy(a.contractor))],
    sourceUrl: DFW_SOURCES.dallasHistoricalPermits.url,
    lineage: { permitNumber: 'permit_number', recordType: 'permit_type', eventDate: 'issued_date', contractor: 'contractor', valuation: 'value', squareFeet: 'area', workDescription: 'work_description', useType: 'land_use', address: 'street_address/zip_code' },
    raw: a,
  });
}

export function normalizeDallasNowRecord(a, { now = Date.now(), sourceKey = DFW_SOURCES.dallasNow.key } = {}) {
  const fileDate = parseDate(a.fileDate ?? a.submittedDate ?? a.applicationDate, { now, maxFutureDays: 2 });
  const statusDate = parseDate(a.statusDate ?? a.issuedDate ?? a.updatedDate, { now, maxFutureDays: 2 });
  const address = normalizeAddress({
    full: a.address ?? a.siteAddress,
    number: a.houseNumber,
    prefix: a.direction,
    street: a.streetName,
    type: a.streetType,
    unit: a.unitNumber,
    city: a.city || 'Dallas',
    state: a.state || 'TX',
    zip: a.zipCode,
  });
  return makeNormalizedRecord({
    market: 'Dallas',
    jurisdiction: 'City of Dallas',
    sourceKey,
    sourceRecordId: a.recordId ?? a.recordNumber ?? a.permitNumber,
    permitNumber: a.permitNumber ?? a.recordNumber,
    recordType: a.recordType,
    recordSubtype: a.recordSubtype,
    recordCategory: a.recordCategory,
    statusRaw: a.status,
    fileDate,
    statusDate,
    eventDate: statusDate || fileDate,
    address,
    projectName: a.projectName,
    workDescription: a.workDescription ?? a.description,
    useType: a.useType ?? a.landUse,
    specificUse: a.specificUse,
    valuation: parseMoney(a.valuation ?? a.jobValue),
    units: parseNumber(a.units, { min: 0, max: 1_000_000 }),
    squareFeet: parseNumber(a.squareFeet ?? a.area, { min: 0, max: 1_000_000_000, zeroIsNull: true }),
    participants: [
      makeParticipant('contractor', a.contractorName),
      makeParticipant('owner', a.ownerName),
      makeParticipant('applicant', a.applicantName),
      makeParticipant('occupant', a.occupantName),
    ],
    sourceUrl: DFW_SOURCES.dallasNow.url,
    lineage: a.lineage || {},
    raw: a,
  });
}

export async function fetchDallasHistoricalPermits({ limit = 5000, offset = 0, commercialOnly = true, fetchFn = fetch } = {}) {
  const params = new URLSearchParams({
    '$limit': String(Math.min(Math.max(limit, 1), 50_000)),
    '$offset': String(Math.max(offset, 0)),
    '$select': LEGACY_FIELDS.join(','),
    '$order': 'issued_date DESC,permit_number DESC',
  });
  if (commercialOnly) params.set('$where', "upper(permit_type) like '%COMMERCIAL%' OR upper(permit_type) like '%MULTI FAMILY%'");
  const response = await fetchFn(`${DFW_SOURCES.dallasHistoricalPermits.url}?${params}`, {
    headers: { 'user-agent': 'RevenueTrigger/DFW public-data intelligence' },
  });
  if (!response.ok) throw new Error(`Dallas historical permits API ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error('Dallas historical permits API returned a non-array response');
  return json.map((row) => normalizeDallasHistoricalPermit(row));
}

export function dallasLiveSourceReadiness() {
  return {
    enabled: false,
    reason: 'Current Dallas data is publicly visible in DallasNow and the official Commercial Permit Activity Dashboard, but a stable machine-readable export/request contract has not yet been validated. Keep disabled rather than deploy brittle browser scraping.',
    candidateSources: [DFW_SOURCES.dallasNow, DFW_SOURCES.dallasCommercialDashboard],
    normalizerReady: true,
  };
}

function contractorNameFromLegacy(value) {
  const s = cleanText(value);
  if (!s || s === ', , () -') return null;
  const phoneIndex = s.search(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/);
  const withoutPhone = phoneIndex >= 0 ? s.slice(0, phoneIndex).trim() : s;
  const addressMatch = withoutPhone.match(/\s+\d{1,6}\s+[A-Z0-9]/i);
  return cleanText(addressMatch ? withoutPhone.slice(0, addressMatch.index) : withoutPhone);
}