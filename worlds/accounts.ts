// A synthetic set of 48 accounts for world files: 12 large, 18 mid-size, 10 small pilots, 8 partners.
import type { SimAccount } from '../src/index';

export function sampleAccounts(): SimAccount[] {
  const sizes = [...Array(12).fill(275), ...Array(18).fill(60), ...Array(10).fill(5), ...Array(8).fill(27)];
  const theatres = ['AMER', 'EMEA', 'APAC'];
  return sizes.map((seats, i) => ({
    id: `a${String(i + 1).padStart(2, '0')}`,
    seats,
    provisionedWeek: i % 3 === 0 ? -12 + (i % 20) : -12, // most exist before the window; a third arrive during it
    segment: i < 12 ? 'Large' : i < 30 ? 'Mid-size' : i < 40 ? 'Pilot' : 'Partner',
    theatre: theatres[i % 3],
  }));
}
