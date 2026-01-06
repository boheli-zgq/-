import React, { useState, useMemo } from 'react';
import { Grid3x3, Droplet, Beaker, ArrowRight, Pipette, Info, CheckCircle2, Calculator } from 'lucide-react';

interface PlatePreset {
  id: string;
  name: string;
  area: number; // cm^2
  defaultVol: number; // mL
  maxVol: number; // mL
}

const PLATE_PRESETS: PlatePreset[] = [
  { id: '96-well', name: '96-well Plate', area: 0.32, defaultVol: 0.1, maxVol: 0.2 },
  { id: '48-well', name: '48-well Plate', area: 0.95, defaultVol: 0.3, maxVol: 0.5 },
  { id: '24-well', name: '24-well Plate', area: 1.9, defaultVol: 0.5, maxVol: 1.0 },
  { id: '12-well', name: '12-well Plate', area: 3.8, defaultVol: 1.0, maxVol: 2.0 },
  { id: '6-well', name: '6-well Plate', area: 9.5, defaultVol: 2.0, maxVol: 3.0 },
  { id: '35mm', name: '35mm Dish', area: 8.8, defaultVol: 2.0, maxVol: 3.0 },
  { id: '60mm', name: '60mm Dish', area: 21.5, defaultVol: 4.0, maxVol: 5.0 },
  { id: '100mm', name: '100mm Dish', area: 55, defaultVol: 10.0, maxVol: 12.0 },
];

