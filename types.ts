export interface QpcrConfig {
  replicates: number;
  targetGenes: string[];
  referenceGene: string;
  groups: string[];
  controlGroup: string;
}

// Map structure: GroupName -> GeneName -> Array of Ct values
export type QpcrRawData = Record<string, Record<string, (number | null)[]>>;

export interface QpcrSampleResult {
  group: string;
  sampleIndex: number;
  targetGene: string;
  ctTarget: number | null;
  ctRef: number | null;
  deltaCt: number | null;
  deltaDeltaCt: number | null;
  foldChange: number | null;
}

export interface QpcrGroupResult {
  group: string;
  targetGene: string;
  avgFoldChange: number;
  stdev: number;
  sem: number; // Standard Error of Mean
}

export interface AnalysisOutput {
  sampleResults: QpcrSampleResult[];
  groupResults: QpcrGroupResult[];
}