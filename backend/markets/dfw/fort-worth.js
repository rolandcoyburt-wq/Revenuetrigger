import { DFW_SOURCES } from './sources.js';
import {
  cleanText,
  coordinatesFromText,
  makeNormalizedRecord,
  makeParticipant,
  normalizeAddress,
  parseDate,
  parseMoney,
  parseNumber,
} from './normalize.js';

const PERMIT_FIELDS = [
  'Unique_ID','Permit_No','Permit_Type','Permit_SubType','Permit_Category','B1_SPECIAL_TEXT','B1_WORK_DESC',
  'Addr_No','Direction','Street_Name','Street_Suffix','Street_Suffix_Dir','Full_Street_Address','Zip_Code',
  'Owner_Full_Name','File_Date','Current_Status','Status_Date','Location_1','JobValue','Use_Type','Specific_Use','Units','SqFt','ObjectId',
];

const CO_FIELDS = [
  'PermitID','RecordAlias','ApplicationType','ApplicationSubType','Status','ProjectName','CODate','ApplicantName',
  'AddressLine1','AddressLine2','City','Zip','HouseNumber','UnitNumber','Prefix','StreetName','Type','Suffix',
  'MaxOccupancy','Occupant','JobUse','Stories','Location','Latitude','Longitude','Location_1','ObjectId',
];

