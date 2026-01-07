import React, { useState, useMemo } from 'react';
import { Layers, Search, FlaskConical, Tag, Plus, Trash2, ArrowRight, MousePointer2, Copy, Info } from 'lucide-react';

// --- Data Constants ---

const LOADING_CONTROLS = [
  { name: 'Beta-actin', mw: '42 kDa', loc: '胞浆/细胞骨架', app: '广泛使用，但脂肪组织中表达较低' },
  { name: 'GAPDH', mw: '36 kDa', loc: '胞浆', app: '广泛使用，代谢旺盛组织慎用 (糖酵解关键酶)' },
  { name: 'Alpha-Tubulin', mw: '50-55 kDa', loc: '细胞骨架', app: '适合全细胞/胞浆蛋白' },
  { name: 'Beta-Tubulin', mw: '55 kDa', loc: '细胞骨架', app: '广泛使用' },
  { name: 'Vinculin', mw: '117 kDa', loc: '细胞骨架/粘附斑', app: '适合高分子量蛋白内参' },
  { name: 'Lamin B1', mw: '66-70 kDa', loc: '核膜', app: '细胞核内参首选' },
  { name: 'Histone H3', mw: '15-17 kDa', loc: '细胞核', app: '细胞核内参，小分子量' },
  { name: 'COX IV', mw: '17 kDa', loc: '线粒体', app: '线粒体内参' },
  { name: 'VDAC1', mw: '30-35 kDa', loc: '线粒体', app: '线粒体外膜' },
  { name: 'PCNA', mw: '29 kDa', loc: '细胞核', app: '增殖细胞核内参' },
  { name: 'HSP90', mw: '90 kDa', loc: '胞浆', app: '适合高分子量蛋白' },
  { name: 'Cyclophilin B', mw: '21 kDa', loc: '内质网/分泌', app: '分泌蛋白内参' },
];

const PROTEIN_TAGS = [
  { name: 'His (6x)', mw: '~0.8 kDa', seq: 'HHHHHH', desc: '极小，免疫原性弱，用于IMAC纯化' },
  { name: 'FLAG', mw: '~1.0 kDa', seq: 'DYKDDDDK', desc: '亲水性强，含肠激酶位点，高特异性' },
  { name: 'HA', mw: '~1.1 kDa', seq: 'YPYDVPDYA', desc: '源自流感病毒，抗体效价高' },
  { name: 'Myc', mw: '~1.2 kDa', seq: 'EQKLISEEDL', desc: '源自c-Myc蛋白' },
  { name: 'V5', mw: '~1.4 kDa', seq: 'GKPIPNPLLGLDST', desc: '源自SV5病毒' },
  { name: 'GST', mw: '~26 kDa', seq: '-', desc: '谷胱甘肽S转移酶，增加溶解性，分子量大' },
  { name: 'GFP/EGFP', mw: '~27 kDa', seq: '-', desc: '绿色荧光蛋白，可直接观测' },
  { name: 'RFP/mCherry', mw: '~27 kDa', seq: '-', desc: '红色荧光蛋白' },
  { name: 'MBP', mw: '~42 kDa', seq: '-', desc: '麦芽糖结合蛋白，极强助溶效果' },
  { name: 'SUMO', mw: '~12 kDa', seq: '-', desc: '助溶，且特异性蛋白酶可无痕切除' },
];

const MARKERS = {
  'broad': {
    name: 'Broad Range (10-250 kDa)',
    bands: [
      { mw: 250, color: '#3b82f6' }, // Blue
      { mw: 130, color: '#3b82f6' },
      { mw: 95, color: '#3b82f6' },
      { mw: 72, color: '#f97316' }, // Orange (Ref)
      { mw: 55, color: '#3b82f6' },
      { mw: 36, color: '#3b82f6' },
      { mw: 28, color: '#f97316' }, // Orange (Ref)
      { mw: 17, color: '#3b82f6' },
      { mw: 10, color: '#22c55e' }  // Green
    ]
  },
  'mid': {
    name: 'Mid Range (10-180 kDa)',
    bands: [
      { mw: 180, color: '#3b82f6' },
      { mw: 130, color: '#3b82f6' },
      { mw: 100, color: '#3b82f6' },
      { mw: 75, color: '#ef4444' }, // Red (Ref)
      { mw: 63, color: '#3b82f6' },
      { mw: 48, color: '#3b82f6' },
      { mw: 35, color: '#3b82f6' },
      { mw: 25, color: '#ef4444' }, // Red (Ref)
      { mw: 17, color: '#3b82f6' },
      { mw: 10, color: '#3b82f6' }
    ]
  }
};

