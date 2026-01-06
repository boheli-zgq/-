import React, { useState, useEffect, useMemo } from 'react';
import { Pipette, Plus, Trash2, Calculator, Info, AlertCircle, Copy, CheckCircle2 } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart, ReferenceLine } from 'recharts';

// --- Types ---
interface StandardPoint {
  id: string;
  conc: number; // mg/mL
  od: number;
}

interface Sample {
  id: string;
  name: string;
  od: number;
  dilution: number;
  // Computed
  conc?: number;
}

interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
  fn: (y: number) => number; // Function to calculate x (conc) from y (od)
}

// --- Helper: Linear Regression ---
// Fits y = mx + b (OD = slope * Conc + intercept)
const calculateLinearRegression = (points: StandardPoint[]): RegressionResult | null => {
  if (points.length < 2) return null;

  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  points.forEach(p => {
    sumX += p.conc;
    sumY += p.od;
    sumXY += p.conc * p.od;
    sumX2 += p.conc * p.conc;
    sumY2 += p.od * p.od;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R2 Calculation
  const ssTot = sumY2 - (sumY * sumY) / n;
  const ssRes = sumY2 - intercept * sumY - slope * sumXY; // Simplified form
  
  // Alternatively: R2 = (n*sumXY - sumX*sumY)^2 / ((n*sumX2 - sumX^2)(n*sumY2 - sumY^2))
  const numerator = (n * sumXY - sumX * sumY);
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  const r2 = denominator === 0 ? 0 : Math.pow(numerator / denominator, 2);

  return {
    slope,
    intercept,
    r2,
    fn: (od: number) => (od - intercept) / slope
  };
};

export const BcaTool: React.FC = () => {
  // --- State ---
  const [subtractBlank, setSubtractBlank] = useState(true);
  
  // Default Standards (BSA commonly used points: 0, 0.125, 0.25, 0.5, 1.0, 2.0)
  const [standards, setStandards] = useState<StandardPoint[]>([
    { id: '1', conc: 0, od: 0.05 },
    { id: '2', conc: 0.125, od: 0.15 },
    { id: '3', conc: 0.25, od: 0.28 },
    { id: '4', conc: 0.5, od: 0.55 },
    { id: '5', conc: 1.0, od: 1.05 },
    { id: '6', conc: 2.0, od: 1.95 },
  ]);

  const [samples, setSamples] = useState<Sample[]>([
    { id: 's1', name: 'Sample 1', od: 0.45, dilution: 1 },
    { id: 's2', name: 'Sample 2', od: 0.88, dilution: 5 },
  ]);

  // --- Logic ---
  
  // 1. Process Standards (Blank Correction)
  const processedStandards = useMemo(() => {
    if (!subtractBlank) return standards;
    
    // Find the blank (conc === 0)
    const blankPoint = standards.find(s => s.conc === 0);
    const blankOD = blankPoint ? blankPoint.od : 0;

    return standards.map(s => ({
      ...s,
      od: Math.max(0, s.od - blankOD) // Ensure no negative OD
    })).filter(s => s.conc > 0 || !blankPoint); // Keep 0 point for chart visualization usually, but regression needs to handle it.
  }, [standards, subtractBlank]);

  // 2. Perform Regression
  const regression = useMemo(() => {
    return calculateLinearRegression(processedStandards);
  }, [processedStandards]);

  // 3. Process Samples
  const computedSamples = useMemo(() => {
    if (!regression) return samples;
    
    // Blank correction for samples too
    const blankPoint = standards.find(s => s.conc === 0);
    const blankOD = (subtractBlank && blankPoint) ? blankPoint.od : 0;

    return samples.map(s => {
      const correctedOD = Math.max(0, s.od - blankOD);
      const rawConc = regression.fn(correctedOD);
      // Ensure concentration isn't negative due to noise
      const validConc = rawConc < 0 ? 0 : rawConc;
      return {
        ...s,
        conc: validConc * s.dilution
      };
    });
  }, [samples, regression, subtractBlank, standards]);

  // --- Handlers ---
  
  const updateStandard = (id: string, field: keyof StandardPoint, val: string) => {
    const num = parseFloat(val);
    setStandards(prev => prev.map(s => s.id === id ? { ...s, [field]: isNaN(num) ? 0 : num } : s));
  };

  const addStandard = () => {
    setStandards(prev => [...prev, { id: Date.now().toString(), conc: 0, od: 0 }]);
  };

  const removeStandard = (id: string) => {
    if (standards.length <= 2) return;
    setStandards(prev => prev.filter(s => s.id !== id));
  };

  const updateSample = (id: string, field: keyof Sample, val: string) => {
    const num = val === '' ? 0 : parseFloat(val); // Allow typing
    if (field === 'name') {
       setSamples(prev => prev.map(s => s.id === id ? { ...s, name: val } : s));
    } else {
       setSamples(prev => prev.map(s => s.id === id ? { ...s, [field]: isNaN(num) ? 0 : num } : s));
    }
  };

  const addSample = () => {
    setSamples(prev => [...prev, { id: Date.now().toString(), name: `Sample ${prev.length + 1}`, od: 0, dilution: 1 }]);
  };

  const removeSample = (id: string) => {
     setSamples(prev => prev.filter(s => s.id !== id));
  };

  // Paste handler for samples (supports Name, OD, Dilution or just OD)
  const handlePasteSamples = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const rows = text.trim().split(/\r\n|\n|\r/);
    
    const newSamples: Sample[] = rows.map((row, idx) => {
        const cols = row.split(/\t|,/).map(c => c.trim());
        // Heuristic: If 1 col -> OD. If 2 cols -> Name, OD. If 3 -> Name, OD, Dilution.
        let name = `Batch ${idx + 1}`;
        let od = 0;
        let dilution = 1;

        if (cols.length === 1) {
            od = parseFloat(cols[0]) || 0;
        } else if (cols.length === 2) {
            // Check if col 0 is number
            if (!isNaN(parseFloat(cols[0]))) {
                od = parseFloat(cols[0]);
                dilution = parseFloat(cols[1]) || 1;
            } else {
                name = cols[0];
                od = parseFloat(cols[1]) || 0;
            }
        } else if (cols.length >= 3) {
            name = cols[0];
            od = parseFloat(cols[1]) || 0;
            dilution = parseFloat(cols[2]) || 1;
        }

        return {
            id: Date.now().toString() + idx,
            name,
            od,
            dilution
        };
    });

    if (newSamples.length > 0) {
        if (confirm(`检测到 ${newSamples.length} 条数据，是否覆盖现有样品列表？(取消则追加)`)) {
            setSamples(newSamples);
        } else {
            setSamples(prev => [...prev, ...newSamples]);
        }
    }
  };

  // --- Chart Data Preparation ---
  const chartData = useMemo(() => {
    // Generate line points
    const maxConc = Math.max(...processedStandards.map(s => s.conc)) || 2;
    const lineData = [
       { conc: 0, trend: regression ? regression.intercept : 0 },
       { conc: maxConc * 1.1, trend: regression ? (regression.slope * maxConc * 1.1 + regression.intercept) : 0 }
    ];
    return { points: processedStandards, line: lineData };
  }, [processedStandards, regression]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-orange-100 p-3 rounded-2xl text-orange-600">
                <Pipette size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">BCA 蛋白定量分析</h2>
               <p className="text-slate-500">构建标准曲线，快速计算样品浓度</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6">
           {/* LEFT: Configuration & Standards (4 cols) */}
           <div className="lg:col-span-4 space-y-6">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                   <div className="flex items-center justify-between mb-4">
                       <h3 className="font-bold text-slate-700 flex items-center gap-2">
                           <Calculator size={18} /> 标准曲线设置
                       </h3>
                   </div>
                   
                   <div className="space-y-4">
                       <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-100">
                           <span className="text-sm text-slate-600">扣除空白 (Blank Correction)</span>
                           <label className="relative inline-flex items-center cursor-pointer">
                               <input type="checkbox" checked={subtractBlank} onChange={e => setSubtractBlank(e.target.checked)} className="sr-only peer" />
                               <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                           </label>
                       </div>
                       
                       {regression && (
                           <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1">
                               <div className="text-xs text-blue-500 font-bold uppercase tracking-wide">拟合结果 (Linear)</div>
                               <div className="font-mono text-sm text-blue-800">
                                   R² = {regression.r2.toFixed(4)}
                               </div>
                               <div className="font-mono text-xs text-blue-600 truncate" title={`OD = ${regression.slope.toFixed(4)} * Conc + ${regression.intercept.toFixed(4)}`}>
                                   y = {regression.slope.toFixed(3)}x + {regression.intercept.toFixed(3)}
                               </div>
                           </div>
                       )}
                   </div>
               </div>

               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 overflow-hidden">
                   <div className="flex items-center justify-between mb-4">
                       <h3 className="font-bold text-slate-700">标准品 (Standards)</h3>
                       <button onClick={addStandard} className="p-1 hover:bg-slate-100 rounded text-slate-500"><Plus size={18} /></button>
                   </div>
                   
                   <div className="overflow-x-auto">
                       <table className="w-full text-sm">
                           <thead className="bg-slate-50 text-slate-500">
                               <tr>
                                   <th className="px-2 py-2 text-left w-16">#</th>
                                   <th className="px-2 py-2 text-left">Conc (mg/mL)</th>
                                   <th className="px-2 py-2 text-left">OD (Abs)</th>
                                   <th className="px-2 py-2 w-8"></th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                               {standards.map((s, idx) => (
                                   <tr key={s.id}>
                                       <td className="px-2 py-2 text-slate-400 font-mono text-xs">{idx + 1}</td>
                                       <td className="px-2 py-2">
                                           <input 
                                             type="number" 
                                             value={s.conc} 
                                             onChange={e => updateStandard(s.id, 'conc', e.target.value)}
                                             className="w-full bg-slate-50 border border-transparent hover:border-slate-300 focus:border-orange-500 rounded px-1.5 py-1 text-center outline-none transition-colors"
                                           />
                                       </td>
                                       <td className="px-2 py-2">
                                           <input 
                                             type="number" 
                                             value={s.od} 
                                             onChange={e => updateStandard(s.id, 'od', e.target.value)}
                                             className="w-full bg-slate-50 border border-transparent hover:border-slate-300 focus:border-orange-500 rounded px-1.5 py-1 text-center outline-none transition-colors"
                                           />
                                       </td>
                                       <td className="px-2 py-2 text-center">
                                            <button onClick={() => removeStandard(s.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                   </div>
                   <div className="mt-2 text-xs text-slate-400 flex items-start gap-1">
                       <Info size={12} className="mt-0.5 shrink-0" />
                       <p>Conc为0的点将作为Blank(空白)被自动扣除。</p>
                   </div>
               </div>
           </div>

           {/* MIDDLE/RIGHT: Chart & Samples (8 cols) */}
           <div className="lg:col-span-8 space-y-6">
               {/* Chart */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-[320px]">
                   <ResponsiveContainer width="100%" height="100%">
                       <ComposedChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                           <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                           <XAxis 
                                dataKey="conc" 
                                type="number" 
                                name="Concentration" 
                                unit=" mg/mL" 
                                label={{ value: 'Concentration (mg/mL)', position: 'bottom', offset: 0, style: { fill: '#64748b', fontSize: 12 } }}
                                domain={['dataMin', 'dataMax']}
                                allowDataOverflow={false} 
                           />
                           <YAxis 
                                type="number" 
                                name="OD" 
                                label={{ value: 'OD (Absorbance)', angle: -90, position: 'insideLeft', style: { fill: '#64748b', fontSize: 12 } }} 
                           />
                           <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                           <Scatter name="Standards" data={chartData.points} fill="#f97316" shape="circle" />
                           <Line data={chartData.line} dataKey="trend" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={false} type="monotone" />
                       </ComposedChart>
                   </ResponsiveContainer>
               </div>

               {/* Samples Table */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                   <div className="flex items-center justify-between mb-4">
                       <div>
                           <h3 className="font-bold text-slate-700">未知样品 (Samples)</h3>
                           <p className="text-xs text-slate-400 mt-1">支持粘贴 Excel 数据 (名称, OD, 稀释倍数)</p>
                       </div>
                       <div className="flex gap-2">
                           <button onClick={addSample} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-1">
                               <Plus size={16} /> 添加行
                           </button>
                       </div>
                   </div>

                   <div className="overflow-x-auto border rounded-lg border-slate-100" onPaste={handlePasteSamples}>
                       <table className="w-full text-sm">
                           <thead className="bg-slate-50 text-slate-500 font-medium">
                               <tr>
                                   <th className="px-4 py-3 text-left">样品名称</th>
                                   <th className="px-4 py-3 text-right w-24">OD 值</th>
                                   <th className="px-4 py-3 text-right w-24">稀释倍数</th>
                                   <th className="px-4 py-3 text-right w-32 bg-orange-50 text-orange-700">计算浓度 (mg/mL)</th>
                                   <th className="px-2 py-3 w-10"></th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100 bg-white">
                               {computedSamples.map((s) => (
                                   <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                                       <td className="px-4 py-2">
                                           <input 
                                             type="text" 
                                             value={s.name} 
                                             onChange={e => updateSample(s.id, 'name', e.target.value)}
                                             className="w-full bg-transparent border-none focus:ring-0 text-slate-700 font-medium placeholder-slate-300"
                                             placeholder="Sample Name"
                                           />
                                       </td>
                                       <td className="px-4 py-2">
                                           <input 
                                             type="number" 
                                             value={s.od} 
                                             onChange={e => updateSample(s.id, 'od', e.target.value)}
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-right focus:border-orange-500 outline-none"
                                           />
                                       </td>
                                       <td className="px-4 py-2">
                                            <input 
                                             type="number" 
                                             value={s.dilution} 
                                             onChange={e => updateSample(s.id, 'dilution', e.target.value)}
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-right focus:border-orange-500 outline-none"
                                           />
                                       </td>
                                       <td className="px-4 py-2 text-right font-bold text-orange-600 bg-orange-50/30">
                                           {s.conc !== undefined ? s.conc.toFixed(4) : '-'}
                                       </td>
                                       <td className="px-2 py-2 text-center">
                                            <button onClick={() => removeSample(s.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                       {computedSamples.length === 0 && (
                           <div className="p-8 text-center text-slate-400 text-sm border-t border-slate-100">
                               在此处粘贴 Excel 数据，或点击上方按钮添加样品。
                           </div>
                       )}
                   </div>
               </div>
           </div>
       </div>
    </div>
  );
};