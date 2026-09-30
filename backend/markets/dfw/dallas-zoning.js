import { DFW_SOURCES } from './sources.js';
import { cleanText, parseDate } from './normalize.js';

const BASE_ZONING_FIELDS = [
  'OBJECTID','ZONE_DIST','PD_NUM','CD_NUM','CASE_NUMBER','COUNCIL_DATE','COMMON_NAME',
  'LONG_ZONE_DIST','ORD_NUM','NOTES','RES_NUM','EFFECTIVEDATE',
];

const SUP_FIELDS = [
  'OBJECTID','SUP_NUM','BLOCK_LOT','EXPIRES','NOTES','STATUS','POSTED','AUTO_RENEW',
  'COUNCIL_DATE','CASE_NUMBER','RES_NUM','ORD_NUM','EFFECTIVEDATE','SPECIFICUSE',
];

const PD_FIELDS = [
  'OBJECTID','ZONE_DIST','PD_NUM','CD_NUM','CASE_NUMBER','COUNCIL_DATE','COMMON_NAME',
  'LONG_ZONE_DIST','ORD_NUM','NOTES','RES_NUM','EFFECTIVEDATE','DISTRICTUSE',
];

const PDS_FIELDS = [
  'OBJECTID','ZONE_DIST','PDS_NUM','CASE_NUMBER','COUNCIL_DATE','LONG_ZONE_DIST',
  'RES_NUM','ORD_NUM','NOTES','UNIQUEID','EFFECTIVEDATE','DISTRICTUSE',
];