export const CellPlatingTool: React.FC = () => {
  // Inputs
  const [currentConcBase, setCurrentConcBase] = useState<number | ''>(1.5);
  const [currentConcExp, setCurrentConcExp] = useState<number>(1000000); // 10^6
  
  const [selectedPlateId, setSelectedPlateId] = useState<string>('6-well');
  const [numWells, setNumWells] = useState<number | ''>(1);
  const [targetDensityBase, setTargetDensityBase] = useState<number | ''>(3); // e.g. 3 x 10^5
  const [targetDensityExp, setTargetDensityExp] = useState<number>(100000); // 10^5
  const [volumePerWell, setVolumePerWell] = useState<number | ''>(2.0);
  const [safetyMargin, setSafetyMargin] = useState<number>(10); // %

  // Derived
  const selectedPlate = PLATE_PRESETS.find(p => p.id === selectedPlateId);

  // Calculations
  const results = useMemo(() => {
    if (!currentConcBase || !numWells || !targetDensityBase || !volumePerWell) {
        return null;
    }

    const currentConc = currentConcBase * currentConcExp; // cells/mL
    const targetDensity = targetDensityBase * targetDensityExp; // cells/well
    const wells = numWells;
    const volPerWell = volumePerWell; // mL
    const margin = 1 + (safetyMargin / 100);

    // 1. Total Cells Needed (including safety margin)
    const totalCells = targetDensity * wells * margin;

    // 2. Volume of Cell Suspension needed from stock
    // Vol_cells (mL) = Total_cells / Current_conc
    const volSuspension = totalCells / currentConc;

    // 3. Total Volume of plating medium needed (including safety margin)
    const totalVol = volPerWell * wells * margin;

    // 4. Volume of fresh medium to add
    // Vol_medium = Total_Vol - Vol_suspension
    const volMedium = totalVol - volSuspension;

    // Warnings
    const warning = volMedium < 0 ? "原液浓度过低，无法配制目标密度的悬液！" : null;

    return {
        totalCells,
        volSuspension, // mL
        volMedium, // mL
        totalVol, // mL
        cellsPerMlFinal: targetDensity / volPerWell, // Final concentration in the plate
        warning
    };
  }, [currentConcBase, currentConcExp, numWells, targetDensityBase, targetDensityExp, volumePerWell, safetyMargin]);

  // Handlers
  const handlePlateChange = (id: string) => {
      setSelectedPlateId(id);
      const plate = PLATE_PRESETS.find(p => p.id === id);
      if (plate) {
          setVolumePerWell(plate.defaultVol);
          // Suggest density? Optional logic
          // Example: 6-well (9.5cm2) ~ 300,000 cells. 96-well (0.32cm2) ~ 10,000 cells.
          // Rough heuristic: 30,000 cells / cm2
          const suggestedDensity = Math.round(plate.area * 30000);
          // Format suggested density to base * 10^exp
          const exp = Math.floor(Math.log10(suggestedDensity));
          const base = parseFloat((suggestedDensity / Math.pow(10, exp)).toFixed(1));
          setTargetDensityBase(base);
          setTargetDensityExp(Math.pow(10, exp));
      }
  };

  // Helper to format volume nice
  const fmtVol = (ml: number) => {
      if (ml < 1) {
          return `${(ml * 1000).toFixed(1)} µL`;
      }
      return `${ml.toFixed(2)} mL`;
  };

  const fmtSci = (num: number) => {
      if (num === 0) return "0";
      const exp = Math.floor(Math.log10(num));
      const base = (num / Math.pow(10, exp)).toFixed(2);
      return (
        <span>
          {base} × 10<sup>{exp}</sup>
        </span>
      );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-pink-100 p-3 rounded-2xl text-pink-600">
                <Grid3x3 size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">细胞铺板计算器</h2>
               <p className="text-slate-500">快速计算铺板所需的细胞悬液与培养基体积，内置多种板型预设</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-8">
           
           {/* LEFT: Inputs (5 cols) */}
           <div className="lg:col-span-5 space-y-6">
               
               {/* 1. Cell Count */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 relative overflow-hidden">
                   <div className="absolute top-0 right-0 w-24 h-24 bg-pink-50 rounded-bl-full -mr-4 -mt-4 z-0"></div>
                   <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2 relative z-10">
                       <div className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-xs font-bold">1</div>
                       当前细胞密度 (计数结果)
                   </h3>
                   <div className="relative z-10 flex items-center gap-2">
                       <input 
                           type="number" 
                           value={currentConcBase} 
                           onChange={e => setCurrentConcBase(parseFloat(e.target.value) || '')}
                           className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent font-mono text-lg"
                           placeholder="1.5"
                       />
                       <span className="text-slate-500 font-medium">×</span>
                       <select 
                           value={currentConcExp} 
                           onChange={e => setCurrentConcExp(parseInt(e.target.value))}
                           className="px-2 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm"
                       >
                           <option value={10000}>10⁴</option>
                           <option value={100000}>10⁵</option>
                           <option value={1000000}>10⁶</option>
                           <option value={10000000}>10⁷</option>
                       </select>
                       <span className="text-slate-500 text-sm ml-1">cells/mL</span>
                   </div>
               </div>

               {/* 2. Plate Settings */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 relative">
                   <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                       <div className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-xs font-bold">2</div>
                       铺板设置
                   </h3>
                   
                   <div className="space-y-4">
                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1.5">选择板型 (Plate Type)</label>
                           <select 
                               value={selectedPlateId} 
                               onChange={e => handlePlateChange(e.target.value)}
                               className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500"
                           >
                               {PLATE_PRESETS.map(p => (
                                   <option key={p.id} value={p.id}>{p.name} (Area: {p.area} cm²)</option>
                               ))}
                           </select>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="block text-xs font-bold text-slate-500 mb-1.5">铺板数量 (Wells/Dishes)</label>
                               <input 
                                   type="number" 
                                   min="1"
                                   value={numWells} 
                                   onChange={e => setNumWells(parseFloat(e.target.value) || '')}
                                   className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500"
                               />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-slate-500 mb-1.5">单孔体积 (Volume/Well)</label>
                               <div className="flex items-center gap-2">
                                   <input 
                                       type="number" 
                                       value={volumePerWell} 
                                       onChange={e => setVolumePerWell(parseFloat(e.target.value) || '')}
                                       className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500"
                                   />
                                   <span className="text-xs text-slate-500">mL</span>
                               </div>
                           </div>
                       </div>

                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1.5">目标铺板密度 (Target Density)</label>
                           <div className="flex items-center gap-2">
                                <input 
                                    type="number" 
                                    value={targetDensityBase} 
                                    onChange={e => setTargetDensityBase(parseFloat(e.target.value) || '')}
                                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 font-mono"
                                />
                                <span className="text-slate-500 font-medium">×</span>
                                <select 
                                    value={targetDensityExp} 
                                    onChange={e => setTargetDensityExp(parseInt(e.target.value))}
                                    className="px-2 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm"
                                >
                                    <option value={1000}>10³</option>
                                    <option value={10000}>10⁴</option>
                                    <option value={100000}>10⁵</option>
                                    <option value={1000000}>10⁶</option>
                                </select>
                                <span className="text-slate-500 text-sm ml-1">cells/well</span>
                           </div>
                       </div>

                       <div>
                           <label className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-1.5">
                               损耗余量 (Safety Margin)
                               <span className="text-[10px] font-normal text-slate-400 bg-slate-100 px-1.5 rounded">多配 {safetyMargin}%</span>
                           </label>
                           <input 
                                type="range" 
                                min="0" 
                                max="30" 
                                step="5"
                                value={safetyMargin} 
                                onChange={e => setSafetyMargin(parseInt(e.target.value))}
                                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-pink-500"
                           />
                       </div>
                   </div>
               </div>
           </div>

           {/* RIGHT: Results (7 cols) */}
           <div className="lg:col-span-7">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 h-full flex flex-col relative overflow-hidden">
                   {results ? (
                       <>
                           {results.warning && (
                               <div className="mb-6 bg-red-50 border border-red-100 text-red-600 p-3 rounded-lg flex items-center gap-2 text-sm font-bold animate-pulse">
                                   <Info size={18} /> {results.warning}
                               </div>
                           )}

                           <div className="grid md:grid-cols-2 gap-8 mb-8">
                               {/* Big Number 1 */}
                               <div className="bg-pink-50 rounded-2xl p-6 border border-pink-100 flex flex-col justify-between">
                                   <div className="flex items-center gap-2 text-pink-800 text-sm font-bold mb-2">
                                       <Pipette size={18} /> 取用细胞悬液 (Stock)
                                   </div>
                                   <div className="text-4xl font-bold text-pink-600 tracking-tight break-all">
                                       {fmtVol(results.volSuspension)}
                                   </div>
                                   <div className="text-xs text-pink-400 mt-2">
                                       含有 {fmtSci(results.totalCells)} 个细胞
                                   </div>
                               </div>

                               {/* Big Number 2 */}
                               <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100 flex flex-col justify-between">
                                   <div className="flex items-center gap-2 text-blue-800 text-sm font-bold mb-2">
                                       <Beaker size={18} /> 补充新鲜培养基 (Medium)
                                   </div>
                                   <div className="text-4xl font-bold text-blue-600 tracking-tight break-all">
                                       {fmtVol(results.volMedium)}
                                   </div>
                                   <div className="text-xs text-blue-400 mt-2">
                                       补足至总体系
                                   </div>
                               </div>
                           </div>

                           <div className="bg-slate-50 rounded-xl border border-slate-200 p-6 flex-1">
                               <h4 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                                   <CheckCircle2 size={18} className="text-emerald-500" /> 配制方案 (Recipe)
                               </h4>
                               
                               <div className="space-y-4 relative">
                                   {/* Step line */}
                                   <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-slate-200"></div>

                                   <div className="relative pl-8">
                                       <div className="absolute left-0 top-1 w-6 h-6 bg-white border-2 border-slate-300 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-500 z-10">1</div>
                                       <p className="text-sm text-slate-600 leading-relaxed">
                                           准备一个无菌管/槽，确保能容纳 <strong className="text-slate-800">{fmtVol(results.totalVol)}</strong> 液体。
                                       </p>
                                   </div>

                                   <div className="relative pl-8">
                                       <div className="absolute left-0 top-1 w-6 h-6 bg-white border-2 border-pink-400 rounded-full flex items-center justify-center text-[10px] font-bold text-pink-600 z-10">2</div>
                                       <p className="text-sm text-slate-600 leading-relaxed">
                                           加入 <strong className="text-pink-600 text-lg bg-pink-50 px-1 rounded">{fmtVol(results.volSuspension)}</strong> 的细胞悬液。
                                       </p>
                                   </div>

                                   <div className="relative pl-8">
                                       <div className="absolute left-0 top-1 w-6 h-6 bg-white border-2 border-blue-400 rounded-full flex items-center justify-center text-[10px] font-bold text-blue-600 z-10">3</div>
                                       <p className="text-sm text-slate-600 leading-relaxed">
                                           加入 <strong className="text-blue-600 text-lg bg-blue-50 px-1 rounded">{fmtVol(results.volMedium)}</strong> 的新鲜培养基。
                                       </p>
                                   </div>

                                   <div className="relative pl-8">
                                       <div className="absolute left-0 top-1 w-6 h-6 bg-white border-2 border-slate-300 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-500 z-10">4</div>
                                       <p className="text-sm text-slate-600 leading-relaxed">
                                           充分混匀 (吹打或涡旋)。
                                       </p>
                                   </div>

                                   <div className="relative pl-8">
                                       <div className="absolute left-0 top-1 w-6 h-6 bg-emerald-500 border-2 border-emerald-500 rounded-full flex items-center justify-center text-white z-10"><CheckCircle2 size={12}/></div>
                                       <p className="text-sm text-slate-600 leading-relaxed">
                                           向 <strong>{numWells}</strong> 个 {selectedPlate?.name} 孔中，每孔加入 <strong className="text-slate-800">{fmtVol(volumePerWell as number)}</strong> 混合液。
                                       </p>
                                       <div className="mt-2 text-xs text-slate-400 bg-white border border-slate-100 p-2 rounded inline-block">
                                           最终孔内密度: {fmtSci(results.cellsPerMlFinal)} cells/mL
                                       </div>
                                   </div>
                               </div>
                           </div>
                           
                           {/* Visual Decoration */}
                           <div className="absolute -bottom-10 -right-10 opacity-5 pointer-events-none">
                               <Grid3x3 size={200} />
                           </div>
                       </>
                   ) : (
                       <div className="h-full flex flex-col items-center justify-center text-slate-300">
                           <Calculator size={64} className="mb-4 opacity-50" />
                           <p className="font-medium">请输入左侧参数开始计算</p>
                       </div>
                   )}
               </div>
           </div>
       </div>
    </div>
  );
};