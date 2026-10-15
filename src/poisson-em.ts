// Poisson regression with an identity link and non-negative coefficients:
//   y_j ~ Poisson(Σ_k β_k x_jk),  β_k ≥ 0, x_jk ≥ 0.
// Fit by EM (each step raises the likelihood; no optimizer library needed).

export type PoissonFit = { beta: number[]; logLik: number; iterations: number };

export function poissonEM(y: readonly number[], x: readonly (readonly number[])[], init: readonly number[], maxIter = 500, tol = 1e-9): PoissonFit {
  const k = init.length;
  const beta = init.map((b) => Math.max(b, 1e-12));
  const colSum = Array(k).fill(0);
  for (const row of x) for (let i = 0; i < k; i++) colSum[i] += row[i];
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const num = Array(k).fill(0);
    for (let j = 0; j < y.length; j++) {
      if (!y[j]) continue;
      const lam = rate(beta, x[j]);
      if (lam <= 0) continue;
      for (let i = 0; i < k; i++) num[i] += (y[j] * beta[i] * x[j][i]) / lam;
    }
    let change = 0;
    for (let i = 0; i < k; i++) {
      const next = colSum[i] > 0 ? num[i] / colSum[i] : 0;
      change = Math.max(change, Math.abs(next - beta[i]) / Math.max(Math.abs(beta[i]), 1e-12));
      beta[i] = next;
    }
    if (change < tol) break;
  }
  return { beta, logLik: poissonLogLik(y, x, beta), iterations };
}

export function rate(beta: readonly number[], row: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < beta.length; i++) s += beta[i] * row[i];
  return s;
}

/** Poisson log-likelihood without the constant −log(y!). */
export function poissonLogLik(y: readonly number[], x: readonly (readonly number[])[], beta: readonly number[]): number {
  let ll = 0;
  for (let j = 0; j < y.length; j++) {
    const lam = rate(beta, x[j]);
    if (lam <= 0) {
      if (y[j] > 0) return -Infinity;
      continue;
    }
    ll += y[j] * Math.log(lam) - lam;
  }
  return ll;
}
