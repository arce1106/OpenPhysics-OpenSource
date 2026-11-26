export type SimulationDimension = '2d' | '3d';

export type SimulationStatus = 'available' | 'planned';

export interface SimulationCatalogEntry {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  dimension: SimulationDimension;
  status: SimulationStatus;
  knowledgePointIds: string[];
}