// --- Helper Functions ---

// Calculate migration distance (simple log approximation for visualization)
const getRelativeY = (mw: number, maxMw: number = 260, minMw: number = 8) => {
  const logMax = Math.log10(maxMw);
  const logMin = Math.log10(minMw);
  const logMw = Math.log10(mw);
  // Linear interpolation in log space
  const pos = (logMax - logMw) / (logMax - logMin); 
  return Math.max(0, Math.min(1, pos)) * 100; // 0-100%
};

const getRecommendedPercentage = (targetMw: number) => {
  if (targetMw > 200) return '6%';
  if (targetMw >= 100) return '8%';
  if (targetMw >= 50) return '10%';
  if (targetMw >= 20) return '12%';
  return '15%';
};

// --- Component ---

export const WesternDesignTool: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'controls' | 'tags' | 'gel_sim'>('gel_sim');
  const [searchTerm, setSearchTerm] = useState('');

  // Gel Sim State
  const [markerType, setMarkerType] = useState<'broad' | 'mid'>('broad');
  const [samples, setSamples] = useState<{ id: string, name: string, group: string, mw: number }[]>([
    { id: '1', name: 'Sample 1', group: 'Control', mw: 42 },
    { id: '2', name: 'Sample 1', group: 'Control', mw: 36 }, // Same sample, distinct band
    { id: '3', name: 'Sample 2', group: 'Treated', mw: 42 },
    { id: '4', name: 'Sample 2', group: 'Treated', mw: 85 },
  ]);
  
  // Input State
  const [newSampleGroup, setNewSampleGroup] = useState('Group A');
  const [newSampleName, setNewSampleName] = useState('Sample X');
  const [newSampleMw, setNewSampleMw] = useState<number | ''>(50);

  // Filter lists
  const filteredControls = LOADING_CONTROLS.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.loc.includes(searchTerm)
  );
  
  const filteredTags = PROTEIN_TAGS.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Computed: Merged Lanes
  // Groups samples with same 'group' and 'name' into one lane with multiple bands
  const mergedLanes = useMemo(() => {
      const map = new Map<string, { id: string, name: string, group: string, mws: number[] }>();
      
      samples.forEach(s => {
          const key = `${s.group}::${s.name}`;
          if (!map.has(key)) {
              map.set(key, { id: s.id, name: s.name, group: s.group, mws: [] });
          }
          map.get(key)!.mws.push(s.mw);
      });
      
      return Array.from(map.values());
  }, [samples]);

  // Handlers
  const addSample = () => {
    if (newSampleMw) {
      setSamples([...samples, { 
          id: Date.now().toString(), 
          name: newSampleName, 
          group: newSampleGroup,
          mw: newSampleMw 
      }]);
    }
  };
  
  const duplicateSample = (sample: typeof samples[0]) => {
      setSamples([...samples, { ...sample, id: Date.now().toString(), name: `${sample.name} Copy` }]);
  };

  const removeSample = (id: string) => {
    setSamples(samples.filter(s => s.id !== id));
  };

  // Determine main target for recommendation
  const primaryTargetMw = samples.length > 0 ? samples[0].mw : 50;
  const recommendedGel = getRecommendedPercentage(primaryTargetMw);

  // Ticks for Y-Axis
  const ticks = [250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 10];

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
           <div className="bg-indigo-100 p-3 rounded-2xl text-indigo-600">
                <Layers size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">Western Blot 实验设计</h2>
               <p className="text-slate-500">内参查询 · 标签查询 · 凝胶浓度计算与电泳模拟</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px]">
          
          {/* LEFT: Navigation */}
          <div className="lg:col-span-3 flex flex-col gap-2">
              <button 
                onClick={() => setActiveTab('gel_sim')}
                className={`text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center justify-between ${activeTab === 'gel_sim' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-indigo-50'}`}
              >
                <span>凝胶/Marker模拟</span>
                {activeTab === 'gel_sim' && <ArrowRight size={16} />}
              </button>
              <button 
                onClick={() => setActiveTab('controls')}
                className={`text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center justify-between ${activeTab === 'controls' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-indigo-50'}`}
              >
                <span>常用内参列表</span>
                {activeTab === 'controls' && <ArrowRight size={16} />}
              </button>
              <button 
                onClick={() => setActiveTab('tags')}
                className={`text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center justify-between ${activeTab === 'tags' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-indigo-50'}`}
              >
                <span>常用标签列表</span>
                {activeTab === 'tags' && <ArrowRight size={16} />}
              </button>
          </div>

          {/* RIGHT: Content */}
          <div className="lg:col-span-9">
              
              {/* === Gel Simulator === */}
              {activeTab === 'gel_sim' && (
                <div className="space-y-6">
                    {/* Controls Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <FlaskConical size={18} className="text-indigo-500" /> 实验参数设置
                        </h3>
                        
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1.5">选择 Marker 类型</label>
                                    <select 
                                        value={markerType} 
                                        onChange={(e) => setMarkerType(e.target.value as any)}
                                        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                                    >
                                        <option value="broad">Broad Range (10-250 kDa)</option>
                                        <option value="mid">Mid Range (10-180 kDa)</option>
                                    </select>
                                </div>
                                
                                <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                                    <span className="text-xs font-bold text-indigo-700 block mb-1">推荐分离胶浓度 (Based on first target)</span>
                                    <div className="text-2xl font-mono font-bold text-indigo-600">{recommendedGel}</div>
                                    <p className="text-[10px] text-indigo-400 mt-1">
                                        Target ~{primaryTargetMw} kDa. 
                                        通常: {'>'}200kDa (6%), 100-200 (8%), 50-100 (10%), 20-50 (12%), {'<'}20 (15%)
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1.5 flex justify-between">
                                        添加样品
                                        <span className="text-[10px] font-normal text-slate-400 flex items-center gap-1"><Info size={10}/> 同名同组自动合并泳道</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            placeholder="分组 (e.g. Ctrl)" 
                                            value={newSampleGroup}
                                            onChange={(e) => setNewSampleGroup(e.target.value)}
                                            className="w-24 text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none"
                                        />
                                        <input 
                                            type="text" 
                                            placeholder="样本名称" 
                                            value={newSampleName}
                                            onChange={(e) => setNewSampleName(e.target.value)}
                                            className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none"
                                        />
                                        <input 
                                            type="number" 
                                            placeholder="MW" 
                                            value={newSampleMw}
                                            onChange={(e) => setNewSampleMw(parseFloat(e.target.value) || '')}
                                            className="w-16 text-sm border border-slate-300 rounded-lg px-2 py-2 outline-none text-center"
                                        />
                                        <button onClick={addSample} className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700">
                                            <Plus size={18} />
                                        </button>
                                    </div>
                                </div>
                                <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                                    {samples.map(s => (
                                        <div key={s.id} className="flex justify-between items-center text-sm bg-slate-50 px-3 py-1.5 rounded border border-slate-100 group">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">{s.group}</span>
                                                <span className="font-medium text-slate-700">{s.name}</span>
                                                <span className="text-slate-400 text-xs">({s.mw} kDa)</span>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => duplicateSample(s)} className="text-slate-400 hover:text-indigo-500"><Copy size={14} /></button>
                                                <button onClick={() => removeSample(s.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Simulation View - Refactored to White Theme */}
                    <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8 flex justify-center relative min-h-[550px] overflow-hidden">
                        
                        <div className="absolute top-4 left-4 flex items-center gap-2 text-slate-400 text-xs font-medium">
                            <MousePointer2 size={14} />
                            悬停条带查看详情
                        </div>

                        {/* Scale Ticks (Left) */}
                        <div className="absolute left-0 top-16 bottom-8 w-16 border-r border-slate-100 flex flex-col items-end pr-3 py-4 select-none pointer-events-none">
                            {ticks.map(t => (
                                <div key={t} className="absolute text-[10px] font-mono text-slate-400 flex items-center gap-1" style={{ top: `${getRelativeY(t)}%`, transform: 'translateY(-50%)' }}>
                                    {t} <span className="w-1.5 h-px bg-slate-200"></span>
                                </div>
                            ))}
                        </div>

                        {/* Gel Box Container */}
                        <div className="relative w-full max-w-4xl ml-10 flex flex-col">
                            {/* Gel Slab */}
                            <div className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-lg shadow-inner flex overflow-hidden relative">
                                
                                {/* Top Wells Decoration */}
                                <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-slate-200/50 to-transparent z-10 pointer-events-none"></div>

                                {/* Lane 1: Marker */}
                                <div className="w-20 min-w-[60px] border-r border-slate-200/60 relative group bg-white">
                                    {/* Header */}
                                    <div className="h-14 border-b border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-xs font-bold text-slate-500">
                                        <span>Marker</span>
                                    </div>
                                    {/* Lane Body */}
                                    <div className="relative flex-1 w-full h-[calc(100%-56px)]">
                                        {MARKERS[markerType].bands.map((band, idx) => (
                                            <div 
                                                key={idx}
                                                className="absolute left-2 right-2 h-1 rounded-[1px] shadow-sm"
                                                style={{ 
                                                    top: `${getRelativeY(band.mw)}%`, 
                                                    backgroundColor: band.color,
                                                    opacity: 0.85
                                                }}
                                                title={`${band.mw} kDa`}
                                            >
                                                {/* Hover Label */}
                                                <span className="absolute left-full ml-1 top-1/2 -translate-y-1/2 text-[9px] font-mono text-slate-500 opacity-0 group-hover:opacity-100 whitespace-nowrap bg-white/80 px-1 rounded z-20">
                                                    {band.mw}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Lane 2+: Merged Samples */}
                                {mergedLanes.map((lane, idx) => (
                                    <div key={lane.id} className="flex-1 min-w-[70px] border-r border-slate-200/60 relative group bg-white hover:bg-slate-50/50 transition-colors">
                                        {/* Header */}
                                        <div className="h-14 border-b border-slate-200 bg-slate-50 flex flex-col items-center justify-center px-1 gap-0.5">
                                            <span className="text-[10px] font-bold text-indigo-500 truncate w-full text-center tracking-tight bg-indigo-50/50 rounded-sm px-1">{lane.group}</span>
                                            <span className="text-xs font-medium text-slate-700 truncate w-full text-center" title={lane.name}>{lane.name}</span>
                                        </div>
                                        
                                        {/* Lane Body */}
                                        <div className="relative flex-1 w-full h-[calc(100%-56px)]">
                                            {lane.mws.map((mw, i) => (
                                                <React.Fragment key={i}>
                                                    {/* Simulated Band (Coomassie/Film Style) */}
                                                    <div 
                                                        className="absolute left-3 right-3 h-2 rounded-[1px]"
                                                        style={{ 
                                                            top: `${getRelativeY(mw)}%`,
                                                            // Realistic band gradient (dark center, faded edges)
                                                            background: 'linear-gradient(90deg, rgba(0,0,0,0.5) 0%, rgba(30,30,30,0.9) 30%, rgba(30,30,30,0.9) 70%, rgba(0,0,0,0.5) 100%)',
                                                            boxShadow: '0 0 3px 1px rgba(0,0,0,0.1)',
                                                            filter: 'blur(0.5px)',
                                                            transform: 'translateY(-50%)'
                                                        }}
                                                        title={`${lane.name}: ${mw} kDa`}
                                                    ></div>
                                                    
                                                    {/* Alignment Guide (Red Dashed Line) */}
                                                    <div 
                                                        className="absolute right-full w-[1000px] border-t border-dashed border-red-300 pointer-events-none opacity-0 group-hover:opacity-100 z-0 transition-opacity"
                                                        style={{ top: `${getRelativeY(mw)}%` }}
                                                    ></div>

                                                    {/* MW Label on Hover */}
                                                    <span 
                                                        className="absolute left-1/2 -translate-x-1/2 -mt-5 text-[10px] font-mono font-bold text-slate-700 bg-white border border-slate-200 shadow-sm px-1.5 rounded opacity-0 group-hover:opacity-100 transition-all z-20 pointer-events-none whitespace-nowrap"
                                                        style={{ top: `${getRelativeY(mw)}%` }}
                                                    >
                                                        {mw} kDa
                                                    </span>
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </div>
                                ))}

                                {/* Empty Lane Filler */}
                                {[...Array(Math.max(0, 5 - mergedLanes.length))].map((_, i) => (
                                    <div key={`empty-${i}`} className="flex-1 min-w-[70px] border-r border-slate-200/60 bg-slate-50/30"></div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
              )}

              {/* === Controls List === */}
              {activeTab === 'controls' && (
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                          <h3 className="font-bold text-slate-700">Western Blot 常用内参</h3>
                          <div className="relative">
                              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                              <input 
                                  type="text" 
                                  placeholder="搜索内参..." 
                                  value={searchTerm}
                                  onChange={(e) => setSearchTerm(e.target.value)}
                                  className="pl-9 pr-4 py-1.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-indigo-500 w-48"
                              />
                          </div>
                      </div>
                      <div className="overflow-x-auto">
                          <table className="w-full text-sm text-left">
                              <thead className="bg-slate-50 text-slate-500 font-medium">
                                  <tr>
                                      <th className="px-6 py-3">蛋白名称</th>
                                      <th className="px-6 py-3">分子量 (kDa)</th>
                                      <th className="px-6 py-3">细胞定位</th>
                                      <th className="px-6 py-3">应用/备注</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                  {filteredControls.map((item, idx) => (
                                      <tr key={idx} className="hover:bg-slate-50">
                                          <td className="px-6 py-3 font-bold text-indigo-700">{item.name}</td>
                                          <td className="px-6 py-3 font-mono">{item.mw}</td>
                                          <td className="px-6 py-3">
                                              <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">{item.loc}</span>
                                          </td>
                                          <td className="px-6 py-3 text-slate-600 max-w-xs">{item.app}</td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                          {filteredControls.length === 0 && <div className="p-8 text-center text-slate-400">未找到匹配的内参</div>}
                      </div>
                  </div>
              )}

              {/* === Tags List === */}
              {activeTab === 'tags' && (
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                          <h3 className="font-bold text-slate-700 flex items-center gap-2"><Tag size={18} /> 常用蛋白标签</h3>
                          <div className="relative">
                              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                              <input 
                                  type="text" 
                                  placeholder="搜索标签..." 
                                  value={searchTerm}
                                  onChange={(e) => setSearchTerm(e.target.value)}
                                  className="pl-9 pr-4 py-1.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-indigo-500 w-48"
                              />
                          </div>
                      </div>
                      <div className="overflow-x-auto">
                          <table className="w-full text-sm text-left">
                              <thead className="bg-slate-50 text-slate-500 font-medium">
                                  <tr>
                                      <th className="px-6 py-3">标签名称</th>
                                      <th className="px-6 py-3">分子量 (kDa)</th>
                                      <th className="px-6 py-3">氨基酸序列</th>
                                      <th className="px-6 py-3">特性/描述</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                  {filteredTags.map((item, idx) => (
                                      <tr key={idx} className="hover:bg-slate-50">
                                          <td className="px-6 py-3 font-bold text-indigo-700">{item.name}</td>
                                          <td className="px-6 py-3 font-mono">{item.mw}</td>
                                          <td className="px-6 py-3 font-mono text-xs bg-slate-50 text-slate-700 select-all">{item.seq}</td>
                                          <td className="px-6 py-3 text-slate-600">{item.desc}</td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                          {filteredTags.length === 0 && <div className="p-8 text-center text-slate-400">未找到匹配的标签</div>}
                      </div>
                  </div>
              )}

          </div>
       </div>
    </div>
  );
};