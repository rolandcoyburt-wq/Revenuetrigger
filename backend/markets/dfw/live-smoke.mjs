import {
  checkDallasSupplementalSourceHealth,
  checkFortWorthSourceHealth,
  summarizeSourceHealth,
} from './health.js';
import {
  fetchDallasRightOfWayPermits,
  dallasLiveSourceReadiness,
} from './dallas.js';
import {
  fetchFortWorthPermits,
  fetchFortWorthOccupancy,
  fetchFortWorthZoningCases,
} from './fort-worth.js';
import { toLeadInput } from './normalize.js';

const now = Date.now();

async function sample(label, loader, count = 3) {
  const rows = await loader();
  const preview = rows.slice(0, count).map((row) => ({
    normalized: row,
    leadInput: toLeadInput(row),
  }));
  return { label, count: rows.length, preview };
}

async function main() {
  const [fortWorthHealth, dallasHealth] = await Promise.all([
    checkFortWorthSourceHealth({ now }),
    checkDallasSupplementalSourceHealth({ now }),
  ]);

  const output = {
    checkedAt: new Date(now).toISOString(),
    health: {
      fortWorth: summarizeSourceHealth(fortWorthHealth),
      dallasSupplemental: summarizeSourceHealth(dallasHealth),
    },
    dallasPrimaryReadiness: dallasLiveSourceReadiness(),
    samples: [],
  };

  output.samples.push(await sample(
    'fort_worth_permits',
    () => fetchFortWorthPermits({ sinceDays: 7, maxPages: 2, now }),
  ));
  output.samples.push(await sample(
    'fort_worth_occupancy',
    () => fetchFortWorthOccupancy({ sinceDays: 30, maxPages: 2, now }),
  ));
  output.samples.push(await sample(
    'fort_worth_zoning',
    () => fetchFortWorthZoningCases({ sinceDays: 180, maxPages: 2, now }),
  ));
  output.samples.push(await sample(
    'dallas_right_of_way',
    () => fetchDallasRightOfWayPermits({ sinceDays: 30, maxPages: 2, now }),
  ));

  console.log(JSON.stringify(output, null, 2));

  if (!fortWorthHealth.healthy || !dallasHealth.healthy) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[DFW live smoke] failed:', error);
  process.exitCode = 1;
});
