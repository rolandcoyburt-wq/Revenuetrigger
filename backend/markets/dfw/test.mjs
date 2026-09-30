import assert from 'node:assert/strict';
import { normalizeFortWorthPermit, normalizeFortWorthOccupancy } from './fort-worth.js';
import { normalizeDallasHistoricalPermit } from './dallas.js';
import { canonicalLifecycle, parseDate, parseMoney, toLeadInput } from './normalize.js';
import { checkArcGISSourceHealth, summarizeSourceHealth } from './health.js';

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

const d = normalizeDallasHistoricalPermit({permit_number:'191',permit_type:'Building (BU) Commercial Renovation',issued_date:'12/31/19',contractor:'ACME CONSTRUCTION LLC 123 MAIN ST, DALLAS, TX 75201 (214) 555-1212',value:'100000',area:'2000',work_description:'INTERIOR REMODEL ONLY',land_use:'OFFICE BUILDING',street_address:'100 ELM ST',zip_code:'75201'}, { now });
assert.equal(d.eventDate, '2019-12-31T00:00:00.000Z');
assert.equal(d.companyCandidate, 'ACME CONSTRUCTION LLC');
assert.equal(d.address.display, '100 ELM ST, Dallas TX 75201');
console.log('DFW normalization tests passed');


const healthSource = {
  key: 'mock_arcgis',
  market: 'Fort Worth',
  jurisdiction: 'City of Fort Worth',
  url: 'https://example.test/FeatureServer/0',
};
const healthyFetch = async (url) => ({
  ok: true,
  status: 200,
  async json() {
    if (String(url).includes('/query?')) return { count: 12 };
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
const summary = summarizeSourceHealth({ market:'Fort Worth', healthy:false, checkedAt:new Date(now).toISOString(), sources:[health, drift] });
assert.equal(summary.healthySources, 1);
assert.equal(summary.sourceCount, 2);
assert.equal(summary.degradedSources.length, 1);
