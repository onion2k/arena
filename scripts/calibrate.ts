/**
 * `npm run calibrate [class ...]`: drive every class round a fitting set and
 * a checking set of circuits, fit its par constant to the first, and say how
 * that and the rating in `vehicles.ts` do on both. See `src/calibrate.ts`.
 */
import { fitPar, measure, score, type Circuit } from '../src/calibrate';
import { VEHICLES, VEHICLE_KEYS, type VehicleKey } from '../src/vehicles';

// thirteen smooth circuits and thirteen wild ones to fit on, and as many
// again of each to check
const range = (from: number, wild: boolean): Circuit[] => Array.from({ length: 13 }, (_, i) => ({ seed: from + i, wild }));
const FIT = [...range(0, false), ...range(1, true)];
const CHECK = [...range(13, false), ...range(14, true)];

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
  const all = { circuits: [...FIT, ...CHECK], laps: [...fitSet.laps, ...checkSet.laps], lifts: [...fitSet.lifts, ...checkSet.lifts] };
  const s = score(spec, all, fitted);
  const name = (c: Circuit) => `${c.wild ? 'wild ' : ''}#${c.seed}`;
  const misses = all.circuits.map((c, i) => [name(c), s.errors[i]] as const)
    .filter(([, e]) => Number.isFinite(e)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
  const unfinished = all.circuits.filter((_, i) => !Number.isFinite(all.laps[i])).map(name);
  console.log(`\n${spec.label} (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
  console.log(line('fitted  ', fitted));
  console.log(line('in force', spec.rating));
  const split = (set: typeof fitSet, rating: typeof fitted) => {
    const sc = score(spec, set, rating);
    const pick = (wild: boolean) => sc.errors.filter((e, i) => set.circuits[i].wild === wild && Number.isFinite(e));
    const fmt = (e: number[]) => `${pct(e.reduce((a, b) => a + Math.abs(b), 0) / e.length)} mean, ${pct(e.reduce((a, b) => a + b, 0) / e.length)} bias`;
    return `smooth ${fmt(pick(false))}; wild ${fmt(pick(true))}`;
  };
  console.log(`  checking circuits, fitted: ${split(checkSet, fitted)}`);
  console.log(`  worst misses ${misses.map(([c, e]) => `${c} ${pct(e)}`).join(', ')}${unfinished.length ? `; never finished ${unfinished.join(', ')}` : ''}`);
  console.log(`  difficulty against lifting, all circuits: r = ${s.liftCorrelation.toFixed(2)}`);
  console.log(`  laps ${all.laps.map((t) => t.toFixed(2)).join(' ')}`);
}
