import assert from 'node:assert/strict';
import { normalizeFortWorthPermit, normalizeFortWorthOccupancy } from './fort-worth.js';
import {
  dallasLiveSourceReadiness,
  normalizeDallasHistoricalPermit,
  normalizeDallasRightOfWayPermit,
} from './dallas.js';
import {
  fetchDallasZoningAtPoint,
  normalizeDallasBaseZoning,
  normalizeDallasSup,
} from './dallas-zoning.js';
import { canonicalLifecycle, parseDate, parseMoney, toLeadInput } from './normalize.js';
import {
  checkArcGISSourceHealth,
  DALLAS_ZONING_HEALTH_SPECS,
  summarizeSourceHealth,
} from './health.js';

const now = Date.parse('2026-09-29T12:00:00Z');
assert.equal(parseMoney('$2,200,000'), 2200000);
assert.equal(parseMoney('0'), null);
assert.equal(parseDate(Date.parse('2055-05-01T00:00:00Z'), { now, maxFutureDays: 2 }), null);
assert.equal(canonicalLifecycle('Plan Review'), 'review');
assert.equal(canonicalLifecycle('Finaled'), 'final');

const fw = normalizeFortWorthPermit({
  Unique_ID:'abc', Permit_No:'PB26-1', Permit_Type:'Commercial Building Permit', Permit_SubType:'Remodel',
  B1_SPECIAL_TEXT:'GFT', B1_WORK_DESC:'tenant finish out', Addr_No:100, Direction:'N', Street_Name:'MAIN', Street_Suffix:'ST',
  Zip_Code:76102, Owner_Full_Name:'RED OAK REALTY LLC', File_Date:Date.parse('2026-09-28T00:00:00Z'),
  Current_Status:'Pending', Status_Date:Date.parse('2026-09-29T00:00:00Z'), JobValue:'2200000', Use_Type:'Office', Specific_Use:'Office',
  Units:'0', SqFt:'12000', Location_1:'(32.75, -97.33)'
}, { now });
assert.equal(fw.address.display, '100 N MAIN ST, Fort Worth TX 76102');
assert.equal(fw.valuation, 2200000);
assert.equal(fw.companyCandidate, 'RED OAK REALTY LLC');
assert.equal(toLeadInput(fw).market, 'Fort Worth');

const co = normalizeFortWorthOccupancy({
  PermitID:'PO26-1', ApplicationType:'Occupancy', ApplicationSubType:'Change of Use', Status:'Finaled', ProjectName:'Core Ops',
  CODate:Date.parse('2026-09-28T00:00:00Z'), HouseNumber:8851, StreetName:'WEST', Type:'FWY', UnitNumber:'124',
  Occupant:'Core Ops LLC', JobUse:'Office', Latitude:32.73, Longitude:-97.47
}, { now });
assert.equal(co.statusCanonical, 'final');
assert.equal(co.address.city, 'Fort Worth');

const badFutureCo = normalizeFortWorthOccupancy({
  PermitID:'PO05-01852', ApplicationType:'Occupancy', ApplicationSubType:'Existing Ordinance', Status:'Finaled',
  CODate:Date.parse('2055-05-01T00:00:00Z'), HouseNumber:4307, StreetName:'CAMP BOWIE', Type:'BLVD',
  Occupant:'J SAUNDERS', JobUse:'Office'
}, { now });
assert.equal(badFutureCo.eventDate, null);

const d = normalizeDallasHistoricalPermit({
  permit_number:'191',
  permit_type:'Building (BU) Commercial Renovation',
  issued_date:'12/31/19',
  contractor:'ACME CONSTRUCTION LLC 123 MAIN ST, DALLAS, TX 75201 (214) 555-1212',
  value:'100000',
  area:'2000',
  work_description:'INTERIOR REMODEL ONLY',
  land_use:'OFFICE BUILDING',
  street_address:'100 ELM ST',
  zip_code:'75201'
}, { now });
assert.equal(d.eventDate, '2019-12-31T00:00:00.000Z');
assert.equal(d.companyCandidate, 'ACME CONSTRUCTION LLC');
assert.equal(d.address.display, '100 ELM ST, Dallas TX 75201');

