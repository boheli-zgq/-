import React, { useState, useMemo } from 'react';
import { PawPrint, Syringe, Plus, Trash2, Download, Info, Beaker, Clock, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';

// --- Types & Constants ---

type AnimalType = 'mouse' | 'rat';
type RouteType = 'p.o.' | 'i.p.' | 'i.v.' | 's.c.' | 'i.m.';

interface RouteLimit {
  rec: number; // Recommended mL/kg
  maxVol: number; // Max absolute volume (mL) per site approx
  desc: string;
}

const REFERENCE_DATA: Record<AnimalType, Record<RouteType, RouteLimit>> = {
  mouse: {
    'p.o.': { rec: 10, maxVol: 0.5, desc: '灌胃 (Oral Gavage): 推荐 10 mL/kg，最大 20 mL/kg (约 0.5-0.8 mL)' },
    'i.p.': { rec: 10, maxVol: 2.0, desc: '腹腔 (Intraperitoneal): 推荐 10-20 mL/kg，最大可达 80 mL/kg 但不推荐' },
    'i.v.': { rec: 5, maxVol: 0.2, desc: '尾静脉 (Intravenous): 推荐 5 mL/kg，最大 10 mL/kg (推注速度需慢)' },
    's.c.': { rec: 5, maxVol: 0.2, desc: '皮下 (Subcutaneous): 单点推荐 <5 mL/kg，推荐颈背部' },
    'i.m.': { rec: 0.05, maxVol: 0.05, desc: '肌肉 (Intramuscular): 大腿肌肉，体积非常受限 (推荐 <0.05 mL)' },
  },
  rat: {
    'p.o.': { rec: 10, maxVol: 5.0, desc: '灌胃 (Oral Gavage): 推荐 10 mL/kg' },
    'i.p.': { rec: 5, maxVol: 10.0, desc: '腹腔 (Intraperitoneal): 推荐 5-10 mL/kg' },
    'i.v.': { rec: 2, maxVol: 1.0, desc: '尾静脉 (Intravenous): 推荐 2-5 mL/kg' },
    's.c.': { rec: 2, maxVol: 2.0, desc: '皮下 (Subcutaneous): 推荐 2-5 mL/kg' },
    'i.m.': { rec: 0.1, maxVol: 0.3, desc: '肌肉 (Intramuscular): 单点推荐 <0.3 mL' },
  }
};

interface SolventComponent {
  id: string;
  name: string;
  percentage: number; // 0-100
}

interface DosingGroup {
  id: string;
  name: string;
  count: number;
  weight: number; // g
  dosage: number; // mg/kg
  route: RouteType;
  adminVolume: number; // mL/kg
}

export const AnimalExperimentTool: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dosing' | 'randomization'>('dosing');
  
  // --- Global Settings ---
  const [animalType, setAnimalType] = useState<AnimalType>('mouse');
  const [safetyMargin, setSafetyMargin] = useState<number>(20); // %
  
  // Study Duration
  const [frequency, setFrequency] = useState<number>(1); // times per day
  const [duration, setDuration] = useState<number>(1); // days

  // Solvent Configuration
  const [solvents, setSolvents] = useState<SolventComponent[]>([
    { id: '1', name: 'DMSO', percentage: 5 },
    { id: '2', name: 'PEG300', percentage: 40 },
    { id: '3', name: 'Saline (0.9% NaCl)', percentage: 55 },
  ]);

  // Groups
  const [groups, setGroups] = useState<DosingGroup[]>([
    { id: '1', name: 'Low Dose', count: 6, weight: 20, dosage: 10, route: 'p.o.', adminVolume: 10 },
    { id: '2', name: 'High Dose', count: 6, weight: 20, dosage: 50, route: 'p.o.', adminVolume: 10 },
  ]);

  // --- Handlers ---

  const handleAnimalTypeChange = (type: AnimalType) => {
    setAnimalType(type);
    const defaultWeight = type === 'mouse' ? 20 : 200;
    setGroups(prev => prev.map(g => ({ ...g, weight: defaultWeight })));
  };

  // Solvent Handlers
  const updateSolvent = (id: string, field: keyof SolventComponent, val: any) => {
    setSolvents(prev => prev.map(s => s.id === id ? { ...s, [field]: val } : s));
  };
  const addSolvent = () => {
    setSolvents(prev => [...prev, { id: Date.now().toString(), name: 'New Component', percentage: 0 }]);
  };
  const removeSolvent = (id: string) => {
    setSolvents(prev => prev.filter(s => s.id !== id));
  };
  const totalSolventPct = solvents.reduce((acc, s) => acc + s.percentage, 0);

  // Group Handlers
  const addGroup = () => {
    setGroups(prev => [
      ...prev, 
      {
        id: Date.now().toString(), 
        name: `Group ${prev.length + 1}`,
        count: 6,
        weight: animalType === 'mouse' ? 20 : 200,
        dosage: 10,
        route: 'p.o.',
        adminVolume: 10
      }
    ]);
  };
  const updateGroup = (id: string, field: keyof DosingGroup, value: any) => {
    setGroups(prev => prev.map(g => g.id === id ? { ...g, [field]: value } : g));
  };
  const removeGroup = (id: string) => {
    if (groups.length > 1) setGroups(prev => prev.filter(g => g.id !== id));
  };

  // --- Calculations ---

  const report = useMemo(() => {
    const groupDetails = groups.map(g => {
        // Basic Stats
        const weightKg = g.weight / 1000;
        const conc = g.dosage / g.adminVolume; // mg/mL
        const volPerAnimal = weightKg * g.adminVolume; // mL
        const dosePerAnimal = weightKg * g.dosage; // mg

        // Volume Limit Check
        const limit = REFERENCE_DATA[animalType][g.route];
        const isVolWarning = volPerAnimal > limit.maxVol;
        const volWarningMsg = isVolWarning ? `单只给药体积 ${volPerAnimal.toFixed(2)} mL 超过了 ${g.route} 的推荐上限 (~${limit.maxVol} mL)` : null;

        // Batch Calculation
        // Total Volume needed for ONE dosing session for the WHOLE group + Margin
        const singleSessionVolRaw = volPerAnimal * g.count;
        const singleSessionVolPrep = singleSessionVolRaw * (1 + safetyMargin / 100);
        
        // Total Drug needed for ONE session
        const singleSessionDrugPrep = singleSessionVolPrep * conc;

        return {
            ...g,
            concentration: conc,
            volPerAnimal,
            dosePerAnimal,
            singleSessionVolPrep,
            singleSessionDrugPrep,
            volWarningMsg
        };
    });

    // Total Study Needs (Aggregate of all groups)
    // Assuming we prepare fresh formulation every day (or every dosing).
    // Or do we prepare one bulk? Usually formulation is prepared fresh or weekly.
    // Here we calculate "Total Drug Powder Needed" for the full study duration to help ordering.
    
    let totalStudyDrugMass = 0;
    groupDetails.forEach(g => {
        // (Drug per session) * frequency * duration
        totalStudyDrugMass += g.singleSessionDrugPrep * frequency * duration;
    });

    // Formulation Recipes (Per Group, for Single Session)
    // We assume each group might have different concentrations, so they are prepped separately
    // OR from a stock. For simplicity, we show a recipe for *each group's specific concentration*.
    
    const recipes = groupDetails.map(g => {
        const totalVol = g.singleSessionVolPrep;
        const totalDrug = g.singleSessionDrugPrep;
        
        const solventSteps = solvents.map(s => ({
            name: s.name,
            vol: (totalVol * s.percentage) / 100
        }));

        return {
            groupName: g.name,
            targetConc: g.concentration,
            prepVolume: totalVol,
            drugMass: totalDrug,
            solventSteps
        };
    });

    return { groupDetails, totalStudyDrugMass, recipes };
  }, [groups, animalType, safetyMargin, frequency, duration, solvents]);


  const handleExportCsv = () => {
      let csv = "\uFEFF";
      
      // Part 1: Groups
      csv += "Group Data\n";
      csv += "Name,N,Weight(g),Route,Dosage(mg/kg),AdminVol(mL/kg),Conc(mg/mL),Vol/Animal(mL),Total Prep Vol(mL),Drug Mass/Prep(mg)\n";
      report.groupDetails.forEach(g => {
          csv += `"${g.name}",${g.count},${g.weight},${g.route},${g.dosage},${g.adminVolume},${g.concentration.toFixed(2)},${g.volPerAnimal.toFixed(3)},${g.singleSessionVolPrep.toFixed(2)},${g.singleSessionDrugPrep.toFixed(2)}\n`;
      });

      // Part 2: Solvents
      csv += "\nFormulation Strategy\n";
      solvents.forEach(s => {
          csv += `${s.name},${s.percentage}%\n`;
      });

      // Part 3: Summary
      csv += `\nStudy Summary\n`;
      csv += `Frequency,${frequency} times/day\n`;
      csv += `Duration,${duration} days\n`;
      csv += `Total Drug Required (approx),${report.totalStudyDrugMass.toFixed(1)} mg\n`;

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "Animal_Study_Design.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-12">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-amber-100 p-3 rounded-2xl text-amber-800">
                <PawPrint size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">动物实验设计与给药计算</h2>
               <p className="text-slate-500">配液方案计算器 · 给药途径参考 · 药物总量预估</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 items-start">
           
           {/* LEFT COLUMN: Settings & Configuration */}
           <div className="lg:col-span-4 space-y-6">
               
               {/* 1. Basic Settings */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <Info size={18} className="text-amber-600" /> 基础设置
                   </h3>
                   <div className="space-y-4">
                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-2">动物类型</label>
                           <div className="flex bg-slate-100 p-1 rounded-lg">
                               <button onClick={() => handleAnimalTypeChange('mouse')} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${animalType === 'mouse' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500'}`}>小鼠 (Mouse)</button>
                               <button onClick={() => handleAnimalTypeChange('rat')} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${animalType === 'rat' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500'}`}>大鼠 (Rat)</button>
                           </div>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="block text-xs font-bold text-slate-500 mb-1">给药频率 (次/天)</label>
                               <input type="number" min="1" value={frequency} onChange={e => setFrequency(parseFloat(e.target.value))} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-slate-500 mb-1">实验天数</label>
                               <input type="number" min="1" value={duration} onChange={e => setDuration(parseFloat(e.target.value))} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                           </div>
                       </div>

                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1">配液损耗余量 (%)</label>
                           <div className="flex items-center gap-2">
                               <input type="range" min="0" max="50" step="5" value={safetyMargin} onChange={e => setSafetyMargin(parseInt(e.target.value))} className="flex-1 h-2 bg-slate-200 rounded-lg accent-amber-500" />
                               <span className="text-sm font-mono w-8 text-right">{safetyMargin}%</span>
                           </div>
                           <p className="text-[10px] text-slate-400 mt-1">为防止移液误差和挂壁损耗，建议多配制 10-20%。</p>
                       </div>
                   </div>
               </div>

               {/* 2. Formulation Strategy */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <Beaker size={18} className="text-blue-600" /> 溶剂配置 (Formulation)
                   </h3>
                   
                   <div className="space-y-3 mb-4">
                       {solvents.map((s, idx) => (
                           <div key={s.id} className="flex items-center gap-2">
                               <input 
                                   type="text" 
                                   value={s.name} 
                                   onChange={e => updateSolvent(s.id, 'name', e.target.value)}
                                   className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm placeholder-slate-400" 
                                   placeholder="Solvent Name"
                               />
                               <div className="relative w-20">
                                   <input 
                                       type="number" 
                                       value={s.percentage} 
                                       onChange={e => updateSolvent(s.id, 'percentage', parseFloat(e.target.value))}
                                       className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm pr-6" 
                                   />
                                   <span className="absolute right-2 top-1.5 text-xs text-slate-500">%</span>
                               </div>
                               <button onClick={() => removeSolvent(s.id)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                           </div>
                       ))}
                   </div>

                   <div className="flex justify-between items-center border-t border-slate-100 pt-3">
                       <div className={`text-xs font-bold ${totalSolventPct === 100 ? 'text-emerald-600' : 'text-red-500'}`}>
                           Total: {totalSolventPct}%
                       </div>
                       <button onClick={addSolvent} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                           <Plus size={12} /> 添加组分
                       </button>
                   </div>
                   {totalSolventPct !== 100 && <p className="text-[10px] text-red-500 mt-1">警告：溶剂总和不等于 100%</p>}
               </div>

               {/* 3. Reference Data */}
               <div className="bg-amber-50 rounded-xl border border-amber-100 p-5">
                   <h3 className="font-bold text-amber-900 mb-3 flex items-center gap-2 text-sm">
                       <Info size={16} /> 给药途径参考 ({animalType === 'mouse' ? '小鼠' : '大鼠'})
                   </h3>
                   <div className="space-y-3">
                       {Object.entries(REFERENCE_DATA[animalType]).map(([key, val]) => {
                           const data = val as RouteLimit;
                           return (
                           <div key={key} className="text-xs">
                               <div className="flex justify-between font-bold text-amber-800 mb-0.5">
                                   <span className="uppercase">{key}</span>
                                   <span>Rec: {data.rec} mL/kg</span>
                               </div>
                               <p className="text-amber-700/80 leading-relaxed">{data.desc}</p>
                           </div>
                           );
                       })}
                   </div>
               </div>

           </div>

           {/* RIGHT COLUMN: Groups & Results */}
           <div className="lg:col-span-8 space-y-6">
               
               {/* 1. Groups Table */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 overflow-hidden">
                   <div className="flex justify-between items-center mb-4">
                       <h3 className="font-bold text-slate-800 flex items-center gap-2">
                           <Syringe size={18} className="text-emerald-600" /> 实验分组与给药参数
                       </h3>
                       <button onClick={addGroup} className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1">
                           <Plus size={14} /> 添加组
                       </button>
                   </div>

                   <div className="overflow-x-auto -mx-6 px-6 pb-2">
                       <table className="w-full text-sm text-left">
                           <thead className="text-slate-500 font-medium border-b border-slate-100">
                               <tr>
                                   <th className="pb-3 w-32">组名</th>
                                   <th className="pb-3 w-16">数量</th>
                                   <th className="pb-3 w-20">体重(g)</th>
                                   <th className="pb-3 w-24">给药途径</th>
                                   <th className="pb-3 w-24">剂量(mg/kg)</th>
                                   <th className="pb-3 w-24">体积(mL/kg)</th>
                                   <th className="pb-3 text-right">单只(mL)</th>
                                   <th className="pb-3 w-10"></th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                               {groups.map(g => (
                                   <tr key={g.id} className="group hover:bg-slate-50">
                                       <td className="py-2 pr-2">
                                           <input type="text" value={g.name} onChange={e => updateGroup(g.id, 'name', e.target.value)} className="w-full bg-transparent border-b border-transparent focus:border-emerald-500 outline-none font-medium text-slate-700" />
                                       </td>
                                       <td className="py-2 pr-2">
                                           <input type="number" value={g.count} onChange={e => updateGroup(g.id, 'count', parseFloat(e.target.value))} className="w-full bg-slate-50 rounded px-1 py-1 text-center" />
                                       </td>
                                       <td className="py-2 pr-2">
                                           <input type="number" value={g.weight} onChange={e => updateGroup(g.id, 'weight', parseFloat(e.target.value))} className="w-full bg-slate-50 rounded px-1 py-1 text-center" />
                                       </td>
                                       <td className="py-2 pr-2">
                                           <select value={g.route} onChange={e => updateGroup(g.id, 'route', e.target.value)} className="w-full bg-slate-50 rounded px-1 py-1 text-xs">
                                               <option value="p.o.">p.o. (灌胃)</option>
                                               <option value="i.p.">i.p. (腹腔)</option>
                                               <option value="i.v.">i.v. (尾静脉)</option>
                                               <option value="s.c.">s.c. (皮下)</option>
                                               <option value="i.m.">i.m. (肌肉)</option>
                                           </select>
                                       </td>
                                       <td className="py-2 pr-2">
                                           <input type="number" value={g.dosage} onChange={e => updateGroup(g.id, 'dosage', parseFloat(e.target.value))} className="w-full bg-amber-50 text-amber-800 font-bold rounded px-1 py-1 text-center" />
                                       </td>
                                       <td className="py-2 pr-2">
                                           <input type="number" value={g.adminVolume} onChange={e => updateGroup(g.id, 'adminVolume', parseFloat(e.target.value))} className="w-full bg-slate-50 rounded px-1 py-1 text-center" />
                                       </td>
                                       <td className="py-2 text-right font-mono text-slate-600">
                                           {(g.weight / 1000 * g.adminVolume).toFixed(2)}
                                       </td>
                                       <td className="py-2 text-center">
                                           <button onClick={() => removeGroup(g.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={16} /></button>
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                   </div>
               </div>

               {/* 2. Analysis & Recipes */}
               <div className="grid md:grid-cols-2 gap-6">
                   {/* Left: Alerts & Summary */}
                   <div className="space-y-4">
                        {/* Warnings */}
                        {report.groupDetails.some(g => g.volWarningMsg) && (
                            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                                <h4 className="text-red-700 font-bold text-sm mb-2 flex items-center gap-2">
                                    <AlertTriangle size={16} /> 给药体积预警
                                </h4>
                                <ul className="list-disc list-inside text-xs text-red-600 space-y-1">
                                    {report.groupDetails.filter(g => g.volWarningMsg).map(g => (
                                        <li key={g.id}>{g.name}: {g.volWarningMsg}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Total Drug */}
                        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6">
                            <h4 className="text-indigo-800 font-bold mb-1 flex items-center gap-2">
                                <Clock size={18} /> 整个实验周期需药量
                            </h4>
                            <p className="text-xs text-indigo-400 mb-4">
                                (Total Drug Mass for {duration} days, {frequency}x/day)
                            </p>
                            <div className="flex items-end gap-2">
                                <span className="text-4xl font-bold text-indigo-600 tracking-tight">{report.totalStudyDrugMass.toFixed(1)}</span>
                                <span className="text-lg text-indigo-500 font-medium mb-1">mg</span>
                            </div>
                            <div className="mt-4 pt-4 border-t border-indigo-100 text-xs text-indigo-700 leading-relaxed">
                                <p><strong>建议：</strong> 订购药物时，请在此基础上额外预留 10-20% 的称量损耗。</p>
                            </div>
                        </div>
                   </div>

                   {/* Right: Recipe Cards */}
                   <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                <FileText size={18} /> 单次给药配液方案
                            </h3>
                            <button onClick={handleExportCsv} className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-lg hover:bg-slate-900 transition-colors flex items-center gap-1">
                                <Download size={12} /> 导出
                            </button>
                        </div>
                        
                        {report.recipes.map((recipe, idx) => (
                            <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <h4 className="font-bold text-slate-800">{recipe.groupName}</h4>
                                        <p className="text-xs text-slate-500">Target Conc: <span className="font-mono text-emerald-600 font-bold">{recipe.targetConc.toFixed(2)} mg/mL</span></p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-slate-400">Total Vol</div>
                                        <div className="font-mono font-bold text-slate-700">{recipe.prepVolume.toFixed(2)} mL</div>
                                    </div>
                                </div>
                                
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between border-b border-dashed border-slate-100 pb-1">
                                        <span className="text-slate-600 font-medium">1. 称取药物</span>
                                        <span className="font-bold text-amber-600">{recipe.drugMass.toFixed(2)} mg</span>
                                    </div>
                                    {recipe.solventSteps.map((step, sIdx) => (
                                        <div key={sIdx} className="flex justify-between">
                                            <span className="text-slate-500">{sIdx + 2}. 加入 {step.name}</span>
                                            <span className="font-mono">{step.vol.toFixed(2)} mL</span>
                                        </div>
                                    ))}
                                    <div className="mt-2 pt-2 text-[10px] text-slate-400 bg-slate-50 p-2 rounded">
                                        * 请按顺序加入溶剂，每一步充分涡旋混匀。对于难溶药物，可适当超声或加热。
                                    </div>
                                </div>
                            </div>
                        ))}
                   </div>
               </div>

           </div>
       </div>
    </div>
  );
};