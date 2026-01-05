import { AnalysisOutput, QpcrConfig, QpcrGroupResult, QpcrRawData, QpcrSampleResult } from '../types';

// Helper to calculate mean ignoring nulls
const calculateMean = (values: (number | null)[]): number | null => {
  const validValues = values.filter((v): v is number => v !== null && !isNaN(v));
  if (validValues.length === 0) return null;
  return validValues.reduce((a, b) => a + b, 0) / validValues.length;
};

// Helper for standard deviation
const calculateStdev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  return Math.sqrt(avgSquareDiff);
};

export const analyzeQpcrData = (config: QpcrConfig, data: QpcrRawData): AnalysisOutput => {
  const sampleResults: QpcrSampleResult[] = [];
  const groupResults: QpcrGroupResult[] = [];

  // 1. Calculate Average Delta Ct for Control Group first (needed for ddCt)
  // Structure: TargetGene -> AverageDeltaCtControl
  const controlDeltaCtMeans: Record<string, number> = {};

  // First pass: Calculate Delta Cts for Control Group to find the baseline
  config.targetGenes.forEach(target => {
    const controlRefCts = data[config.controlGroup]?.[config.referenceGene] || [];
    const controlTargetCts = data[config.controlGroup]?.[target] || [];
    
    const validDeltaCts: number[] = [];

    for (let i = 0; i < config.replicates; i++) {
      const ctRef = controlRefCts[i];
      const ctTarget = controlTargetCts[i];

      if (ctRef !== null && ctTarget !== null) {
        validDeltaCts.push(ctTarget - ctRef);
      }
    }
    
    controlDeltaCtMeans[target] = validDeltaCts.length > 0 
      ? validDeltaCts.reduce((a,b) => a+b, 0) / validDeltaCts.length 
      : 0;
  });

  // 2. Calculate Fold Changes for ALL groups (including control)
  config.groups.forEach(group => {
    config.targetGenes.forEach(target => {
      const refCts = data[group]?.[config.referenceGene] || [];
      const targetCts = data[group]?.[target] || [];
      const foldChanges: number[] = [];

      for (let i = 0; i < config.replicates; i++) {
        const ctRef = refCts[i];
        const ctTarget = targetCts[i];
        let deltaCt: number | null = null;
        let deltaDeltaCt: number | null = null;
        let foldChange: number | null = null;

        if (ctRef !== null && ctTarget !== null) {
          deltaCt = ctTarget - ctRef;
          // ddCt = dCt(sample) - Avg_dCt(control)
          deltaDeltaCt = deltaCt - (controlDeltaCtMeans[target] || 0);
          foldChange = Math.pow(2, -deltaDeltaCt);
          foldChanges.push(foldChange);
        }

        sampleResults.push({
          group,
          sampleIndex: i + 1,
          targetGene: target,
          ctRef,
          ctTarget,
          deltaCt,
          deltaDeltaCt,
          foldChange
        });
      }

      // 3. Aggregate Group Stats
      if (foldChanges.length > 0) {
        const avgFc = calculateMean(foldChanges) || 0;
        const stdev = calculateStdev(foldChanges);
        const sem = stdev / Math.sqrt(foldChanges.length);

        groupResults.push({
          group,
          targetGene: target,
          avgFoldChange: avgFc,
          stdev,
          sem
        });
      }
    });
  });

  return { sampleResults, groupResults };
};

export const generateCsv = (output: AnalysisOutput): string => {
  // Add BOM for Excel UTF-8 compatibility
  let csvContent = "\uFEFF"; 
  
  // Section 1: Summary Statistics
  csvContent += "统计摘要 (Summary Statistics)\n";
  csvContent += "分组 (Group),目的基因 (Target Gene),平均相对表达量 (Avg Fold Change),标准差 (SD),标准误 (SEM)\n";
  output.groupResults.forEach(res => {
    csvContent += `${res.group},${res.targetGene},${res.avgFoldChange.toFixed(4)},${res.stdev.toFixed(4)},${res.sem.toFixed(4)}\n`;
  });

  csvContent += "\n";

  // Section 2: Detailed Data
  csvContent += "详细数据 (Detailed Data)\n";
  csvContent += "分组 (Group),样本编号 (Rep),目的基因 (Target),Ct (Ref),Ct (Target),ΔCt,ΔΔCt,相对表达量 (2^-ΔΔCt)\n";
  output.sampleResults.forEach(res => {
    csvContent += `${res.group},${res.sampleIndex},${res.targetGene},${res.ctRef ?? ''},${res.ctTarget ?? ''},${res.deltaCt?.toFixed(4) ?? ''},${res.deltaDeltaCt?.toFixed(4) ?? ''},${res.foldChange?.toFixed(4) ?? ''}\n`;
  });

  return csvContent;
};