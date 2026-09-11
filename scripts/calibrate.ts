/**
 * `npm run calibrate [class ...]`: drive every class round a fitting set and
 * a checking set of circuits, fit its par constant to the first, and say how
 * that and the rating in `vehicles.ts` do on both. See `src/calibrate.ts`.
 */
import { fitPar, measure, score } from '../src/calibrate';
import { VEHICLES, VEHICLE_KEYS, type VehicleKey } from '../src/vehicles';

const FIT = Array.from({ length: 13 }, (_, i) => i);
const CHECK = Array.from({ length: 13 }, (_, i) => i + 13);

const pct = (e: number) => `${(e * 100).toFixed(1)}%`;
// no @types/node here, and one array is all this wants from it
const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? [];
const asked = argv.slice(2).filter((a): a is VehicleKey => (VEHICLE_KEYS as string[]).includes(a));

for (const key of asked.length ? asked : VEHICLE_KEYS) {
  const spec = VEHICLES[key];
  const t0 = performance.now();
  const fitSet = measure(spec, FIT);
  const checkSet = measure(spec, CHECK);
  const fitted = { ...spec.rating, par: fitPar(spec, fitSet) };
  const line = (label: string, rating: typeof fitted) => {
    const a = score(spec, fitSet, rating), b = score(spec, checkSet, rating);
    return `  ${label} par ${rating.par}: fitting ${pct(a.mean)} mean, ${pct(a.worst)} worst; checking ${pct(b.mean)} mean, ${pct(b.worst)} worst`;
  };
  const all = { seeds: [...FIT, ...CHECK], laps: [...fitSet.laps, ...checkSet.laps], lifts: [...fitSet.lifts, ...checkSet.lifts] };
  const s = score(spec, all, fitted);
  const misses = all.seeds.map((seed, i) => [seed, s.errors[i]] as const)
    .filter(([, e]) => Number.isFinite(e)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
  const unfinished = all.seeds.filter((_, i) => !Number.isFinite(all.laps[i]));
  console.log(`\n${spec.label} (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
  console.log(line('fitted  ', fitted));
  console.log(line('in force', spec.rating));
  console.log(`  worst misses ${misses.map(([seed, e]) => `#${seed} ${pct(e)}`).join(', ')}${unfinished.length ? `; never finished #${unfinished.join(', #')}` : ''}`);
  console.log(`  difficulty against lifting, all circuits: r = ${s.liftCorrelation.toFixed(2)}`);
  console.log(`  laps ${all.laps.map((t) => t.toFixed(2)).join(' ')}`);
}
