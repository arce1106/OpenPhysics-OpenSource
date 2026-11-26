import type { SimulationCatalogEntry } from '../core/types';

export interface SimulationScenario<TParameters> extends SimulationCatalogEntry {
  defaultParameters: TParameters;
  maximumDuration: number;
  teachingGoals: string[];
}
