import React, { useState, useMemo } from 'react';
import { AlignCenterVertical, Upload, Download, RefreshCw, ArrowRight, Info, Calculator, FlaskConical, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, Cell } from 'recharts';

interface SampleData {
  id: string;
  name: string;
  currentVol: number; // uL
  intensity: number; // IntDen or Density
}

type NormStrategy = 'mean' | 'weakest' | 'strongest' | 'manual';

const DEFAULT_INPUT = `Sample\tVol(uL)\tIntensity
Ctrl-1\t10\t5420
Ctrl-2\t10\t5210
Treat-1\t10\t3100
Treat-2\t10\t2950
Treat-3\t10\t3200`;

export const WesternNormTool: React.FC = () => {
  const [inputText, setInputText] = useState(DEFAULT_INPUT);
  const [strategy, setStrategy] = useState<NormStrategy>('mean');
  const [refVolume, setRefVolume] = useState<number>(10); // Target volume for the reference sample
  const [manualRefIndex, setManualRefIndex] = useState<number>(0);

  // 1. Parse Input
  const samples = useMemo<SampleData[]>(() => {
    const lines = inputText.trim().split('\n');
    const data: SampleData[] = [];
    // Skip header row if it contains text labels
    const firstLine = lines[0].trim().split(/[\t,; ]+/);
    const startIndex = (isNaN(parseFloat(firstLine[1])) || isNaN(parseFloat(firstLine[2]))) ? 1 : 0;

    for(let i=startIndex; i<lines.length; i++) {
        // Split by tab, comma, or multiple spaces
        const parts = lines[i].split(/[\t,;]+/).map(s => s.trim());
        if (parts.length >= 2) {
            const name = parts[0];
            
            // Handle various input formats
            // Format A: Name, Vol, Int (3 cols)
            // Format B: Name, Int (2 cols) -> Assume Vol = refVolume (user forgot to input vol?)
            
            let vol = 0;
            let int = 0;

            if (parts.length >= 3) {
                vol = parseFloat(parts[1]);
                int = parseFloat(parts[2]);
            } else {
                // If only 2 columns, assume 2nd is intensity, and use current Reference Volume as default assumption for input vol
                // This is a fallback
                vol = refVolume; 
                int = parseFloat(parts[1]);
            }
            
            if (!isNaN(vol) && !isNaN(int)) {
                data.push({ id: `row-${i}`, name, currentVol: vol, intensity: int });
            }
        }
    }
    return data;
  }, [inputText, refVolume]);

  // 2. Calculations
  const results = useMemo(() => {
      if (samples.length === 0) return null;

      // Calculate Signal per uL (Density/Concentration of the protein of interest)
      const densities = samples.map(s => s.intensity / s.currentVol);

      // Determine Reference Density based on Strategy
      let targetDensity = 0;
      let refSampleName = '';

      if (strategy === 'mean') {
          targetDensity = densities.reduce((a,b) => a+b, 0) / densities.length;
          refSampleName = '所有样本平均值 (Average)';
      } else if (strategy === 'weakest') {
          const minVal = Math.min(...densities);
          targetDensity = minVal;
          refSampleName = '信号最弱样本 (Minimum)';
      } else if (strategy === 'strongest') {
          const maxVal = Math.max(...densities);
          targetDensity = maxVal;
          refSampleName = '信号最强样本 (Maximum)';
      } else if (strategy === 'manual') {
          if (manualRefIndex < samples.length && manualRefIndex >= 0) {
              targetDensity = densities[manualRefIndex];
              refSampleName = samples[manualRefIndex].name;
          } else {
              targetDensity = densities[0];
              refSampleName = samples[0].name;
          }
      }

      // Calculate New Volumes
      // Logic: We want everyone to have the same Total Signal as the "Reference State".
      // Reference State Signal = targetDensity * refVolume.
      // For Sample X: NewVol * DensityX = Reference State Signal
      // => NewVol = (targetDensity * refVolume) / DensityX
      
      const targetLoad = targetDensity * refVolume;

      const calculations = samples.map((s, idx) => {
          const density = densities[idx]; // signal per uL
          let newVol = targetLoad / density;
          
          // Safety check for infinity or NaNs
          if (!isFinite(newVol)) newVol = 0;

          return {
              ...s,
              density,
              newVol,
              isRef: (strategy === 'manual' && idx === manualRefIndex)
          };
      });

      return { calculations, targetLoad, refSampleName };
  }, [samples, strategy, refVolume, manualRefIndex]);

  // 3. Chart Data
  const chartData = useMemo(() => {
      if (!results) return [];
      return results.calculations.map(c => ({
          name: c.name,
          Original: c.intensity, 
          Normalized: results.targetLoad // This is theoretical constant
      }));
  }, [results]);

  // CSV Export
  const handleExport = () => {
      if (!results) return;
      let csv = "\uFEFFSample Name,Original Vol (uL),Original Intensity,Signal Density (Int/uL),New Load Vol (uL)\n";
      results.calculations.forEach(r => {
          csv += `"${r.name}",${r.currentVol},${r.intensity},${r.density.toFixed(2)},${r.newVol.toFixed(2)}\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "WB_Normalization_Plan.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-600">
                <AlignCenterVertical size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">Western Blot 上样量归一化</h2>
               <p className="text-slate-500">根据内参条带灰度，计算样品体积调整方案，确保内参齐平</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px] items-start">
           
           {/* LEFT: Input & Settings */}
           <div className="lg:col-span-4 flex flex-col gap-6">
               
               {/* 1. Data Input */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col h-[420px]">
                   <div className="flex justify-between items-center mb-2">
                       <h3 className="font-bold text-slate-700 flex items-center gap-2"><Upload size={16}/> 数据输入</h3>
                       <div className="text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded">支持 Excel 粘贴</div>
                   </div>
                   <div className="text-xs text-slate-500 mb-2 font-mono bg-slate-50 p-2 rounded border border-slate-100">
                       格式: 样本名 [Tab] 当前体积 [Tab] 灰度值
                   </div>
                   <textarea 
                       value={inputText}
                       onChange={(e) => setInputText(e.target.value)}
                       className="flex-1 w-full p-2 text-xs font-mono border border-slate-200 rounded-lg outline-none focus:border-emerald-500 resize-none whitespace-pre leading-relaxed"
                       placeholder={DEFAULT_INPUT}
                   />
               </div>

               {/* 2. Strategy Settings */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
                   <h3 className="font-bold text-slate-700 flex items-center gap-2"><Calculator size={16}/> 归一化策略</h3>
                   
                   <div>
                       <label className="block text-xs font-bold text-slate-500 mb-2">对齐基准 (Reference Basis)</label>
                       <select 
                           value={strategy} 
                           onChange={(e) => setStrategy(e.target.value as NormStrategy)}
                           className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                       >
                           <option value="mean">所有样本平均值 (Mean)</option>
                           <option value="weakest">信号最弱的样本 (Weakest)</option>
                           <option value="strongest">信号最强的样本 (Strongest)</option>
                           <option value="manual">指定某个样本 (Manual)</option>
                       </select>
                   </div>

                   {strategy === 'manual' && samples.length > 0 && (
                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-2">选择基准样本</label>
                           <select 
                               value={manualRefIndex}
                               onChange={(e) => setManualRefIndex(parseInt(e.target.value))}
                               className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-slate-50"
                           >
                               {samples.map((s, idx) => (
                                   <option key={s.id} value={idx}>{s.name} (Vol: {s.currentVol}, Int: {s.intensity})</option>
                               ))}
                           </select>
                       </div>
                   )}

                   <div>
                       <label className="block text-xs font-bold text-slate-500 mb-2">基准样本的目标上样体积 (μL)</label>
                       <div className="flex items-center gap-2">
                           <input 
                               type="number" 
                               value={refVolume}
                               onChange={(e) => setRefVolume(parseFloat(e.target.value) || 0)}
                               className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:border-emerald-500 outline-none"
                           />
                           <span className="text-sm text-slate-600">μL</span>
                       </div>
                       <p className="text-[10px] text-slate-400 mt-1">
                           例如：如果你希望基准样本下次跑胶上 10 μL，这里填 10。其他样本将根据此自动计算。
                       </p>
                   </div>
               </div>
           </div>

           {/* RIGHT: Results */}
           <div className="lg:col-span-8 flex flex-col gap-6">
               
               {/* 1. Results Table */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                   <div className="flex justify-between items-center mb-4">
                       <div>
                           <h3 className="font-bold text-slate-800 flex items-center gap-2">
                               <FlaskConical size={18} className="text-emerald-500" /> 调整方案
                           </h3>
                           <p className="text-xs text-slate-500 mt-1">
                               基准: <span className="font-semibold text-emerald-600">{results?.refSampleName}</span> 
                               <span className="mx-2 text-slate-300">|</span> 
                               目标上样量: {refVolume} μL
                           </p>
                       </div>
                       <button onClick={handleExport} className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2">
                           <Download size={14} /> 导出 CSV
                       </button>
                   </div>

                   <div className="overflow-x-auto rounded-lg border border-slate-100">
                       <table className="w-full text-sm text-left">
                           <thead className="bg-slate-50 text-slate-500 font-medium">
                               <tr>
                                   <th className="px-4 py-3">样本名称</th>
                                   <th className="px-4 py-3 text-right">原始灰度</th>
                                   <th className="px-4 py-3 text-right">密度 (Int/uL)</th>
                                   <th className="px-4 py-3 text-right text-emerald-700 bg-emerald-50/50">新上样体积 (μL)</th>
                                   <th className="px-4 py-3 text-right">倍数变化</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                               {results?.calculations.map((row) => (
                                   <tr key={row.id} className="hover:bg-slate-50">
                                       <td className="px-4 py-2 font-medium text-slate-700">
                                           {row.name}
                                           {row.isRef && <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Ref</span>}
                                       </td>
                                       <td className="px-4 py-2 text-right text-slate-500">{row.intensity}</td>
                                       <td className="px-4 py-2 text-right text-slate-500">{row.density.toFixed(1)}</td>
                                       <td className="px-4 py-2 text-right font-bold text-emerald-600 bg-emerald-50/30 text-lg">
                                           {row.newVol.toFixed(2)}
                                       </td>
                                       <td className="px-4 py-2 text-right text-xs font-mono text-slate-400">
                                           {row.currentVol > 0 ? (row.newVol / row.currentVol).toFixed(2) + 'x' : '-'}
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                       {(!results || results.calculations.length === 0) && (
                           <div className="p-8 text-center text-slate-400 text-sm">
                               暂无数据，请在左侧输入
                           </div>
                       )}
                   </div>
               </div>

               {/* 2. Visual Check */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <BarChart3 size={18} className="text-blue-500" /> 效果预览
                   </h3>
                   <div className="h-[300px] w-full">
                       <ResponsiveContainer width="100%" height="100%">
                           <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                               <CartesianGrid strokeDasharray="3 3" vertical={false} />
                               <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                               <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} label={{ value: 'Total Intensity (Signal)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 12 } }} />
                               <Tooltip 
                                   cursor={{ fill: '#f8fafc' }} 
                                   contentStyle={{ borderRadius: 8 }}
                                   formatter={(value: number, name: string) => [Math.round(value), name === 'original' ? '原始总量' : '调整后总量']}
                               />
                               <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                               <Bar dataKey="original" name="原始 (Original)" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={20} />
                               <Bar dataKey="normalized" name="调整后 (Normalized)" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                           </BarChart>
                       </ResponsiveContainer>
                   </div>
                   <p className="text-center text-xs text-slate-400 mt-2">
                       * 绿色柱状图高度一致代表内参已调齐
                   </p>
               </div>

           </div>

       </div>
    </div>
  );
};