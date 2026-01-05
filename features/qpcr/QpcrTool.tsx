import React, { useState } from 'react';
import { QpcrConfig, QpcrRawData, AnalysisOutput } from '../../types';
import { QpcrConfigForm } from './QpcrConfigForm';
import { QpcrDataInput } from './QpcrDataInput';
import { QpcrResults } from './QpcrResults';
import { analyzeQpcrData } from '../../services/qpcrService';

export const QpcrTool: React.FC = () => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  
  const [config, setConfig] = useState<QpcrConfig>({
    replicates: 3,
    targetGenes: ['TargetGene1'],
    referenceGene: 'GAPDH',
    groups: ['Control', 'Treatment'],
    controlGroup: 'Control'
  });

  const [data, setData] = useState<QpcrRawData>({});
  const [results, setResults] = useState<AnalysisOutput | null>(null);

  const handleConfigComplete = (newConfig: QpcrConfig) => {
    setConfig(newConfig);
    setStep(2);
  };

  const handleDataComplete = (newData: QpcrRawData) => {
    setData(newData);
    const analysis = analyzeQpcrData(config, newData);
    setResults(analysis);
    setStep(3);
  };

  const reset = () => {
    setStep(1);
    setResults(null);
    setData({});
  };

  return (
    <div className="w-full animate-fade-in">
      {step === 1 && (
        <QpcrConfigForm 
          initialConfig={config} 
          onNext={handleConfigComplete} 
        />
      )}
      {step === 2 && (
        <QpcrDataInput 
          config={config} 
          initialData={data} 
          onNext={handleDataComplete}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && results && (
        <QpcrResults 
          config={config} 
          results={results} 
          onReset={reset}
          onBack={() => setStep(2)}
        />
      )}
    </div>
  );
};