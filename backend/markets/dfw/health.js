import { DFW_SOURCES } from './sources.js';

export const FORT_WORTH_HEALTH_SPECS = Object.freeze([
  Object.freeze({
    source: DFW_SOURCES.fortWorthPermits,
    requiredFields: [
      'Unique_ID','Permit_No','Permit_Type','Permit_SubType','Permit_Category','B1_SPECIAL_TEXT','B1_WORK_DESC',
      'Full_Street_Address','Owner_Full_Name','File_Date','Current_Status','Status_Date','JobValue','Use_Type',
      'Specific_Use','Units','SqFt','ObjectId',
    ],
    dateField: 'File_Date',
    lookbackDays: 7,
    requireRecentRows: true,
    requirePagination: true,
  }),
  Object.freeze({
    source: DFW_SOURCES.fortWorthOccupancy,
    requiredFields: [
      'PermitID','RecordAlias','ApplicationType','ApplicationSubType','Status','ProjectName','CODate',
      'ApplicantName','Occupant','JobUse','Location','Latitude','Longitude','ObjectId',
    ],
    dateField: 'CODate',
    lookbackDays: 30,
    requireRecentRows: true,
    requirePagination: true,
  }),
  Object.freeze({
    source: DFW_SOURCES.fortWorthZoningCases,
    requiredFields: [
      'OBJECTID','CASE_NMBR','ZC_DATE','APPLT_NAME','APPLT_TYPE','ADDRESS','DATE_APPRO','ACTION_','ZONING_FRO','ZONING_TO',
    ],
    dateField: 'ZC_DATE',
    lookbackDays: 180,
    requireRecentRows: false,
    requirePagination: false,
  }),
]);

export const DALLAS_SUPPLEMENTAL_HEALTH_SPECS = Object.freeze([
  Object.freeze({
    source: DFW_SOURCES.dallasRightOfWayPermits,
    requiredFields: [
      'OBJECTID','EXTERNALFILENUM','PERMITTYPE','COMMERCIALORRESIDENTIAL','STATUSDESCRIPTION','CREATEDDATE','ISSUEDATE',
      'ROWREASONFORJOB','ROWIMPROVEMENTREPAIR','SPECIFICLOCATION','WORKDESCRIPTION','APPLICANTNAMESTORED',
      'APPLICANTCOMPANYNAMESTORED','ALLCONTRACTORSNAME',
    ],
    dateField: 'CREATEDDATE',
    lookbackDays: 30,
    requireRecentRows: true,
    requirePagination: true,
  }),
  Object.freeze({
    source: DFW_SOURCES.dallasRightOfWayLocations,
    requiredFields: ['OBJECTID','EXTERNALFILENUM','HOUSENUM','PREFIX','NAME','TYPE','LOCATIONNAME','CASEID'],
    requireRecentRows: false,
    requirePagination: true,
  }),
]);

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

async function fetchJson(url, fetchFn) {
  let response;
  try {
    response = await fetchFn(url, {
      headers: { 'user-agent': 'RevenueTrigger/DFW source-health' },
    });
  } catch (error) {
    throw new Error(`network error: ${error?.message || error}`);
  }
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
  const json = await response.json();
  if (json?.error) throw new Error(json.error.message || 'ArcGIS API error');
  return json;
}

export async function checkArcGISSourceHealth({
  source,
  requiredFields = [],
  dateField = null,
  lookbackDays = null,
  requireRecentRows = false,
  requirePagination = false,
  maxFutureDays = 1,
  fetchFn = fetch,
  now = Date.now(),
} = {}) {
  if (!source?.key || !source?.url) throw new Error('source.key and source.url are required');

  const checkedAt = new Date(now).toISOString();
  const errors = [];
  let metadata = null;
  let recentCount = null;

  try {
    metadata = await fetchJson(`${source.url}?f=json`, fetchFn);
  } catch (error) {
    errors.push(`metadata: ${error.message}`);
  }

  const fieldNames = new Set((metadata?.fields || []).map((field) => field.name));
  const missingFields = requiredFields.filter((field) => !fieldNames.has(field));
  const capabilities = String(metadata?.capabilities || '');
  const queryable = /\bQuery\b/i.test(capabilities);
  const paginationSupported = Boolean(metadata?.advancedQueryCapabilities?.supportsPagination);
  const schemaOk = Boolean(metadata) && missingFields.length === 0;

  if (metadata && !queryable) errors.push('capability: Query is not advertised');
  if (metadata && requirePagination && !paginationSupported) errors.push('capability: pagination is not advertised');
  if (metadata && missingFields.length) errors.push(`schema: missing ${missingFields.join(', ')}`);

  if (metadata && queryable && dateField && Number.isFinite(lookbackDays)) {
    const start = now - lookbackDays * 86_400_000;
    const end = now + maxFutureDays * 86_400_000;
    const params = new URLSearchParams({
      f: 'json',
      where: `${dateField} >= DATE '${isoDay(start)}' AND ${dateField} <= DATE '${isoDay(end)}'`,
      returnCountOnly: 'true',
    });
    try {
      const countJson = await fetchJson(`${source.url}/query?${params}`, fetchFn);
      recentCount = Number.isFinite(Number(countJson?.count)) ? Number(countJson.count) : null;
      if (recentCount === null) errors.push('freshness: count response missing numeric count');
      if (requireRecentRows && recentCount === 0) errors.push(`freshness: zero rows in last ${lookbackDays} days`);
    } catch (error) {
      errors.push(`freshness: ${error.message}`);
    }
  }

  const healthy =
    Boolean(metadata) &&
    queryable &&
    schemaOk &&
    (!requirePagination || paginationSupported) &&
    (!requireRecentRows || (Number.isFinite(recentCount) && recentCount > 0));

  return {
    sourceKey: source.key,
    market: source.market,
    jurisdiction: source.jurisdiction,
    status: healthy ? 'healthy' : metadata ? 'degraded' : 'unreachable',
    healthy,
    checkedAt,
    queryable,
    paginationSupported,
    schemaOk,
    missingFields,
    recentCount,
    lookbackDays,
    objectIdField: metadata?.objectIdField || metadata?.objectIdFieldName || null,
    maxRecordCount: Number.isFinite(Number(metadata?.maxRecordCount)) ? Number(metadata.maxRecordCount) : null,
    errors,
  };
}

export async function checkFortWorthSourceHealth({ fetchFn = fetch, now = Date.now() } = {}) {
  return checkSpecs('Fort Worth', FORT_WORTH_HEALTH_SPECS, { fetchFn, now });
}

export async function checkDallasSupplementalSourceHealth({ fetchFn = fetch, now = Date.now() } = {}) {
  return checkSpecs('Dallas', DALLAS_SUPPLEMENTAL_HEALTH_SPECS, { fetchFn, now });
}

async function checkSpecs(market, specs, { fetchFn, now }) {
  const results = [];
  for (const spec of specs) {
    results.push(await checkArcGISSourceHealth({ ...spec, fetchFn, now }));
  }
  return {
    market,
    checkedAt: new Date(now).toISOString(),
    healthy: results.every((result) => result.healthy),
    sources: results,
  };
}

export function summarizeSourceHealth(report) {
  const sources = report?.sources || [];
  return {
    market: report?.market || null,
    healthy: Boolean(report?.healthy),
    checkedAt: report?.checkedAt || null,
    healthySources: sources.filter((source) => source.healthy).length,
    sourceCount: sources.length,
    degradedSources: sources.filter((source) => !source.healthy).map((source) => ({
      sourceKey: source.sourceKey,
      status: source.status,
      errors: source.errors,
    })),
  };
}