const ZONING_FIELDS = [
  'OBJECTID','CASE_NMBR','ACRES','ZC_DATE','APPLT_NAME','APPLT_TYPE','SECTOR','CONTACT','ADDRESS','FUTURE_LAN',
  'DATE_APPRO','CONSISTENC','ACTION_','ZONING_FRO','ZONING_TO',
];

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function fetchArcGISRows(url, {
  where = '1=1',
  outFields = '*',
  orderByFields,
  resultRecordCount = 1000,
  resultOffset = 0,
  returnGeometry = false,
  outSR = 4326,
  fetchFn = fetch,
} = {}) {
  const params = new URLSearchParams({
    f: 'json', where,
    outFields: Array.isArray(outFields) ? outFields.join(',') : outFields,
    resultRecordCount: String(resultRecordCount),
    resultOffset: String(resultOffset),
    returnGeometry: String(Boolean(returnGeometry)),
  });
  if (orderByFields) params.set('orderByFields', orderByFields);
  if (returnGeometry) params.set('outSR', String(outSR));
  const response = await fetchFn(`${url}/query?${params}`, {
    headers: { 'user-agent': 'RevenueTrigger/DFW public-data intelligence' },
  });
  if (!response.ok) throw new Error(`ArcGIS API ${response.status} for ${url}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'ArcGIS API error');
  return { rows: (json.features || []).map((f) => f.attributes || {}), exceeded: Boolean(json.exceededTransferLimit) };
}

export function normalizeFortWorthPermit(a, { now = Date.now() } = {}) {
  const fileDate = parseDate(a.File_Date, { now, maxFutureDays: 2 });
  const statusDate = parseDate(a.Status_Date, { now, maxFutureDays: 2 });
  const address = normalizeAddress({
    full: a.Full_Street_Address,
    number: a.Addr_No,
    prefix: a.Direction,
    street: a.Street_Name,
    type: a.Street_Suffix,
    suffix: a.Street_Suffix_Dir,
    city: 'Fort Worth',
    state: 'TX',
    zip: a.Zip_Code,
  });
  const coordinates = coordinatesFromText(a.Location_1);
  return makeNormalizedRecord({
    market: 'Fort Worth',
    jurisdiction: 'City of Fort Worth',
    sourceKey: DFW_SOURCES.fortWorthPermits.key,
    sourceRecordId: a.Unique_ID || a.ObjectId,
    permitNumber: a.Permit_No,
    recordType: a.Permit_Type,
    recordSubtype: a.Permit_SubType,
    recordCategory: a.Permit_Category,
    statusRaw: a.Current_Status,
    fileDate,
    statusDate,
    eventDate: statusDate || fileDate,
    address,
    coordinates,
    projectName: a.B1_SPECIAL_TEXT,
    workDescription: cleanText(a.B1_WORK_DESC) === 'B1_WORK_DESC' ? null : a.B1_WORK_DESC,
    useType: a.Use_Type,
    specificUse: a.Specific_Use,
    valuation: parseMoney(a.JobValue),
    units: parseNumber(a.Units, { min: 0, max: 1_000_000 }),
    squareFeet: parseNumber(a.SqFt, { min: 0, max: 1_000_000_000, zeroIsNull: true }),
    participants: [makeParticipant('owner', a.Owner_Full_Name)],
    sourceUrl: DFW_SOURCES.fortWorthPermits.url,
    lineage: {
      permitNumber: 'Permit_No', recordType: 'Permit_Type', recordSubtype: 'Permit_SubType', recordCategory: 'Permit_Category',
      projectName: 'B1_SPECIAL_TEXT', workDescription: 'B1_WORK_DESC', address: 'Full_Street_Address/address components',
      owner: 'Owner_Full_Name', fileDate: 'File_Date', status: 'Current_Status', statusDate: 'Status_Date',
      valuation: 'JobValue', useType: 'Use_Type', specificUse: 'Specific_Use', units: 'Units', squareFeet: 'SqFt', coordinates: 'Location_1',
    },
    raw: a,
  });
}

export function normalizeFortWorthOccupancy(a, { now = Date.now() } = {}) {
  const eventDate = parseDate(a.CODate, { now, maxFutureDays: 2 });
  const address = normalizeAddress({
    full: a.Location,
    number: a.HouseNumber,
    prefix: a.Prefix,
    street: a.StreetName,
    type: a.Type,
    suffix: a.Suffix,
    unit: a.UnitNumber,
    city: 'Fort Worth',
    state: 'TX',
    zip: a.Zip,
  });
  return makeNormalizedRecord({
    market: 'Fort Worth',
    jurisdiction: 'City of Fort Worth',
    sourceKey: DFW_SOURCES.fortWorthOccupancy.key,
    sourceRecordId: `${a.PermitID || a.ObjectId}:co`,
    permitNumber: a.PermitID,
    recordType: a.ApplicationType || a.RecordAlias,
    recordSubtype: a.ApplicationSubType,
    recordCategory: 'Certificate of Occupancy',
    statusRaw: a.Status,
    fileDate: null,
    statusDate: eventDate,
    eventDate,
    address,
    coordinates: {
      latitude: parseNumber(a.Latitude, { min: -90, max: 90 }),
      longitude: parseNumber(a.Longitude, { min: -180, max: 180 }),
    },
    projectName: a.ProjectName || a.Occupant,
    workDescription: a.RecordAlias,
    useType: a.JobUse,
    specificUse: a.Occupant,
    valuation: null,
    units: null,
    squareFeet: null,
    participants: [
      makeParticipant('occupant', a.Occupant),
      makeParticipant('applicant', a.ApplicantName, { contactAddress: cleanText(a.AddressLine1) }),
    ],
    sourceUrl: DFW_SOURCES.fortWorthOccupancy.url,
    lineage: {
      permitNumber: 'PermitID', recordType: 'ApplicationType/RecordAlias', recordSubtype: 'ApplicationSubType', status: 'Status',
      projectName: 'ProjectName', eventDate: 'CODate', applicant: 'ApplicantName', address: 'Location/address components',
      occupant: 'Occupant', useType: 'JobUse', coordinates: 'Latitude/Longitude',
    },
    raw: a,
  });
}

export function normalizeFortWorthZoningCase(a, { now = Date.now() } = {}) {
  const fileDate = parseDate(a.ZC_DATE, { now, maxFutureDays: 30 });
  const approvalDate = parseDate(a.DATE_APPRO, { now, maxFutureDays: 30 });
  return makeNormalizedRecord({
    market: 'Fort Worth',
    jurisdiction: 'City of Fort Worth',
    sourceKey: DFW_SOURCES.fortWorthZoningCases.key,
    sourceRecordId: a.CASE_NMBR || a.OBJECTID,
    permitNumber: a.CASE_NMBR,
    recordType: 'Zoning Case',
    recordSubtype: a.APPLT_TYPE,
    statusRaw: a.ACTION_ || (approvalDate ? 'Approved' : 'Pending'),
    fileDate,
    statusDate: approvalDate,
    eventDate: approvalDate || fileDate,
    address: normalizeAddress({ full: a.ADDRESS, city: 'Fort Worth', state: 'TX' }),
    projectName: a.APPLT_NAME,
    workDescription: [a.ZONING_FRO && `From ${a.ZONING_FRO}`, a.ZONING_TO && `To ${a.ZONING_TO}`, a.FUTURE_LAN && `Future land use ${a.FUTURE_LAN}`].filter(Boolean).join(' · '),
    useType: a.SECTOR,
    participants: [makeParticipant('applicant', a.APPLT_NAME)],
    sourceUrl: DFW_SOURCES.fortWorthZoningCases.url,
    lineage: { caseNumber: 'CASE_NMBR', fileDate: 'ZC_DATE', applicant: 'APPLT_NAME', address: 'ADDRESS', approvalDate: 'DATE_APPRO', action: 'ACTION_', zoningFrom: 'ZONING_FRO', zoningTo: 'ZONING_TO' },
    raw: a,
  });
}

export async function fetchFortWorthPermits({ sinceDays = 14, pageSize = 1000, maxPages = 20, fetchFn = fetch, now = Date.now() } = {}) {
  const start = now - sinceDays * 86_400_000;
  const where = `File_Date >= DATE '${isoDay(start)}'`;
  const records = [];
  for (let page = 0; page < maxPages; page++) {
    const { rows, exceeded } = await fetchArcGISRows(DFW_SOURCES.fortWorthPermits.url, {
      where, outFields: PERMIT_FIELDS, orderByFields: 'File_Date DESC,ObjectId DESC', resultRecordCount: pageSize, resultOffset: page * pageSize, fetchFn,
    });
    records.push(...rows.map((row) => normalizeFortWorthPermit(row, { now })));
    if (!exceeded || rows.length < pageSize) break;
  }
  return dedupeBy(records, (r) => `${r.permitNumber || ''}|${r.statusRaw || ''}|${r.statusDate || ''}|${r.sourceRecordId || ''}`);
}

export async function fetchFortWorthOccupancy({ sinceDays = 30, pageSize = 1000, maxPages = 10, fetchFn = fetch, now = Date.now() } = {}) {
  const start = now - sinceDays * 86_400_000;
  const where = `CODate >= DATE '${isoDay(start)}'`;
  const records = [];
  for (let page = 0; page < maxPages; page++) {
    const { rows, exceeded } = await fetchArcGISRows(DFW_SOURCES.fortWorthOccupancy.url, {
      where, outFields: CO_FIELDS, orderByFields: 'CODate DESC,ObjectId DESC', resultRecordCount: pageSize, resultOffset: page * pageSize, fetchFn,
    });
    records.push(...rows.map((row) => normalizeFortWorthOccupancy(row, { now })).filter((r) => r.eventDate));
    if (!exceeded || rows.length < pageSize) break;
  }
  return dedupeBy(records, (r) => `${r.permitNumber || ''}|${r.eventDate || ''}|${r.sourceRecordId || ''}`);
}

export async function fetchFortWorthZoningCases({ sinceDays = 120, pageSize = 1000, maxPages = 5, fetchFn = fetch, now = Date.now() } = {}) {
  const start = now - sinceDays * 86_400_000;
  const where = `ZC_DATE >= DATE '${isoDay(start)}'`;
  const records = [];
  for (let page = 0; page < maxPages; page++) {
    const { rows, exceeded } = await fetchArcGISRows(DFW_SOURCES.fortWorthZoningCases.url, {
      where, outFields: ZONING_FIELDS, orderByFields: 'ZC_DATE DESC,OBJECTID DESC', resultRecordCount: pageSize, resultOffset: page * pageSize, fetchFn,
    });
    records.push(...rows.map((row) => normalizeFortWorthZoningCase(row, { now })));
    if (!exceeded || rows.length < pageSize) break;
  }
  return dedupeBy(records, (r) => r.sourceRecordId);
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