const row = normalizeDallasRightOfWayPermit({
  OBJECTID:178211873,
  EXTERNALFILENUM:'ROW-2026-504384',
  PERMITTYPE:'Right of Way Permit',
  COMMERCIALORRESIDENTIAL:'Commercial',
  STATUSDESCRIPTION:'Issued',
  CREATEDDATE:Date.parse('2026-09-25T00:00:00Z'),
  ISSUEDATE:Date.parse('2026-09-28T00:00:00Z'),
  ROWREASONFORJOB:'Repair Existing Service',
  ROWIMPROVEMENTREPAIR:'Drive Approach',
  WORKDESCRIPTION:'Expanding Drive Approach',
  APPLICANTCOMPANYNAMESTORED:'Fabian Pinzon',
  ALLCONTRACTORSNAME:'Milan Builders',
}, [{
  EXTERNALFILENUM:'ROW-2026-504384',
  HOUSENUM:4441,
  NAME:'LOGISTICS',
  TYPE:'DR',
  LOCATIONNAME:'4441 LOGISTICS DR',
}], { now });
assert.equal(row.address.display, '4441 LOGISTICS DR, Dallas TX');
assert.equal(row.companyCandidate, 'Milan Builders');
assert.equal(row.specificUse, 'Drive Approach');
assert.equal(row.statusCanonical, 'issued');
assert.equal(toLeadInput(row).permit, 'ROW-2026-504384');

const readiness = dallasLiveSourceReadiness();
assert.equal(readiness.enabled, false);
assert.equal(readiness.normalizerReady, true);
assert.equal(readiness.supplementalCurrentReady, true);
assert.equal(readiness.supplementalSources[0].key, 'dallas_right_of_way_permits');

const zoningCoordinates = { latitude: 32.7767, longitude: -96.7970 };
const legacyZoning = normalizeDallasBaseZoning({
  OBJECTID:6878198,
  ZONE_DIST:'CA-1(A)',
  CASE_NUMBER:'DCA 112-002',
  COUNCIL_DATE:Date.parse('1985-05-15T00:00:00Z'),
  LONG_ZONE_DIST:'CA-1(A)',
  ORD_NUM:'29128',
  RES_NUM:'131602',
  EFFECTIVEDATE:Date.parse('2021-01-27T00:00:00Z'),
}, zoningCoordinates, { now });
assert.equal(legacyZoning.zoningDistrict, 'CA-1(A)');
assert.equal(legacyZoning.councilDate, '1985-05-15T00:00:00.000Z');
assert.equal(legacyZoning.sourceKey, 'dallas_base_zoning');

const sup = normalizeDallasSup({
  OBJECTID:12,
  SUP_NUM:'2451',
  STATUS:'Active',
  SPECIFICUSE:'Restaurant',
  CASE_NUMBER:'Z245-100',
  EFFECTIVEDATE:Date.parse('2026-08-01T00:00:00Z'),
}, zoningCoordinates, { now });
assert.equal(sup.supNumber, '2451');
assert.equal(sup.specificUse, 'Restaurant');
assert.equal(sup.status, 'Active');

