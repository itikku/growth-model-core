// Growth model core. One identity, four fitted parts:
//   tokens = active accounts × engaged users per account × workflows per user × tokens per workflow
export * from './types';
export { fitModel, fitIndexed } from './fit';
export { indexPanel, type PanelIndex } from './panel';
export { forecast, FORECAST_WEEKS, type ForecastOutput, type ForecastPoint } from './forecast';
export { elasticities, STEP, type ElasticityRow } from './impact';
export { LEVERS, LEVER_BY_ID, applyLever, type LeverId, type LeverMeta, type Levers } from './levers';
export { classifyStages, STAGES, type GrowthStage, type StageResult } from './stage';
export { resolveScope, type ResolvedScope, type ScopeFilter } from './scope';
export { decompose, type Decomposition, type Factors } from './decompose';
export { curve } from './fit-depth';
export { simulatePanel, type WorldSpec } from './reference';