function requireCoordinate(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} must be a finite number between ${min} and ${max}`);
  }
  return n;
}

async function fetchDallasPointFeatures(url, {
  latitude,
  longitude,
  outFields = '*',
  fetchFn = fetch,
} = {}) {
  const lat = requireCoordinate(latitude, -90, 90, 'latitude');
  const lon = requireCoordinate(longitude, -180, 180, 'longitude');
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: Array.isArray(outFields) ? outFields.join(',') : outFields,
    returnGeometry: 'false',
  });
  const response = await fetchFn(`${url}/query?${params}`, {
    headers: { 'user-agent': 'RevenueTrigger/DFW public-data intelligence' },
  });
  if (!response?.ok) throw new Error(`Dallas zoning ArcGIS API ${response?.status ?? 'unknown'} for ${url}`);
  const json = await response.json();
  if (json?.error) throw new Error(json.error.message || 'Dallas zoning ArcGIS API error');
  return (json?.features || []).map((feature) => feature.attributes || {});
}

function commonEnvelope(source, kind, raw, { latitude, longitude, now }) {
  return {
    schemaVersion: 1,
    market: 'Dallas',
    jurisdiction: 'City of Dallas',
    kind,
    sourceKey: source.key,
    sourceRecordId: cleanText(raw.OBJECTID ?? raw.UNIQUEID),
    coordinates: {
      latitude: Number(latitude),
      longitude: Number(longitude),
    },
    councilDate: parseDate(raw.COUNCIL_DATE, { now, maxFutureDays: 30 }),
    effectiveDate: parseDate(raw.EFFECTIVEDATE, { now, maxFutureDays: 30 }),
    caseNumber: cleanText(raw.CASE_NUMBER),
    ordinanceNumber: cleanText(raw.ORD_NUM),
    resolutionNumber: cleanText(raw.RES_NUM),
    notes: cleanText(raw.NOTES),
    sourceUrl: source.url,
    raw,
  };
}

export function normalizeDallasBaseZoning(raw, coordinates, { now = Date.now() } = {}) {
  return {
    ...commonEnvelope(DFW_SOURCES.dallasBaseZoning, 'base_zoning', raw, { ...coordinates, now }),
    zoningDistrict: cleanText(raw.ZONE_DIST),
    longZoningDistrict: cleanText(raw.LONG_ZONE_DIST),
    plannedDevelopmentNumber: cleanText(raw.PD_NUM),
    conservationDistrictNumber: cleanText(raw.CD_NUM),
    commonName: cleanText(raw.COMMON_NAME),
  };
}

export function normalizeDallasSup(raw, coordinates, { now = Date.now() } = {}) {
  return {
    ...commonEnvelope(DFW_SOURCES.dallasSupSearch, 'special_use_permit', raw, { ...coordinates, now }),
    supNumber: cleanText(raw.SUP_NUM),
    specificUse: cleanText(raw.SPECIFICUSE),
    status: cleanText(raw.STATUS),
    blockLot: cleanText(raw.BLOCK_LOT),
    expires: cleanText(raw.EXPIRES),
    posted: cleanText(raw.POSTED),
    autoRenew: cleanText(raw.AUTO_RENEW),
  };
}

export function normalizeDallasPlannedDevelopment(raw, coordinates, { now = Date.now() } = {}) {
  return {
    ...commonEnvelope(DFW_SOURCES.dallasPlannedDevelopments, 'planned_development', raw, { ...coordinates, now }),
    zoningDistrict: cleanText(raw.ZONE_DIST),
    longZoningDistrict: cleanText(raw.LONG_ZONE_DIST),
    plannedDevelopmentNumber: cleanText(raw.PD_NUM),
    conservationDistrictNumber: cleanText(raw.CD_NUM),
    commonName: cleanText(raw.COMMON_NAME),
    districtUse: raw.DISTRICTUSE ?? null,
  };
}

export function normalizeDallasPlannedDevelopmentSubdistrict(raw, coordinates, { now = Date.now() } = {}) {
  return {
    ...commonEnvelope(DFW_SOURCES.dallasPds, 'planned_development_subdistrict', raw, { ...coordinates, now }),
    zoningDistrict: cleanText(raw.ZONE_DIST),
    longZoningDistrict: cleanText(raw.LONG_ZONE_DIST),
    plannedDevelopmentSubdistrictNumber: cleanText(raw.PDS_NUM),
    districtUse: raw.DISTRICTUSE ?? null,
  };
}

export async function fetchDallasZoningAtPoint({
  latitude,
  longitude,
  fetchFn = fetch,
  now = Date.now(),
} = {}) {
  const coordinates = {
    latitude: requireCoordinate(latitude, -90, 90, 'latitude'),
    longitude: requireCoordinate(longitude, -180, 180, 'longitude'),
  };

  const [baseRows, supRows, pdRows, pdsRows] = await Promise.all([
    fetchDallasPointFeatures(DFW_SOURCES.dallasBaseZoning.url, {
      ...coordinates, outFields: BASE_ZONING_FIELDS, fetchFn,
    }),
    fetchDallasPointFeatures(DFW_SOURCES.dallasSupSearch.url, {
      ...coordinates, outFields: SUP_FIELDS, fetchFn,
    }),
    fetchDallasPointFeatures(DFW_SOURCES.dallasPlannedDevelopments.url, {
      ...coordinates, outFields: PD_FIELDS, fetchFn,
    }),
    fetchDallasPointFeatures(DFW_SOURCES.dallasPds.url, {
      ...coordinates, outFields: PDS_FIELDS, fetchFn,
    }),
  ]);

  return {
    market: 'Dallas',
    jurisdiction: 'City of Dallas',
    checkedAt: new Date(now).toISOString(),
    coordinates,
    baseZoning: baseRows.map((row) => normalizeDallasBaseZoning(row, coordinates, { now })),
    specialUsePermits: supRows.map((row) => normalizeDallasSup(row, coordinates, { now })),
    plannedDevelopments: pdRows.map((row) => normalizeDallasPlannedDevelopment(row, coordinates, { now })),
    plannedDevelopmentSubdistricts: pdsRows.map((row) =>
      normalizeDallasPlannedDevelopmentSubdistrict(row, coordinates, { now })
    ),
  };
}
