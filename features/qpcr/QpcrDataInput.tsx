import React, { useState, useEffect } from 'react';
import { QpcrConfig, QpcrRawData } from '../../types';
import { FileSpreadsheet, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clipboard, Activity } from 'lucide-react';

interface Props {
  config: QpcrConfig;
  initialData: QpcrRawData;
  onNext: (data: QpcrRawData) => void;
  onBack: () => void;
}

export const QpcrDataInput: React.FC<Props> = ({ config, initialData, onNext, onBack }) => {
  const [data, setData] = useState<QpcrRawData>(initialData);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  
  const currentGroup = config.groups[activeGroupIndex];
  const allGenes = [config.referenceGene, ...config.targetGenes];

  // Initialize data structure if empty
  useEffect(() => {
    const newData = { ...data };
    let hasChanges = false;
    config.groups.forEach(group => {
      if (!newData[group]) {
        newData[group] = {};
        hasChanges = true;
      }
      allGenes.forEach(gene => {
        if (!newData[group][gene]) {
          newData[group][gene] = Array(config.replicates).fill(null);
          hasChanges = true;
        }
      });
    });
    if (hasChanges) setData(newData);
  }, [config, data, allGenes]);

  // Handle manual input change
  const handleInputChange = (gene: string, index: number, value: string) => {
    const numVal = value === '' ? null : parseFloat(value);
    const newData = { ...data };
    newData[currentGroup][gene] = [...newData[currentGroup][gene]];
    newData[currentGroup][gene][index] = isNaN(numVal as number) ? null : numVal;
    setData(newData);
  };

  // Handle paste for a specific gene column
  const handlePaste = (e: React.ClipboardEvent, gene: string) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    // Split by newlines or spaces
    const values = pastedText.split(/[\n\s]+/).filter(v => v.trim() !== '').map(parseFloat);
    
    if (values.some(isNaN)) {
      alert('粘贴内容包含非数字字符，请检查。');
      return;
    }

    const newData = { ...data };
    const currentValues = [...newData[currentGroup][gene]];
    
    // Fill as many slots as possible up to replicates limit
    values.forEach((val, idx) => {
      if (idx < config.replicates) {
        currentValues[idx] = val;
      }
    });

    newData[currentGroup][gene] = currentValues;
    setData(newData);
  };

  const isGroupComplete = (group: string) => {
    if (!data[group]) return false;
    return allGenes.every(gene => {
      const vals = data[group][gene];
      return vals && vals.every(v => v !== null);
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-6xl mx-auto min-h-[600px] flex flex-col">
      <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-100 p-2 rounded-lg text-emerald-600">
            <FileSpreadsheet size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">数据录入</h2>
            <p className="text-sm text-slate-500">
              当前分组: <span className="font-bold text-science-600">{currentGroup}</span> 
              {config.controlGroup === currentGroup && <span className="ml-2 text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-500">对照组</span>}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
           <button 
            onClick={onBack}
            className="text-slate-500 hover:text-slate-800 px-4 py-2 text-sm font-medium"
          >
            返回设置
          </button>
          <div className="text-sm text-slate-400">
            步骤 2/3
          </div>
        </div>
      </div>

      {/* Tabs for Groups */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {config.groups.map((group, idx) => (
          <button
            key={group}
            onClick={() => setActiveGroupIndex(idx)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all
              ${activeGroupIndex === idx 
                ? 'bg-science-600 text-white shadow-md' 
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}
            `}
          >
            {group}
            {isGroupComplete(group) ? <CheckCircle2 size={14} className="text-emerald-300" /> : <div className="w-3 h-3 rounded-full bg-slate-300 opacity-50"/>}
          </button>
        ))}
      </div>

      {/* Data Entry Grid */}
      <div className="flex-1 overflow-x-auto">
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 mb-6 flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700">
                <strong>提示：</strong> 您可以直接从 Excel 或 Word 复制一列数据，并在下方的输入框中按 <span className="font-mono bg-amber-100 px-1 rounded">Ctrl+V</span> 直接粘贴。
            </p>
        </div>

        <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${allGenes.length}, minmax(200px, 1fr))` }}>
          {allGenes.map((gene) => (
            <div key={gene} className={`rounded-xl border ${gene === config.referenceGene ? 'border-purple-200 bg-purple-50/30' : 'border-slate-200 bg-white'}`}>
              <div className={`p-3 border-b ${gene === config.referenceGene ? 'border-purple-100 bg-purple-100/50' : 'border-slate-100 bg-slate-50'} rounded-t-xl`}>
                <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700">{gene}</span>
                    {gene === config.referenceGene && <span className="text-[10px] uppercase tracking-wide bg-purple-200 text-purple-700 px-1.5 py-0.5 rounded">Ref</span>}
                </div>
              </div>
              <div className="p-3 space-y-2">
                {Array.from({ length: config.replicates }).map((_, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-6 text-right">{idx + 1}</span>
                    <input
                      type="number"
                      placeholder="Ct Value"
                      value={data[currentGroup]?.[gene]?.[idx] ?? ''}
                      onChange={(e) => handleInputChange(gene, idx, e.target.value)}
                      onPaste={(e) => handlePaste(e, gene)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded focus:ring-2 focus:ring-science-500 focus:border-transparent outline-none transition-shadow"
                    />
                  </div>
                ))}
                <div className="pt-2">
                    <button className="w-full py-1 text-xs text-slate-400 hover:text-science-600 flex items-center justify-center gap-1 border border-dashed border-slate-300 rounded hover:border-science-300 hover:bg-science-50 transition-colors pointer-events-none">
                        <Clipboard size={12} />
                        在此列粘贴数据
                    </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 flex justify-between items-center border-t border-slate-100 pt-6">
        <button
            onClick={() => setActiveGroupIndex(Math.max(0, activeGroupIndex - 1))}
            disabled={activeGroupIndex === 0}
            className="flex items-center gap-1 text-slate-500 hover:text-science-600 disabled:opacity-30 disabled:hover:text-slate-500 px-4 py-2 font-medium transition-colors"
        >
            <ChevronLeft size={20} /> 上一组
        </button>
        
        {activeGroupIndex < config.groups.length - 1 ? (
             <button
                onClick={() => setActiveGroupIndex(activeGroupIndex + 1)}
                className="bg-slate-800 hover:bg-slate-900 text-white px-6 py-2 rounded-lg font-medium transition-all flex items-center gap-2"
            >
                下一组 <ChevronRight size={18} />
            </button>
        ) : (
            <button
                onClick={() => onNext(data)}
                className="bg-science-600 hover:bg-science-700 text-white px-8 py-3 rounded-lg font-medium shadow-lg shadow-science-500/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
            >
                开始分析 <Activity size={18} />
            </button>
        )}
      </div>
    </div>
  );
};