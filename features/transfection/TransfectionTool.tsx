import React, { useState, useMemo } from 'react';
import { Biohazard, Pipette, Beaker, AlertTriangle, Droplet, Calculator } from 'lucide-react';

interface VesselPreset {
  id: string;
  name: string;
  defaultCells: number; // Suggested seeding number
  defaultVol: number; // mL
}

const VESSEL_PRESETS: VesselPreset[] = [
  { id: '96-well', name: '96-well Plate', defaultCells: 1e4, defaultVol: 0.1 },
  { id: '48-well', name: '48-well Plate', defaultCells: 3e4, defaultVol: 0.25 },
  { id: '24-well', name: '24-well Plate', defaultCells: 1e5, defaultVol: 0.5 },
  { id: '12-well', name: '12-well Plate', defaultCells: 2e5, defaultVol: 1.0 },
  { id: '6-well', name: '6-well Plate', defaultCells: 5e5, defaultVol: 2.0 },
  { id: '35mm', name: '35mm Dish', defaultCells: 8e5, defaultVol: 2.0 },
  { id: '60mm', name: '60mm Dish', defaultCells: 2e6, defaultVol: 4.0 },
  { id: '100mm', name: '100mm Dish', defaultCells: 6e6, defaultVol: 10.0 },
];

export const TransfectionTool: React.FC = () => {
  // Inputs
  const [selectedVesselId, setSelectedVesselId] = useState<string>('6-well');
  const [numWells, setNumWells] = useState<number | ''>(1);
  const [cellCountBase, setCellCountBase] = useState<number | ''>(5);
  const [cellCountExp, setCellCountExp] = useState<number>(100000); // 10^5
  const [moi, setMoi] = useState<number | ''>(10);
  const [titerBase, setTiterBase] = useState<number | ''>(1.0);
  const [titerExp, setTiterExp] = useState<number>(100000000); // 10^8
  const [titerUnit, setTiterUnit] = useState<string>('TU/mL');
  const [volumePerWell, setVolumePerWell] = useState<number | ''>(2.0); // mL

  // Logic
  const handleVesselChange = (id: string) => {
      setSelectedVesselId(id);
      const vessel = VESSEL_PRESETS.find(v => v.id === id);
      if (vessel) {
          // Auto fill suggested cell count
          const exp = Math.floor(Math.log10(vessel.defaultCells));
          const base = parseFloat((vessel.defaultCells / Math.pow(10, exp)).toFixed(1));
          setCellCountBase(base);
          setCellCountExp(Math.pow(10, exp));
          setVolumePerWell(vessel.defaultVol);
      }
  };

  const results = useMemo(() => {
      if (!cellCountBase || !moi || !titerBase || !volumePerWell || !numWells) return null;

      const totalCellsPerWell = cellCountBase * cellCountExp;
      const viralTiter = titerBase * titerExp; // units/mL
      
      // Calculate virus needed per well
      // Vol (mL) = (Cells * MOI) / Titer
      const totalVirusParticlesNeeded = totalCellsPerWell * moi;
      const virusVolPerWellML = totalVirusParticlesNeeded / viralTiter;
      const virusVolPerWellUL = virusVolPerWellML * 1000;

      // Warnings
      const toxicityWarning = virusVolPerWellML > (volumePerWell * 0.1); // Warning if virus > 10% of media
      const pipettingWarning = virusVolPerWellUL < 1.0; // Hard to pipette < 1uL accurately

      // Dilution Suggestion
      let dilutionFactor = 1;
      let dilutionText = null;
      
      if (pipettingWarning) {
          if (virusVolPerWellUL < 0.1) dilutionFactor = 100;
          else dilutionFactor = 10;
          
          dilutionText = `建议预先将病毒原液稀释 1:${dilutionFactor}，然后取用 ${ (virusVolPerWellUL * dilutionFactor).toFixed(2) } µL 稀释液。`;
      }

      return {
          virusVolPerWellUL,
          totalVirusVolUL: virusVolPerWellUL * numWells,
          mediaVolPerWellML: Math.max(0, volumePerWell - virusVolPerWellML),
          toxicityWarning,
          dilutionFactor,
          dilutionText
      };
  }, [cellCountBase, cellCountExp, moi, titerBase, titerExp, volumePerWell, numWells]);

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
           <div className="bg-violet-100 p-3 rounded-2xl text-violet-600">
                <Biohazard size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">病毒转染计算器</h2>
               <p className="text-slate-500">根据 MOI 计算慢病毒/腺病毒转染体积，内置稀释与毒性预警</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-8">
           
           {/* LEFT: Inputs (5 cols) */}
           <div className="lg:col-span-5 space-y-6">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                   <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                       <Calculator size={18} className="text-violet-500" /> 实验参数
                   </h3>
                   
                   <div className="space-y-5">
                       {/* 1. Vessel */}
                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1.5">培养容器 (Vessel)</label>
                           <select 
                               value={selectedVesselId}
                               onChange={e => handleVesselChange(e.target.value)}
                               className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500"
                           >
                               {VESSEL_PRESETS.map(v => (
                                   <option key={v.id} value={v.id}>{v.name}</option>
                               ))}
                           </select>
                       </div>

                       {/* 2. Cell Count */}
                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1.5">铺板细胞数 (Cells per Well)</label>
                           <div className="flex items-center gap-2">
                                <input 
                                    type="number" 
                                    value={cellCountBase} 
                                    onChange={e => setCellCountBase(parseFloat(e.target.value) || '')}
                                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 font-mono"
                                />
                                <span className="text-slate-500 font-medium">×</span>
                                <select 
                                    value={cellCountExp} 
                                    onChange={e => setCellCountExp(parseInt(e.target.value))}
                                    className="px-2 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm"
                                >
                                    <option value={1000}>10³</option>
                                    <option value={10000}>10⁴</option>
                                    <option value={100000}>10⁵</option>
                                    <option value={1000000}>10⁶</option>
                                    <option value={10000000}>10⁷</option>
                                </select>
                           </div>
                           <p className="text-[10px] text-slate-400 mt-1">感染时的实际细胞数量（需考虑铺板后的增殖）</p>
                       </div>

                       {/* 3. MOI */}
                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1.5">目标 MOI (Multiplicity of Infection)</label>
                           <input 
                               type="number" 
                               value={moi} 
                               onChange={e => setMoi(parseFloat(e.target.value) || '')}
                               className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 text-lg font-bold text-violet-700"
                               placeholder="e.g. 10"
                           />
                       </div>

                       {/* 4. Titer */}
                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1.5">病毒滴度 (Viral Titer)</label>
                           <div className="flex items-center gap-2">
                                <input 
                                    type="number" 
                                    value={titerBase} 
                                    onChange={e => setTiterBase(parseFloat(e.target.value) || '')}
                                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500 font-mono"
                                />
                                <span className="text-slate-500 font-medium">×</span>
                                <select 
                                    value={titerExp} 
                                    onChange={e => setTiterExp(parseInt(e.target.value))}
                                    className="px-2 py-2 border border-slate-300 rounded-lg bg-slate-50 text-sm"
                                >
                                    <option value={1000000}>10⁶</option>
                                    <option value={10000000}>10⁷</option>
                                    <option value={100000000}>10⁸</option>
                                    <option value={1000000000}>10⁹</option>
                                    <option value={10000000000}>10¹⁰</option>
                                </select>
                                <select 
                                    value={titerUnit}
                                    onChange={e => setTiterUnit(e.target.value)}
                                    className="px-2 py-2 border border-slate-300 rounded-lg bg-slate-50 text-xs"
                                >
                                    <option value="TU/mL">TU/mL</option>
                                    <option value="PFU/mL">PFU/mL</option>
                                    <option value="IU/mL">IU/mL</option>
                                    <option value="GC/mL">GC/mL</option>
                                </select>
                           </div>
                       </div>

                       {/* 5. Wells & Vol */}
                       <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                           <div>
                               <label className="block text-xs font-bold text-slate-500 mb-1.5">孔数 (Wells)</label>
                               <input 
                                   type="number" 
                                   min="1"
                                   value={numWells} 
                                   onChange={e => setNumWells(parseFloat(e.target.value) || '')}
                                   className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500"
                               />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-slate-500 mb-1.5">单孔体积 (mL)</label>
                               <input 
                                   type="number" 
                                   value={volumePerWell} 
                                   onChange={e => setVolumePerWell(parseFloat(e.target.value) || '')}
                                   className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500"
                               />
                           </div>
                       </div>
                   </div>
               </div>
           </div>

           {/* RIGHT: Results (7 cols) */}
           <div className="lg:col-span-7">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 h-full flex flex-col relative overflow-hidden">
                   
                   {results ? (
                       <div className="space-y-8 relative z-10">
                           {/* Primary Result */}
                           <div className="bg-violet-50 border border-violet-100 rounded-2xl p-6 text-center">
                               <h4 className="text-violet-800 font-bold mb-2 flex items-center justify-center gap-2">
                                   <Pipette size={20} /> 单孔需加入病毒体积
                               </h4>
                               <div className="text-5xl font-bold text-violet-600 tracking-tight my-4">
                                   {results.virusVolPerWellUL.toFixed(2)} <span className="text-2xl text-violet-400">µL</span>
                               </div>
                               <p className="text-sm text-violet-500/80">
                                   (即 {(results.virusVolPerWellUL / 1000).toFixed(5)} mL)
                               </p>
                           </div>

                           {/* Warnings & Suggestions */}
                           <div className="space-y-4">
                               {results.toxicityWarning && (
                                   <div className="bg-red-50 border border-red-100 text-red-700 p-4 rounded-xl flex items-start gap-3">
                                       <AlertTriangle className="shrink-0 mt-0.5" size={18} />
                                       <div>
                                           <p className="font-bold text-sm">警惕细胞毒性！</p>
                                           <p className="text-xs mt-1 opacity-90">病毒添加体积超过了培养基总体积的 10%。过多的病毒悬液可能改变培养基 pH 值或含有细胞毒性杂质。建议浓缩病毒或提高 MOI 前先进行预实验。</p>
                                       </div>
                                   </div>
                               )}

                               {results.dilutionText && (
                                   <div className="bg-amber-50 border border-amber-100 text-amber-800 p-4 rounded-xl flex items-start gap-3">
                                       <Beaker className="shrink-0 mt-0.5" size={18} />
                                       <div>
                                           <p className="font-bold text-sm">移液量过小，建议预稀释</p>
                                           <p className="text-xs mt-1 leading-relaxed">
                                               直接移取 {results.virusVolPerWellUL.toFixed(3)} µL 误差较大。
                                               <br/>
                                               <strong>操作建议：</strong> {results.dilutionText}
                                           </p>
                                       </div>
                                   </div>
                               )}
                           </div>

                           {/* Recipe / Summary */}
                           <div className="bg-slate-50 rounded-xl border border-slate-200 p-6">
                               <h4 className="font-bold text-slate-700 mb-4 border-b border-slate-200 pb-2">配制清单 (Total for {numWells} wells)</h4>
                               <div className="space-y-3 text-sm">
                                   <div className="flex justify-between items-center">
                                       <span className="text-slate-500">病毒原液总量:</span>
                                       <span className="font-mono font-bold text-slate-800">{results.totalVirusVolUL.toFixed(2)} µL</span>
                                   </div>
                                   {results.dilutionFactor > 1 && (
                                       <div className="flex justify-between items-center text-amber-600 bg-amber-50 px-2 py-1 rounded">
                                           <span>稀释后取用量 (1:{results.dilutionFactor}):</span>
                                           <span className="font-mono font-bold">{(results.totalVirusVolUL * results.dilutionFactor).toFixed(2)} µL</span>
                                       </div>
                                   )}
                                   <div className="flex justify-between items-center">
                                       <span className="text-slate-500">总培养基体积:</span>
                                       <span className="font-mono font-bold text-slate-800">{(volumePerWell as number * (numWells as number)).toFixed(1)} mL</span>
                                   </div>
                                   <div className="flex justify-between items-center pt-2 border-t border-slate-200 mt-2">
                                       <span className="text-slate-500">单孔补加培养基:</span>
                                       <span className="font-mono font-bold text-emerald-600">{results.mediaVolPerWellML.toFixed(3)} mL</span>
                                   </div>
                               </div>
                           </div>
                       </div>
                   ) : (
                       <div className="h-full flex flex-col items-center justify-center text-slate-300">
                           <Biohazard size={80} className="mb-4 opacity-20" />
                           <p className="font-medium">请输入左侧参数开始计算</p>
                       </div>
                   )}

                   {/* Decorative BG */}
                   <div className="absolute -bottom-10 -right-10 opacity-5 pointer-events-none text-violet-900">
                       <Biohazard size={240} />
                   </div>
               </div>
           </div>
       </div>
    </div>
  );
};