import React, { useState } from 'react';
import { FlaskConical, Beaker, ArrowRight, Scale } from 'lucide-react';

const COMMON_REAGENTS = [
  { name: 'NaCl (氯化钠)', mw: 58.44 },
  { name: 'Tris Base', mw: 121.14 },
  { name: 'Tris-HCl', mw: 157.60 },
  { name: 'EDTA-Na2·2H2O', mw: 372.24 },
  { name: 'SDS (十二烷基硫酸钠)', mw: 288.38 },
  { name: 'Sucrose (蔗糖)', mw: 342.30 },
  { name: 'Glucose (葡萄糖)', mw: 180.16 },
  { name: 'HEPES', mw: 238.30 },
  { name: 'KCl (氯化钾)', mw: 74.55 },
  { name: 'MgCl2 (无水氯化镁)', mw: 95.21 },
  { name: 'MgCl2·6H2O', mw: 203.31 },
];

export const MolarityTool = () => {
  const [activeTab, setActiveTab] = useState<'mass' | 'dilution'>('mass');

  // State for Mass Calculator
  const [mw, setMw] = useState<number | ''>('');
  const [conc, setConc] = useState<number | ''>('');
  const [concUnit, setConcUnit] = useState<number>(1); // Multiplier to M (e.g. mM = 1e-3)
  const [vol, setVol] = useState<number | ''>('');
  const [volUnit, setVolUnit] = useState<number>(1e-3); // Multiplier to L (default mL)

  // State for Dilution Calculator
  const [stockConc, setStockConc] = useState<number | ''>('');
  const [targetConc, setTargetConc] = useState<number | ''>('');
  const [targetVol, setTargetVol] = useState<number | ''>('');
  
  const [dilutionStockUnit, setDilutionStockUnit] = useState<number>(1); // M
  const [dilutionTargetUnit, setDilutionTargetUnit] = useState<number>(1e-3); // mM
  const [dilutionVolUnit, setDilutionVolUnit] = useState<number>(1e-3); // mL

  // Mass Calculation Logic
  const calculateMass = () => {
    if (!mw || !conc || !vol) return null;
    // Mass (g) = MW (g/mol) * Conc (mol/L) * Vol (L)
    const c = conc * concUnit; // in M
    const v = vol * volUnit; // in L
    const massG = mw * c * v;
    return massG;
  };

  // Dilution Calculation Logic
  // C1V1 = C2V2 => V1 = (C2 * V2) / C1
  const calculateDilution = () => {
    if (!stockConc || !targetConc || !targetVol) return null;
    const c1 = stockConc * dilutionStockUnit;
    const c2 = targetConc * dilutionTargetUnit;
    const v2 = targetVol * dilutionVolUnit; // in L

    if (c1 <= c2) return null; // Stock must be concentrated

    const v1 = (c2 * v2) / c1; // in L
    return v1;
  };

  const massResult = calculateMass();
  const dilutionResult = calculateDilution();

  // Formatter for mass
  const formatMass = (g: number) => {
    if (g < 1e-3) return `${(g * 1e6).toFixed(2)} μg`;
    if (g < 1) return `${(g * 1e3).toFixed(2)} mg`;
    return `${g.toFixed(4)} g`;
  };

  // Formatter for volume
  const formatVolume = (l: number) => {
    if (l < 1e-6) return `${(l * 1e9).toFixed(2)} nL`;
    if (l < 1e-3) return `${(l * 1e6).toFixed(2)} μL`;
    if (l < 1) return `${(l * 1e3).toFixed(2)} mL`;
    return `${l.toFixed(4)} L`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
       {/* Header */}
       <div className="text-center space-y-2 mb-8">
          <div className="inline-flex p-3 bg-purple-100 rounded-2xl text-purple-600 mb-2">
            <FlaskConical size={32} />
          </div>
          <h2 className="text-3xl font-bold text-slate-800">摩尔浓度计算器</h2>
          <p className="text-slate-500">精准配制溶液，支持固体溶解与溶液稀释计算</p>
       </div>

       {/* Tabs */}
       <div className="flex p-1 bg-slate-100 rounded-xl mx-auto max-w-md shadow-inner">
          <button 
            onClick={() => setActiveTab('mass')}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2
              ${activeTab === 'mass' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Scale size={16} /> 质量计算 (配液)
          </button>
          <button 
            onClick={() => setActiveTab('dilution')}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2
              ${activeTab === 'dilution' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Beaker size={16} /> 稀释计算 (Dilution)
          </button>
       </div>

       {/* Main Card */}
       <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 min-h-[400px]">
          {activeTab === 'mass' ? (
            <div className="grid md:grid-cols-2 gap-12 items-center">
              {/* Inputs */}
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">常用试剂 (可选)</label>
                  <select 
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                    onChange={(e) => {
                      const reagent = COMMON_REAGENTS.find(r => r.name === e.target.value);
                      if(reagent) setMw(reagent.mw);
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>选择常用试剂自动填充分子量...</option>
                    {COMMON_REAGENTS.map(r => (
                      <option key={r.name} value={r.name}>{r.name} (MW: {r.mw})</option>
                    ))}
                  </select>
                </div>

                <div>
                   <label className="block text-sm font-medium text-slate-700 mb-2">分子量 (Molecular Weight)</label>
                   <div className="flex items-center gap-2">
                     <input 
                        type="number" 
                        value={mw}
                        onChange={(e) => setMw(parseFloat(e.target.value) || '')}
                        placeholder="e.g. 58.44"
                        className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                     />
                     <span className="text-slate-500 font-medium w-12 bg-slate-50 px-2 py-2 rounded text-center text-xs">g/mol</span>
                   </div>
                </div>

                <div>
                   <label className="block text-sm font-medium text-slate-700 mb-2">目标浓度 (Concentration)</label>
                   <div className="flex items-center gap-2">
                     <input 
                        type="number" 
                        value={conc}
                        onChange={(e) => setConc(parseFloat(e.target.value) || '')}
                        placeholder="0"
                        className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                     />
                     <select
                        value={concUnit}
                        onChange={(e) => setConcUnit(parseFloat(e.target.value))}
                        className="w-24 px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-slate-50 outline-none"
                     >
                        <option value={1}>M</option>
                        <option value={1e-3}>mM</option>
                        <option value={1e-6}>μM</option>
                     </select>
                   </div>
                </div>

                 <div>
                   <label className="block text-sm font-medium text-slate-700 mb-2">配置体积 (Volume)</label>
                   <div className="flex items-center gap-2">
                     <input 
                        type="number" 
                        value={vol}
                        onChange={(e) => setVol(parseFloat(e.target.value) || '')}
                        placeholder="0"
                        className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                     />
                     <select
                        value={volUnit}
                        onChange={(e) => setVolUnit(parseFloat(e.target.value))}
                        className="w-24 px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-slate-50 outline-none"
                     >
                        <option value={1}>L</option>
                        <option value={1e-3}>mL</option>
                        <option value={1e-6}>μL</option>
                     </select>
                   </div>
                </div>
              </div>

              {/* Result */}
              <div className="bg-purple-50 rounded-2xl p-8 flex flex-col items-center justify-center text-center h-full border border-purple-100 relative overflow-hidden min-h-[300px]">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                   <Scale size={180} className="text-purple-900" />
                </div>
                
                <h3 className="text-purple-900 font-medium mb-4 uppercase tracking-wide text-sm">需要称量质量 (Mass Required)</h3>
                {massResult !== null ? (
                   <div className="animate-fade-in-up relative z-10">
                      <div className="text-5xl font-bold text-purple-600 tracking-tight break-all">
                        {formatMass(massResult).split(' ')[0]}
                      </div>
                      <div className="text-xl text-purple-400 mt-2 font-medium">
                        {formatMass(massResult).split(' ')[1]}
                      </div>
                      <div className="mt-8 bg-white/60 p-4 rounded-xl text-sm text-purple-800/80 backdrop-blur-sm border border-purple-100">
                        将 <strong>{formatMass(massResult)}</strong> 溶质溶解于溶剂中，定容至 <strong>{formatVolume(vol as number * volUnit)}</strong>。
                      </div>
                   </div>
                ) : (
                  <div className="text-purple-300 text-6xl font-thin select-none relative z-10">---</div>
                )}
              </div>
            </div>
          ) : (
             <div className="grid md:grid-cols-2 gap-12 items-center">
                {/* Dilution Inputs */}
                <div className="space-y-6">
                    <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                        <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                           <div className="w-2.5 h-2.5 rounded-full bg-blue-500" /> 母液浓度 (Stock Solution, C1)
                        </label>
                        <div className="flex items-center gap-2">
                            <input 
                                type="number" 
                                value={stockConc}
                                onChange={(e) => setStockConc(parseFloat(e.target.value) || '')}
                                placeholder="C1"
                                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                            <select
                                value={dilutionStockUnit}
                                onChange={(e) => setDilutionStockUnit(parseFloat(e.target.value))}
                                className="w-24 px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
                            >
                                <option value={1}>M</option>
                                <option value={1e-3}>mM</option>
                                <option value={1e-6}>μM</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex justify-center -my-3 z-10 relative">
                        <div className="bg-slate-100 rounded-full p-1.5 text-slate-400 border border-white shadow-sm">
                            <ArrowRight className="rotate-90 md:rotate-0" size={20} />
                        </div>
                    </div>

                    <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 space-y-4">
                         <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                           <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> 目标溶液 (Target Solution)
                        </label>
                        <div>
                             <label className="block text-xs text-slate-500 mb-1 ml-1">目标浓度 (C2)</label>
                             <div className="flex items-center gap-2">
                                <input 
                                    type="number" 
                                    value={targetConc}
                                    onChange={(e) => setTargetConc(parseFloat(e.target.value) || '')}
                                    placeholder="C2"
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                />
                                <select
                                    value={dilutionTargetUnit}
                                    onChange={(e) => setDilutionTargetUnit(parseFloat(e.target.value))}
                                    className="w-24 px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
                                >
                                    <option value={1}>M</option>
                                    <option value={1e-3}>mM</option>
                                    <option value={1e-6}>μM</option>
                                </select>
                            </div>
                        </div>
                         <div>
                             <label className="block text-xs text-slate-500 mb-1 ml-1">目标体积 (V2)</label>
                             <div className="flex items-center gap-2">
                                <input 
                                    type="number" 
                                    value={targetVol}
                                    onChange={(e) => setTargetVol(parseFloat(e.target.value) || '')}
                                    placeholder="V2"
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                />
                                <select
                                    value={dilutionVolUnit}
                                    onChange={(e) => setDilutionVolUnit(parseFloat(e.target.value))}
                                    className="w-24 px-2 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
                                >
                                    <option value={1}>L</option>
                                    <option value={1e-3}>mL</option>
                                    <option value={1e-6}>μL</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Dilution Result */}
                 <div className="bg-slate-50 rounded-2xl p-8 flex flex-col items-center justify-center text-center h-full border border-slate-200 relative min-h-[300px]">
                     {dilutionResult !== null && dilutionResult > 0 ? (
                        <div className="space-y-6 w-full animate-fade-in">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                                    <h3 className="text-slate-500 text-xs mb-1 uppercase tracking-wider">取母液 (V1)</h3>
                                    <div className="text-2xl font-bold text-blue-600 break-all">
                                        {formatVolume(dilutionResult)}
                                    </div>
                                </div>
                                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                                    <h3 className="text-slate-500 text-xs mb-1 uppercase tracking-wider">加溶剂 (Solvent)</h3>
                                    <div className="text-2xl font-bold text-emerald-600 break-all">
                                        {formatVolume((targetVol as number * dilutionVolUnit) - dilutionResult)}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="bg-yellow-50 text-yellow-800 text-sm p-4 rounded-xl text-left border border-yellow-100 leading-relaxed shadow-sm">
                                <strong className="block mb-1 text-yellow-900">配制方法：</strong> 
                                取 <strong>{formatVolume(dilutionResult)}</strong> 母液，加入 <strong>{formatVolume((targetVol as number * dilutionVolUnit) - dilutionResult)}</strong> 溶剂，混匀即可得到 {formatVolume(targetVol as number * dilutionVolUnit)} 的目标溶液。
                            </div>
                        </div>
                     ) : (
                         <div className="flex flex-col items-center text-slate-300">
                            <Beaker size={64} className="mb-4 opacity-50" />
                            <p>输入参数以计算稀释方案</p>
                            {(stockConc && targetConc && (stockConc * dilutionStockUnit <= targetConc * dilutionTargetUnit)) && (
                                <p className="text-red-400 text-sm mt-2 font-medium bg-red-50 px-3 py-1 rounded-full">错误：母液浓度必须大于目标浓度</p>
                            )}
                         </div>
                     )}
                 </div>
             </div>
          )}
       </div>
    </div>
  );
};