const zoningUrls = [];
const zoningFetch = async (url) => {
  zoningUrls.push(String(url));
  let features = [];
  if (String(url).includes('/Zoning/MapServer/15/query?')) {
    features = [{ attributes: {
      OBJECTID:1, ZONE_DIST:'CA-1(A)', CASE_NUMBER:'DCA 112-002', LONG_ZONE_DIST:'CA-1(A)',
    } }];
  } else if (String(url).includes('/PD_SUP_Search/MapServer/0/query?')) {
    features = [{ attributes: {
      OBJECTID:2, SUP_NUM:'2451', STATUS:'Active', SPECIFICUSE:'Restaurant',
    } }];
  }
  return {
    ok: true,
    status: 200,
    async json() { return { features }; },
  };
};
const zoning = await fetchDallasZoningAtPoint({
  ...zoningCoordinates,
  fetchFn: zoningFetch,
  now,
});
assert.equal(zoning.baseZoning.length, 1);
assert.equal(zoning.specialUsePermits.length, 1);
assert.equal(zoning.plannedDevelopments.length, 0);
assert.equal(zoning.plannedDevelopmentSubdistricts.length, 0);
assert.equal(zoning.baseZoning[0].zoningDistrict, 'CA-1(A)');
assert.equal(zoning.specialUsePermits[0].supNumber, '2451');
assert.equal(zoningUrls.length, 4);
assert.ok(zoningUrls.every((url) => decodeURIComponent(url).includes('geometry=-96.797,32.7767')));
assert.ok(zoningUrls.every((url) => url.includes('inSR=4326')));
await assert.rejects(
  () => fetchDallasZoningAtPoint({ latitude: 200, longitude: -96.797, fetchFn: zoningFetch, now }),
  /latitude must be a finite number/
);
assert.equal(DALLAS_ZONING_HEALTH_SPECS.length, 4);

const healthSource = {
  key: 'mock_arcgis',
  market: 'Fort Worth',
  jurisdiction: 'City of Fort Worth',
  url: 'https://example.test/FeatureServer/0',
};
let healthQueryUrl = null;
const healthyFetch = async (url) => ({
  ok: true,
  status: 200,
  async json() {
    if (String(url).includes('/query?')) {
      healthQueryUrl = String(url);
      return { count: 12 };
    }
    return {
      capabilities: 'Query,Extract',
      objectIdField: 'ObjectId',
      maxRecordCount: 1000,
      advancedQueryCapabilities: { supportsPagination: true },
      fields: [{ name: 'ObjectId' }, { name: 'Permit_No' }, { name: 'File_Date' }],
    };
  },
});
const health = await checkArcGISSourceHealth({
  source: healthSource,
  requiredFields: ['ObjectId','Permit_No','File_Date'],
  dateField: 'File_Date',
  lookbackDays: 7,
  requireRecentRows: true,
  requirePagination: true,
  fetchFn: healthyFetch,
  now,
});
assert.equal(health.healthy, true);
assert.equal(health.recentCount, 12);
assert.deepEqual(health.missingFields, []);
assert.match(decodeURIComponent(healthQueryUrl), /File_Date <= DATE '2026-09-30'/);

const driftFetch = async (url) => ({
  ok: true,
  status: 200,
  async json() {
    if (String(url).includes('/query?')) return { count: 0 };
    return {
      capabilities: 'Query',
      advancedQueryCapabilities: { supportsPagination: false },
      fields: [{ name: 'ObjectId' }],
    };
  },
});
const drift = await checkArcGISSourceHealth({
  source: healthSource,
  requiredFields: ['ObjectId','Permit_No','File_Date'],
  dateField: 'File_Date',
  lookbackDays: 7,
  requireRecentRows: true,
  requirePagination: true,
  fetchFn: driftFetch,
  now,
});
assert.equal(drift.healthy, false);
assert.equal(drift.status, 'degraded');
assert.deepEqual(drift.missingFields, ['Permit_No','File_Date']);

const summary = summarizeSourceHealth({
  market:'Fort Worth',
  healthy:false,
  checkedAt:new Date(now).toISOString(),
  sources:[health, drift],
});
assert.equal(summary.healthySources, 1);
assert.equal(summary.sourceCount, 2);
assert.equal(summary.degradedSources.length, 1);

console.log('DFW normalization, zoning, and source-health tests passed');
