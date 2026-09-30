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

const ROW_FIELDS = [
  'OBJECTID','JOBID','EXTERNALFILENUM','PERMITTYPE','COMMERCIALORRESIDENTIAL','STATUSDESCRIPTION','CREATEDDATE','ISSUEDATE',
  'COMPLETEDDATE','EXPIRATIONDATE','ROWREQUESTEDSTARTDATE','ROWESTIMATEDCOMPLETIONDATE','ROWREASONFORJOB',
  'ROWIMPROVEMENTREPAIR','ROWISEMERGENCYREPAIR','SPECIFICLOCATION','WORKDESCRIPTION','APPLICANTNAMESTORED',
  'APPLICANTCOMPANYNAMESTORED','ALLCONTRACTORSNAME','LOCATIONNAMES','CASEID',
];

const ROW_LOCATION_FIELDS = [
  'OBJECTID','JOBID','EXTERNALFILENUM','HOUSENUM','FROMBLOCK','TOBLOCK','ISBLOCK','PREFIX','NAME','SUFFIX','TYPE',
  'LOCATIONNAME','ID','CASEID',
];

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

async function fetchDallasArcGISRows(url, {
  where = '1=1',
  outFields = '*',
  orderByFields,
  resultRecordCount = 1000,
  resultOffset = 0,
  fetchFn = fetch,
} = {}) {
  const params = new URLSearchParams({
    f: 'json',
    where,
    outFields: Array.isArray(outFields) ? outFields.join(',') : outFields,
    resultRecordCount: String(resultRecordCount),
    resultOffset: String(resultOffset),
    returnGeometry: 'false',
  });
  if (orderByFields) params.set('orderByFields', orderByFields);
  const response = await fetchFn(`${url}/query?${params}`, {
    headers: { 'user-agent': 'RevenueTrigger/DFW public-data intelligence' },
  });
  if (!response.ok) throw new Error(`Dallas ArcGIS API ${response.status} for ${url}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'Dallas ArcGIS API error');
  return {
    rows: (json.features || []).map((feature) => feature.attributes || {}),
    exceeded: Boolean(json.exceededTransferLimit),
  };
}

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

export function normalizeDallasRightOfWayPermit(a, locationRows = [], { now = Date.now() } = {}) {
  const fileDate = parseDate(a.CREATEDDATE, { now, maxFutureDays: 2 });
  const issueDate = parseDate(a.ISSUEDATE, { now, maxFutureDays: 2 });
  const completionDate = parseDate(a.COMPLETEDDATE, { now, maxFutureDays: 2 });
  const primaryLocation = locationRows.find((row) => cleanText(row.LOCATIONNAME)) || locationRows[0] || null;
  const fallbackStreet = streetFromSpecificLocation(a.SPECIFICLOCATION);

  const address = normalizeAddress({
    full: primaryLocation?.LOCATIONNAME || fallbackStreet,
    number: primaryLocation?.HOUSENUM,
    prefix: primaryLocation?.PREFIX,
    street: primaryLocation?.NAME,
    type: primaryLocation?.TYPE,
    suffix: primaryLocation?.SUFFIX,
    city: 'Dallas',
    state: 'TX',
  });

  const workDescription = [
    cleanText(a.WORKDESCRIPTION),
    cleanText(a.ROWREASONFORJOB) && `Reason: ${cleanText(a.ROWREASONFORJOB)}`,
    cleanText(a.SPECIFICLOCATION) && `Location detail: ${cleanText(a.SPECIFICLOCATION)}`,
  ].filter(Boolean).join(' · ');

  return makeNormalizedRecord({
    market: 'Dallas',
    jurisdiction: 'City of Dallas',
    sourceKey: DFW_SOURCES.dallasRightOfWayPermits.key,
    sourceRecordId: a.EXTERNALFILENUM || a.OBJECTID,
    permitNumber: a.EXTERNALFILENUM,
    recordType: a.PERMITTYPE || 'Right of Way Permit',
    recordSubtype: a.ROWIMPROVEMENTREPAIR,
    recordCategory: cleanText(a.COMMERCIALORRESIDENTIAL) ? `Right of Way - ${cleanText(a.COMMERCIALORRESIDENTIAL)}` : 'Right of Way',
    statusRaw: a.STATUSDESCRIPTION,
    fileDate,
    statusDate: completionDate || issueDate,
    eventDate: issueDate || fileDate,
    address,
    projectName: null,
    workDescription,
    useType: a.COMMERCIALORRESIDENTIAL,
    specificUse: a.ROWIMPROVEMENTREPAIR,
    valuation: null,
    units: null,
    squareFeet: null,
    participants: [
      makeParticipant('contractor', a.ALLCONTRACTORSNAME),
      makeParticipant('applicant', a.APPLICANTCOMPANYNAMESTORED),
      makeParticipant('applicant', a.APPLICANTNAMESTORED),
    ],
    sourceUrl: DFW_SOURCES.dallasRightOfWayPermits.url,
    lineage: {
      permitNumber: 'EXTERNALFILENUM',
      recordType: 'PERMITTYPE',
      recordSubtype: 'ROWIMPROVEMENTREPAIR',
      category: 'COMMERCIALORRESIDENTIAL',
      status: 'STATUSDESCRIPTION',
      fileDate: 'CREATEDDATE',
      issuedDate: 'ISSUEDATE',
      completedDate: 'COMPLETEDDATE',
      workDescription: 'WORKDESCRIPTION/ROWREASONFORJOB/SPECIFICLOCATION',
      contractor: 'ALLCONTRACTORSNAME',
      applicantCompany: 'APPLICANTCOMPANYNAMESTORED',
      applicant: 'APPLICANTNAMESTORED',
      address: 'Permit Location.EXTERNALFILENUM -> LOCATIONNAME/address components',
    },
    raw: { permit: a, locations: locationRows },
  });
}

export async function fetchDallasRightOfWayPermits({
  sinceDays = 30,
  commercialOnly = true,
  pageSize = 1000,
  maxPages = 10,
  locationChunkSize = 75,
  fetchFn = fetch,
  now = Date.now(),
} = {}) {
  const start = now - sinceDays * 86_400_000;
  const end = now + 86_400_000;
  const whereParts = [
    `CREATEDDATE >= DATE '${isoDay(start)}'`,
    `CREATEDDATE <= DATE '${isoDay(end)}'`,
  ];
  if (commercialOnly) whereParts.push("COMMERCIALORRESIDENTIAL = 'Commercial'");

  const detailRows = [];
  for (let page = 0; page < maxPages; page++) {
    const { rows, exceeded } = await fetchDallasArcGISRows(DFW_SOURCES.dallasRightOfWayPermits.url, {
      where: whereParts.join(' AND '),
      outFields: ROW_FIELDS,
      orderByFields: 'CREATEDDATE DESC,OBJECTID DESC',
      resultRecordCount: pageSize,
      resultOffset: page * pageSize,
      fetchFn,
    });
    detailRows.push(...rows);
    if (!exceeded || rows.length < pageSize) break;
  }

  const permitNumbers = [...new Set(detailRows.map((row) => cleanText(row.EXTERNALFILENUM)).filter(Boolean))];
  const locationsByPermit = await fetchDallasRightOfWayLocations(permitNumbers, { chunkSize: locationChunkSize, fetchFn });

  const records = detailRows.map((row) =>
    normalizeDallasRightOfWayPermit(row, locationsByPermit.get(cleanText(row.EXTERNALFILENUM)) || [], { now })
  );

  return dedupeBy(records, (record) => record.sourceRecordId || record.permitNumber);
}

async function fetchDallasRightOfWayLocations(permitNumbers, { chunkSize = 75, fetchFn = fetch } = {}) {
  const byPermit = new Map();
  for (let i = 0; i < permitNumbers.length; i += chunkSize) {
    const chunk = permitNumbers.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const inList = chunk.map((value) => `'${escapeSqlString(value)}'`).join(',');
    const { rows } = await fetchDallasArcGISRows(DFW_SOURCES.dallasRightOfWayLocations.url, {
      where: `EXTERNALFILENUM IN (${inList})`,
      outFields: ROW_LOCATION_FIELDS,
      orderByFields: 'EXTERNALFILENUM ASC,OBJECTID ASC',
      resultRecordCount: 2000,
      fetchFn,
    });
    for (const row of rows) {
      const key = cleanText(row.EXTERNALFILENUM);
      if (!key) continue;
      const current = byPermit.get(key) || [];
      current.push(row);
      byPermit.set(key, current);
    }
  }
  return byPermit;
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
    reason: 'Primary Dallas building permits remain publicly visible in DallasNow and the official Commercial Permit Activity Dashboard, but a stable machine-readable export/request contract has not yet been validated. Keep the primary building feed disabled rather than deploy brittle browser scraping.',
    candidateSources: [DFW_SOURCES.dallasNow, DFW_SOURCES.dallasCommercialDashboard],
    normalizerReady: true,
    supplementalCurrentReady: true,
    supplementalSources: [DFW_SOURCES.dallasRightOfWayPermits],
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

function streetFromSpecificLocation(value) {
  const s = cleanText(value);
  if (!s) return null;
  const match = s.match(/^(\d{1,6}\s+[^,]+)(?:,\s*DALLAS\b.*)?$/i);
  return cleanText(match?.[1]);
}

function dedupeBy(rows, keyFn) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
