import React, { useState, useMemo, useRef } from 'react';
import { Grid3x3, Plus, Trash2, ArrowDown, ArrowRight, Download, RefreshCw, FileDown, Layers } from 'lucide-react';

// --- Types ---

interface WellData {
  sample: string | null;
  target: string | null;
  replicateId: number | null;
}

type PlateLayout = Record<string, WellData>;

// --- Constants ---

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];

// --- Helper Functions ---

const getWellId = (row: number, col: number) => `${ROWS[row]}${col + 1}`;

export const QpcrLayoutTool: React.FC = () => {
  // --- State ---
  const [plateType, setPlateType] = useState<'96' | '384'>('96');
  
  // Inputs
  const [samples, setSamples] = useState<string[]>(['Control', 'Treatment A', 'Treatment B']);
  const [targets, setTargets] = useState<string[]>(['GAPDH', 'Gene 1', 'Gene 2']);
  const [replicates, setReplicates] = useState<number>(3);
  const [fillDirection, setFillDirection] = useState<'row' | 'col'>('row'); // row-wise (horizontal) or col-wise (vertical)
  const [groupingMode, setGroupingMode] = useState<'sample_first' | 'target_first'>('sample_first'); 
  // sample_first: Sample1(Gene1, Gene2...), Sample2...
  // target_first: Gene1(Sample1, Sample2...), Gene2...

  // New Inputs
  const [newSample, setNewSample] = useState('');
  const [newTarget, setNewTarget] = useState('');

  // Generated Layout
  const layout = useMemo(() => {
    const newLayout: PlateLayout = {};
    const maxRows = plateType === '96' ? 8 : 16;
    const maxCols = plateType === '96' ? 12 : 24;
    
    // Flatten the list of items to place based on grouping mode
    let itemsToPlace: { sample: string, target: string, rep: number }[] = [];

    if (groupingMode === 'sample_first') {
        samples.forEach(sample => {
            targets.forEach(target => {
                for(let r=1; r<=replicates; r++) itemsToPlace.push({ sample, target, rep: r });
            });
        });
    } else {
        targets.forEach(target => {
            samples.forEach(sample => {
                for(let r=1; r<=replicates; r++) itemsToPlace.push({ sample, target, rep: r });
            });
        });
    }

    // Assign to wells
    itemsToPlace.forEach((item, index) => {
        let r, c;
        if (fillDirection === 'row') {
            // Fill row by row: A1, A2, A3... A12, B1...
            r = Math.floor(index / maxCols);
            c = index % maxCols;
        } else {
            // Fill col by col: A1, B1, C1... H1, A2...
            c = Math.floor(index / maxRows);
            r = index % maxRows;
        }

        if (r < maxRows && c < maxCols) {
            newLayout[getWellId(r, c)] = {
                sample: item.sample,
                target: item.target,
                replicateId: item.rep
            };
        }
    });

    return newLayout;
  }, [plateType, samples, targets, replicates, fillDirection, groupingMode]);

  // --- Handlers ---

  const addSample = () => {
      if (newSample && !samples.includes(newSample)) {
          setSamples([...samples, newSample]);
          setNewSample('');
      }
  };
  const removeSample = (s: string) => setSamples(samples.filter(x => x !== s));

  const addTarget = () => {
      if (newTarget && !targets.includes(newTarget)) {
          setTargets([...targets, newTarget]);
          setNewTarget('');
      }
  };
  const removeTarget = (t: string) => setTargets(targets.filter(x => x !== t));

  const handleExportCsv = () => {
      let csv = "\uFEFFWell,Sample,Target,Replicate\n";
      const maxRows = plateType === '96' ? 8 : 16;
      const maxCols = plateType === '96' ? 12 : 24;

      for (let r = 0; r < maxRows; r++) {
          for (let c = 0; c < maxCols; c++) {
              const id = getWellId(r, c);
              const well = layout[id];
              if (well) {
                  csv += `${id},"${well.sample}","${well.target}",${well.replicateId}\n`;
              }
          }
      }

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `qPCR_Layout_${plateType}well.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  // --- Visuals ---
  const rows = plateType === '96' ? 8 : 16;
  const cols = plateType === '96' ? 12 : 24;
  
  // Color generation helper
  const getColor = (str: string, type: 'sample' | 'target') => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
      const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
      const hex = "00000".substring(0, 6 - c.length) + c;
      // Use different hue ranges/saturations for samples vs targets if needed, 
      // but simple distinct colors work best.
      return `#${hex}`;
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-blue-100 p-3 rounded-2xl text-blue-600">
                <Grid3x3 size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">qPCR 加样排布设计</h2>
               <p className="text-slate-500">自动生成孔板布局，支持多种排列策略与导出</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 items-start">
           
           {/* LEFT: Settings */}
           <div className="lg:col-span-3 space-y-6">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-6">
                   
                   {/* Plate Type */}
                   <div>
                       <label className="block text-xs font-bold text-slate-500 mb-2">板型选择</label>
                       <div className="flex p-1 bg-slate-100 rounded-lg">
                           <button onClick={() => setPlateType('96')} className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${plateType === '96' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>96-Well</button>
                           <button onClick={() => setPlateType('384')} className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${plateType === '384' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>384-Well</button>
                       </div>
                   </div>

                   {/* Samples */}
                   <div>
                       <label className="block text-xs font-bold text-slate-500 mb-2">样本 (Samples)</label>
                       <div className="flex gap-2 mb-2">
                           <input 
                               value={newSample}
                               onChange={e => setNewSample(e.target.value)}
                               onKeyDown={e => e.key === 'Enter' && addSample()}
                               className="flex-1 px-3 py-1.5 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none"
                               placeholder="Add Sample..."
                           />
                           <button onClick={addSample} className="bg-blue-50 text-blue-600 p-1.5 rounded hover:bg-blue-100"><Plus size={18} /></button>
                       </div>
                       <div className="flex flex-wrap gap-2">
                           {samples.map(s => (
                               <span key={s} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs">
                                   {s} <button onClick={() => removeSample(s)} className="hover:text-red-500"><Trash2 size={12} /></button>
                               </span>
                           ))}
                       </div>
                   </div>

                   {/* Targets */}
                   <div>
                       <label className="block text-xs font-bold text-slate-500 mb-2">基因 (Targets)</label>
                       <div className="flex gap-2 mb-2">
                           <input 
                               value={newTarget}
                               onChange={e => setNewTarget(e.target.value)}
                               onKeyDown={e => e.key === 'Enter' && addTarget()}
                               className="flex-1 px-3 py-1.5 text-sm border rounded focus:ring-2 focus:ring-blue-500 outline-none"
                               placeholder="Add Target..."
                           />
                           <button onClick={addTarget} className="bg-blue-50 text-blue-600 p-1.5 rounded hover:bg-blue-100"><Plus size={18} /></button>
                       </div>
                       <div className="flex flex-wrap gap-2">
                           {targets.map(t => (
                               <span key={t} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 px-2 py-1 rounded text-xs border border-purple-100">
                                   {t} <button onClick={() => removeTarget(t)} className="hover:text-red-500"><Trash2 size={12} /></button>
                               </span>
                           ))}
                       </div>
                   </div>

                   {/* Settings */}
                   <div className="pt-4 border-t border-slate-100 space-y-4">
                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-2">复孔数 (Replicates)</label>
                           <input 
                                type="number" min="1" max="10"
                                value={replicates}
                                onChange={e => setReplicates(parseInt(e.target.value))}
                                className="w-full px-3 py-1.5 text-sm border rounded"
                           />
                       </div>

                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-2">排列方向</label>
                           <div className="grid grid-cols-2 gap-2">
                               <button onClick={() => setFillDirection('row')} className={`flex items-center justify-center gap-2 py-2 border rounded-lg text-xs transition-colors ${fillDirection === 'row' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                                   <ArrowRight size={14} /> 按行 (Row)
                               </button>
                               <button onClick={() => setFillDirection('col')} className={`flex items-center justify-center gap-2 py-2 border rounded-lg text-xs transition-colors ${fillDirection === 'col' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                                   <ArrowDown size={14} /> 按列 (Col)
                               </button>
                           </div>
                       </div>

                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-2">分组优先</label>
                           <select 
                                value={groupingMode} 
                                onChange={e => setGroupingMode(e.target.value as any)}
                                className="w-full text-sm border rounded px-2 py-1.5"
                           >
                               <option value="sample_first">样本优先 (Sample First)</option>
                               <option value="target_first">基因优先 (Target First)</option>
                           </select>
                           <p className="text-[10px] text-slate-400 mt-1">
                               {groupingMode === 'sample_first' ? 'S1(G1,G2...), S2(G1,G2...)' : 'G1(S1,S2...), G2(S1,S2...)'}
                           </p>
                       </div>
                   </div>

                   <button 
                        onClick={handleExportCsv}
                        className="w-full bg-slate-800 hover:bg-slate-900 text-white py-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all active:scale-95"
                   >
                       <Download size={16} /> 导出 CSV 表格
                   </button>
               </div>
           </div>

           {/* RIGHT: Visual Plate */}
           <div className="lg:col-span-9">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 overflow-x-auto">
                   <div className="min-w-[800px]">
                       {/* Header Numbers */}
                       <div className="flex mb-2">
                           <div className="w-8"></div> {/* Corner spacer */}
                           {Array.from({ length: cols }).map((_, i) => (
                               <div key={i} className="flex-1 text-center text-xs font-bold text-slate-400">
                                   {i + 1}
                               </div>
                           ))}
                       </div>

                       {/* Grid */}
                       <div className="flex flex-col gap-1.5">
                           {Array.from({ length: rows }).map((_, rIndex) => (
                               <div key={rIndex} className="flex gap-1.5 h-12">
                                   {/* Row Label */}
                                   <div className="w-8 flex items-center justify-center text-xs font-bold text-slate-400">
                                       {ROWS[rIndex]}
                                   </div>
                                   
                                   {/* Wells */}
                                   {Array.from({ length: cols }).map((_, cIndex) => {
                                       const wellId = getWellId(rIndex, cIndex);
                                       const data = layout[wellId];
                                       const isEmpty = !data;
                                       
                                       // Simple color generation based on Sample
                                       const bgColor = isEmpty ? '#f1f5f9' : '#eff6ff';
                                       const borderColor = isEmpty ? '#e2e8f0' : '#bfdbfe';
                                       
                                       return (
                                           <div 
                                              key={wellId}
                                              className={`flex-1 relative rounded border flex flex-col items-center justify-center text-[10px] transition-all group cursor-default select-none overflow-hidden
                                                ${isEmpty ? 'bg-slate-100 border-slate-200' : 'bg-blue-50/50 border-blue-200 hover:border-blue-400 hover:shadow-md'}
                                              `}
                                              title={data ? `Well: ${wellId}\nSample: ${data.sample}\nTarget: ${data.target}\nRep: ${data.replicateId}` : wellId}
                                           >
                                               {data ? (
                                                   <>
                                                       {/* Use color strip or full bg for Sample ID? */}
                                                       <div className="font-bold text-slate-700 truncate w-full text-center px-0.5 leading-tight scale-90">{data.sample}</div>
                                                       <div className="text-slate-500 truncate w-full text-center px-0.5 leading-tight scale-75">{data.target}</div>
                                                       <div className="absolute top-0 right-0.5 text-[8px] text-blue-300 opacity-50">{data.replicateId}</div>
                                                   </>
                                               ) : (
                                                   <span className="text-slate-300 text-[9px] opacity-0 group-hover:opacity-100">{wellId}</span>
                                               )}
                                           </div>
                                       );
                                   })}
                               </div>
                           ))}
                       </div>
                   </div>
               </div>
               
               <div className="mt-4 flex gap-4 text-xs text-slate-500 justify-end">
                   <div className="flex items-center gap-1.5">
                       <div className="w-3 h-3 bg-blue-50 border border-blue-200 rounded"></div>
                       <span>已填充</span>
                   </div>
                   <div className="flex items-center gap-1.5">
                       <div className="w-3 h-3 bg-slate-100 border border-slate-200 rounded"></div>
                       <span>空孔</span>
                   </div>
               </div>
           </div>
       </div>
    </div>
  );
};