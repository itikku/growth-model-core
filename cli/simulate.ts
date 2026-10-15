// Generate sample data from a world file, to explore a thesis or test the fit on known parameters.
//   npx tsx cli/simulate.ts worlds/review-networks.ts out/review-networks [--seed s1]
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { simulatePanel, type WorldSpec } from '../src/index';
import { writePanel } from './panel-io';

const [file, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const i = process.argv.indexOf('--seed');
const seed = i >= 0 ? process.argv[i + 1] : 's1';
if (!file || !out) {
  console.error('Usage: npx tsx cli/simulate.ts <world file> <output folder> [--seed s1]');
  process.exit(1);
}
const mod = await import(pathToFileURL(resolve(file)).href);
const world: WorldSpec = mod.default;
mkdirSync(out, { recursive: true });
const panel = simulatePanel(world, seed);
writePanel(out, panel);
console.log(`Wrote ${panel.accounts.length} accounts, ${panel.accountWeeks.length} account-weeks, ${panel.engineerWeeks.length} engineer-weeks to ${out}`);
