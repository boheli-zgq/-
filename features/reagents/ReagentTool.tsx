import React, { useState, useMemo } from 'react';
import { Search, FlaskConical, Thermometer, Droplet, Clock, AlertTriangle, BookOpen, ChevronRight, Scale, Filter } from 'lucide-react';

// --- Types ---

interface Ingredient {
  name: string;
  amount: number;
  unit: string;
  type: 'solid' | 'liquid'; // solid (g), liquid (mL/L)
  note?: string;
}

interface Reagent {
  id: string;
  name: string;
  category: string;
  description: string;
  baseVolume: number; // Standard volume in mL (usually 1000)
  ingredients: Ingredient[];
  steps: string[];
  storage: string;
  safety?: string;
}

// --- Database ---

const REAGENTS: Reagent[] = [
  // --- Buffers ---
  {
    id: 'pbs-1x',
    name: 'PBS (1X) 磷酸盐缓冲液',
    category: 'Buffers',
    description: '最常用的生物学缓冲液，用于细胞清洗、组织运输等 (pH 7.4)。',
    baseVolume: 1000,
    ingredients: [
      { name: 'NaCl (氯化钠)', amount: 8.0, unit: 'g', type: 'solid' },
      { name: 'KCl (氯化钾)', amount: 0.2, unit: 'g', type: 'solid' },
      { name: 'Na₂HPO₄ (磷酸氢二钠)', amount: 1.44, unit: 'g', type: 'solid' },
      { name: 'KH₂PO₄ (磷酸二氢钾)', amount: 0.24, unit: 'g', type: 'solid' },
    ],
    steps: [
      '向烧杯中加入约 800 mL 去离子水 (ddH₂O)。',
      '按顺序加入上述试剂，搅拌直至完全溶解。',
      '调节 pH 至 7.4 (使用 HCl 或 NaOH)。',
      '定容至 1000 mL。',
      '高温高压灭菌 (121°C, 20min) 后室温保存。'
    ],
    storage: '室温保存',
  },
  {
    id: 'tbs-10x',
    name: 'TBS (10X) Stock Solution',
    category: 'Buffers',
    description: 'Western Blot 常用缓冲液母液，使用时稀释至 1X。',
    baseVolume: 1000,
    ingredients: [
      { name: 'Tris Base', amount: 24.2, unit: 'g', type: 'solid' },
      { name: 'NaCl (氯化钠)', amount: 80.0, unit: 'g', type: 'solid' },
    ],
    steps: [
      '加入 800 mL 去离子水。',
      '搅拌溶解。',
      '调节 pH 至 7.6 (使用浓 HCl)。',
      '定容至 1000 mL。',
      '使用时稀释 10 倍 (1份 TBS + 9份水)。'
    ],
    storage: '室温保存',
  },
  {
    id: 'tbst-1x',
    name: 'TBST (1X) 洗涤液',
    category: 'Buffers',
    description: '含 Tween-20 的 TBS，用于 Western Blot 洗膜。',
    baseVolume: 1000,
    ingredients: [
      { name: '10X TBS Stock', amount: 100, unit: 'mL', type: 'liquid' },
      { name: 'Tween-20', amount: 1, unit: 'mL', type: 'liquid', note: '粘稠，建议剪宽枪头吸取' },
      { name: 'ddH₂O', amount: 899, unit: 'mL', type: 'liquid' },
    ],
    steps: [
      '混合 10X TBS 和水。',
      '加入 Tween-20。',
      '磁力搅拌直至 Tween-20 完全溶解 (不再有丝状物)。'
    ],
    storage: '室温保存 (建议现配现用)',
  },

  // --- Stock Solutions ---
  {
    id: 'edta-0.5m',
    name: '0.5M EDTA (pH 8.0)',
    category: 'Stock Solutions',
    description: '常用的二价阳离子螯合剂储备液。难溶，需调pH。',
    baseVolume: 1000,
    ingredients: [
      { name: 'EDTA-Na₂·2H₂O', amount: 186.1, unit: 'g', type: 'solid' },
      { name: 'NaOH (氢氧化钠颗粒)', amount: 20, unit: 'g', type: 'solid', note: '约需量，用于调节pH' },
    ],
    steps: [
      '加入 800 mL 去离子水。',
      '加入 EDTA 二钠盐，剧烈搅拌（此时不会溶解）。',
      '加入 NaOH 颗粒调节 pH。EDTA 只有在 pH 接近 8.0 时才会开始溶解。',
      '溶液澄清后，精确调节 pH 至 8.0。',
      '定容至 1000 mL，高压灭菌。'
    ],
    storage: '室温保存',
  },
  {
    id: 'nacl-5m',
    name: '5M NaCl Stock',
    category: 'Stock Solutions',
    description: '高浓度氯化钠储备液。',
    baseVolume: 1000,
    ingredients: [
      { name: 'NaCl (氯化钠)', amount: 292.2, unit: 'g', type: 'solid' },
    ],
    steps: [
      '加入 800 mL 去离子水。',
      '加热并搅拌以加速溶解 (溶解度接近饱和)。',
      '冷却至室温后定容至 1000 mL。',
      '高压灭菌。'
    ],
    storage: '室温保存',
  },
  {
    id: 'sds-10',
    name: '10% SDS Stock',
    category: 'Stock Solutions',
    description: '十二烷基硫酸钠储备液，用于裂解液和电泳缓冲液。',
    baseVolume: 1000,
    ingredients: [
      { name: 'SDS 粉末', amount: 100, unit: 'g', type: 'solid', note: '佩戴口罩，避免吸入粉尘' },
    ],
    steps: [
      '加热 900 mL 去离子水至 60°C。',
      '在通风橱中小心加入 SDS 粉末。',
      '轻轻搅拌溶解 (避免产生过多泡沫)。',
      '定容至 1000 mL。',
      '不要调节 pH。'
    ],
    storage: '室温保存 (低温会析出，使用前温热助溶)',
    safety: 'SDS 粉尘对呼吸道有强烈刺激性。',
  },
  {
    id: 'tris-1m-ph8',
    name: '1M Tris-HCl (pH 8.0)',
    category: 'Stock Solutions',
    description: '常用的缓冲液储备液。',
    baseVolume: 1000,
    ingredients: [
      { name: 'Tris Base', amount: 121.1, unit: 'g', type: 'solid' },
      { name: '浓盐酸 (HCl)', amount: 42, unit: 'mL', type: 'liquid', note: '约需量，需边测pH边加' },
    ],
    steps: [
      '加入 800 mL 去离子水溶解 Tris Base。',
      '待溶液冷却至室温（溶解吸热/放热会影响pH计）。',
      '缓慢滴加浓 HCl 调节 pH 至 8.0。',
      '定容至 1000 mL。'
    ],
    storage: '室温保存',
  },

  // --- Electrophoresis ---
  {
    id: 'tae-50x',
    name: 'TAE Buffer (50X) Stock',
    category: 'Electrophoresis',
    description: '用于 DNA 琼脂糖凝胶电泳。使用时需稀释至 1X。',
    baseVolume: 1000,
    ingredients: [
      { name: 'Tris Base', amount: 242, unit: 'g', type: 'solid' },
      { name: '冰醋酸 (Glacial Acetic Acid)', amount: 57.1, unit: 'mL', type: 'liquid' },
      { name: '0.5M EDTA (pH 8.0)', amount: 100, unit: 'mL', type: 'liquid' },
    ],
    steps: [
      '向烧杯中加入约 600 mL 去离子水。',
      '加入 Tris Base，搅拌溶解 (可能需要加热)。',
      '加入冰醋酸和 EDTA 溶液。',
      '冷却至室温后，定容至 1000 mL。',
      '无需调节 pH (稀释成 1X 后 pH 约为 8.3)。'
    ],
    storage: '室温保存',
    safety: '冰醋酸具有腐蚀性和挥发性，请在通风橱操作。',
  },
  {
    id: 'tbe-10x',
    name: 'TBE Buffer (10X) Stock',
    category: 'Electrophoresis',
    description: '用于高分辨率 DNA 电泳和测序胶。缓冲能力强于 TAE。',
    baseVolume: 1000,
    ingredients: [
      { name: 'Tris Base', amount: 108, unit: 'g', type: 'solid' },
      { name: 'Boric Acid (硼酸)', amount: 55, unit: 'g', type: 'solid' },
      { name: '0.5M EDTA (pH 8.0)', amount: 40, unit: 'mL', type: 'liquid' },
    ],
    steps: [
      '加入 800 mL 去离子水。',
      '加入 Tris 和硼酸，长时间搅拌溶解（硼酸溶解较慢）。',
      '加入 EDTA。',
      '定容至 1000 mL。',
      '存放时间过长可能产生沉淀，使用前过滤。'
    ],
    storage: '室温保存',
  },
  {
    id: 'sds-running-10x',
    name: 'SDS-PAGE Running Buffer (10X)',
    category: 'Electrophoresis',
    description: '蛋白电泳电极缓冲液母液。',
    baseVolume: 1000,
    ingredients: [
      { name: 'Tris Base', amount: 30.3, unit: 'g', type: 'solid' },
      { name: 'Glycine (甘氨酸)', amount: 144, unit: 'g', type: 'solid' },
      { name: 'SDS', amount: 10, unit: 'g', type: 'solid' },
    ],
    steps: [
      '加入 800 mL 去离子水。',
      '加入 Tris 和 Glycine 搅拌溶解。',
      '最后加入 SDS (避免过度搅拌产生大量泡沫)。',
      '定容至 1000 mL。',
      '无需调节 pH (pH 约为 8.3)。'
    ],
    storage: '室温保存',
  },
  {
    id: 'towbin-transfer',
    name: 'Towbin Transfer Buffer (1X)',
    category: 'Electrophoresis',
    description: 'Western Blot 湿转缓冲液 (含 20% 甲醇)。',
    baseVolume: 1000,
    ingredients: [
      { name: 'Tris Base', amount: 3.03, unit: 'g', type: 'solid' },
      { name: 'Glycine (甘氨酸)', amount: 14.4, unit: 'g', type: 'solid' },
      { name: 'Methanol (甲醇)', amount: 200, unit: 'mL', type: 'liquid' },
      { name: 'SDS (可选)', amount: 0.37, unit: 'g', type: 'solid', note: '0.037%, 仅用于大蛋白转膜' },
    ],
    steps: [
      '溶解 Tris 和 Glycine 于 700 mL 水中。',
      '加入甲醇 (甲醇会产热，需冷却)。',
      '定容至 1000 mL。',
      '不要调节 pH (pH 约为 8.3)。',
      '使用前预冷至 4°C。'
    ],
    storage: '4°C 保存 (可重复使用 2-3 次)',
    safety: '甲醇有毒且易挥发。',
  },
  {
    id: 'laemmli-4x',
    name: '4X Protein Loading Buffer',
    category: 'Electrophoresis',
    description: 'SDS-PAGE 蛋白上样缓冲液 (Laemmli Sample Buffer)。',
    baseVolume: 10,
    ingredients: [
      { name: '1M Tris-HCl (pH 6.8)', amount: 2.0, unit: 'mL', type: 'liquid' },
      { name: 'Glycerol (甘油)', amount: 4.0, unit: 'mL', type: 'liquid' },
      { name: 'SDS (粉末)', amount: 0.8, unit: 'g', type: 'solid' },
      { name: 'Bromophenol Blue (溴酚蓝)', amount: 4, unit: 'mg', type: 'solid' },
      { name: 'β-Mercaptoethanol (BME)', amount: 0.4, unit: 'mL', type: 'liquid', note: '或用 DTT, 临用前加' },
    ],
    steps: [
      '混合 Tris (pH 6.8 必须准确) 和甘油。',
      '加入 SDS 粉末和溴酚蓝，搅拌溶解 (可适当温热)。',
      '补足水至 10 mL (如果未加 BME/DTT)。',
      '还原剂 (BME/DTT) 建议分装后冻存，或使用前新鲜加入 (10% v/v)。'
    ],
    storage: '-20°C 分装保存',
    safety: 'BME 有恶臭且有毒，必须在通风橱操作。',
  },

  // --- Stains ---
  {
    id: 'ponceau-s',
    name: 'Ponceau S Staining Solution',
    category: 'Stains',
    description: 'Western Blot 转膜后用于膜上蛋白的可逆染色。',
    baseVolume: 100,
    ingredients: [
      { name: 'Ponceau S (粉末)', amount: 0.1, unit: 'g', type: 'solid' },
      { name: 'Acetic Acid (乙酸)', amount: 5, unit: 'mL', type: 'liquid' },
      { name: 'ddH₂O', amount: 95, unit: 'mL', type: 'liquid' },
    ],
    steps: [
      '混合乙酸和水。',
      '加入 Ponceau S 粉末。',
      '搅拌溶解。',
      '染色 5-10 分钟，用蒸馏水脱色直至背景清晰。'
    ],
    storage: '室温保存，避光',
  },
  {
    id: 'coomassie-r250',
    name: 'Coomassie Blue R-250',
    category: 'Stains',
    description: 'SDS-PAGE 凝胶染色液 (染色速度快)。',
    baseVolume: 1000,
    ingredients: [
      { name: 'Coomassie R-250', amount: 1.0, unit: 'g', type: 'solid' },
      { name: 'Methanol (甲醇)', amount: 450, unit: 'mL', type: 'liquid' },
      { name: 'Acetic Acid (冰乙酸)', amount: 100, unit: 'mL', type: 'liquid' },
      { name: 'ddH₂O', amount: 450, unit: 'mL', type: 'liquid' },
    ],
    steps: [
      '混合甲醇、乙酸和水。',
      '加入考马斯亮蓝 R-250。',
      '搅拌 3-4 小时直至溶解。',
      '使用滤纸过滤后使用。'
    ],
    storage: '室温保存',
  },

  // --- Microbiology & Cell ---
  {
    id: 'lb-broth',
    name: 'LB 液体培养基 (Luria-Bertani)',
    category: 'Microbiology',
    description: '用于大肠杆菌培养的标准培养基。',
    baseVolume: 1000,
    ingredients: [
      { name: 'Tryptone (胰蛋白胨)', amount: 10, unit: 'g', type: 'solid' },
      { name: 'Yeast Extract (酵母提取物)', amount: 5, unit: 'g', type: 'solid' },
      { name: 'NaCl (氯化钠)', amount: 10, unit: 'g', type: 'solid' },
    ],
    steps: [
      '向烧杯中加入 950 mL 去离子水。',
      '加入试剂并搅拌溶解。',
      '若需要，用 5N NaOH 调节 pH 至 7.0 (可选)。',
      '定容至 1000 mL。',
      '高温高压灭菌 (121°C, 20min)。'
    ],
    storage: '4°C 保存',
  },
  {
    id: 'pfa-4',
    name: '4% PFA (多聚甲醛固定液)',
    category: 'Histology',
    description: '最常用的组织细胞固定液。',
    baseVolume: 100,
    ingredients: [
      { name: 'Paraformaldehyde (多聚甲醛粉末)', amount: 4, unit: 'g', type: 'solid' },
      { name: 'PBS (1X)', amount: 100, unit: 'mL', type: 'liquid' },
    ],
    steps: [
      '在通风橱中操作！加热 PBS 至约 60°C (不要沸腾)。',
      '加入 PFA 粉末，持续搅拌。',
      '逐滴加入 1N NaOH 直至溶液变澄清 (助溶)。',
      '冷却后调节 pH 至 7.4。',
      '过滤后分装。'
    ],
    storage: '-20°C 保存，避免反复冻融',
    safety: '剧毒！致癌！必须在通风橱内操作，佩戴手套和口罩。',
  },
  {
    id: 'ripa',
    name: 'RIPA Lysis Buffer (Strong)',
    category: 'Protein',
    description: '强效细胞裂解液，适用于 WB。',
    baseVolume: 100,
    ingredients: [
      { name: '1M Tris-HCl (pH 8.0)', amount: 5, unit: 'mL', type: 'liquid' },
      { name: '5M NaCl', amount: 3, unit: 'mL', type: 'liquid' },
      { name: 'NP-40 (or Triton X-100)', amount: 1, unit: 'mL', type: 'liquid' },
      { name: 'Sodium Deoxycholate (脱氧胆酸钠)', amount: 0.5, unit: 'g', type: 'solid' },
      { name: 'SDS (10% Stock)', amount: 1, unit: 'mL', type: 'liquid' },
      { name: 'ddH₂O', amount: 89, unit: 'mL', type: 'liquid', note: '补足体积' },
    ],
    steps: [
      '混合所有成分。',
      '搅拌直至完全溶解澄清。',
      '使用前临用加入蛋白酶抑制剂 (Protease Inhibitors)。'
    ],
    storage: '4°C 保存',
  },
];

const CATEGORIES = Array.from(new Set(REAGENTS.map(r => r.category)));

export const ReagentTool: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string>(REAGENTS[0].id);
  const [targetVolume, setTargetVolume] = useState<number>(500); // User input volume
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const selectedReagent = useMemo(() => REAGENTS.find(r => r.id === selectedId), [selectedId]);

  const filteredReagents = useMemo(() => {
    return REAGENTS.filter(r => {
      const matchSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          r.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCat = activeCategory === 'All' || r.category === activeCategory;
      return matchSearch && matchCat;
    });
  }, [searchTerm, activeCategory]);

  const scaleFactor = selectedReagent ? targetVolume / selectedReagent.baseVolume : 1;

  // Formatting helper
  const fmt = (val: number) => {
    const scaled = val * scaleFactor;
    
    // Tiny amounts logic
    if (scaled < 0.001) return (scaled * 1000).toFixed(2) + ' μL';
    if (scaled < 0.1) return scaled.toPrecision(2);
    if (scaled % 1 === 0) return scaled.toString();
    return scaled.toFixed(2).replace(/\.00$/, '');
  };

  const getDisplayUnit = (val: number, originalUnit: string) => {
      const scaled = val * scaleFactor;
      if (scaled < 0.001 && originalUnit === 'mL') return ''; // Handled in fmt
      return originalUnit;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-cyan-100 p-3 rounded-2xl text-cyan-700">
                <BookOpen size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">实验室试剂配方库</h2>
               <p className="text-slate-500">常用试剂配制指南，支持按需体积自动计算 (智能变倍)</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px] items-start">
           
           {/* LEFT: Sidebar List */}
           <div className="lg:col-span-4 flex flex-col gap-4 h-full max-h-[80vh]">
               {/* Search & Filter */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                   <div className="relative mb-3">
                       <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                       <input 
                           type="text" 
                           placeholder="搜索试剂 (如 PBS, Tris)..." 
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
                       />
                   </div>
                   <div className="flex flex-wrap gap-2">
                       <button 
                           onClick={() => setActiveCategory('All')}
                           className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${activeCategory === 'All' ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                       >
                           All
                       </button>
                       {CATEGORIES.map(cat => (
                           <button 
                               key={cat}
                               onClick={() => setActiveCategory(cat)}
                               className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${activeCategory === cat ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                           >
                               {cat}
                           </button>
                       ))}
                   </div>
               </div>

               {/* List */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-y-auto min-h-[500px]">
                   <div className="divide-y divide-slate-100">
                       {filteredReagents.map(r => (
                           <button
                               key={r.id}
                               onClick={() => { setSelectedId(r.id); setTargetVolume(r.baseVolume < 100 ? 50 : 500); }}
                               className={`w-full text-left p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group ${selectedId === r.id ? 'bg-cyan-50/50 border-l-4 border-cyan-500' : 'border-l-4 border-transparent'}`}
                           >
                               <div>
                                   <div className={`font-bold text-sm ${selectedId === r.id ? 'text-cyan-800' : 'text-slate-700'}`}>{r.name}</div>
                                   <div className="text-xs text-slate-400 mt-0.5">{r.category}</div>
                               </div>
                               {selectedId === r.id && <ChevronRight size={16} className="text-cyan-500" />}
                           </button>
                       ))}
                       {filteredReagents.length === 0 && (
                           <div className="p-8 text-center text-slate-400 text-sm">无匹配试剂</div>
                       )}
                   </div>
               </div>
           </div>

           {/* RIGHT: Detail View */}
           <div className="lg:col-span-8">
               {selectedReagent ? (
                   <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-8 space-y-8 animate-fade-in">
                       
                       {/* Header */}
                       <div className="border-b border-slate-100 pb-6">
                           <div className="flex items-start justify-between">
                               <div>
                                   <div className="flex items-center gap-2 mb-2">
                                       <span className="text-xs font-bold text-cyan-600 bg-cyan-50 px-2 py-1 rounded inline-block uppercase tracking-wide">
                                           {selectedReagent.category}
                                       </span>
                                   </div>
                                   <h1 className="text-3xl font-bold text-slate-800 mb-2">{selectedReagent.name}</h1>
                                   <p className="text-slate-600">{selectedReagent.description}</p>
                               </div>
                           </div>
                       </div>

                       {/* Calculator */}
                       <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 flex flex-col md:flex-row items-center gap-6">
                           <div className="flex-1">
                               <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                                   <FlaskConical size={18} className="text-cyan-600" />
                                   我想配制的体积:
                               </label>
                               <div className="flex items-center gap-2">
                                   <input 
                                       type="number" 
                                       value={targetVolume}
                                       onChange={(e) => setTargetVolume(parseFloat(e.target.value) || 0)}
                                       className="text-2xl font-bold text-cyan-700 bg-white border border-slate-300 rounded-lg px-4 py-2 w-40 focus:ring-2 focus:ring-cyan-500 outline-none"
                                   />
                                   <span className="text-lg text-slate-500 font-medium">mL</span>
                               </div>
                           </div>
                           <div className="h-12 w-px bg-slate-200 hidden md:block"></div>
                           <div className="text-sm text-slate-500 md:max-w-xs">
                               * 下方配方表已自动根据 <strong>{targetVolume} mL</strong> 进行调整。
                           </div>
                       </div>

                       {/* Ingredients Table */}
                       <div>
                           <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                               <Scale size={20} className="text-indigo-500" /> 配方组成 (Ingredients)
                           </h3>
                           <div className="overflow-hidden rounded-xl border border-slate-200">
                               <table className="w-full text-sm text-left">
                                   <thead className="bg-slate-50 text-slate-500 font-medium">
                                       <tr>
                                           <th className="px-6 py-3">组分名称</th>
                                           <th className="px-6 py-3 text-right">需要量</th>
                                           <th className="px-6 py-3 w-1/3">备注</th>
                                       </tr>
                                   </thead>
                                   <tbody className="divide-y divide-slate-100">
                                       {selectedReagent.ingredients.map((ing, idx) => (
                                           <tr key={idx} className="hover:bg-slate-50/50">
                                               <td className="px-6 py-4 font-medium text-slate-700">{ing.name}</td>
                                               <td className="px-6 py-4 text-right">
                                                   <span className="text-lg font-bold text-cyan-700">{fmt(ing.amount)}</span>
                                                   <span className="text-slate-500 ml-1">{getDisplayUnit(ing.amount, ing.unit)}</span>
                                               </td>
                                               <td className="px-6 py-4 text-slate-500 text-xs italic">
                                                   {ing.note || '-'}
                                               </td>
                                           </tr>
                                       ))}
                                   </tbody>
                                   <tfoot className="bg-indigo-50/30 text-slate-600 font-medium">
                                       <tr>
                                           <td className="px-6 py-3">溶剂 (ddH₂O)</td>
                                           <td className="px-6 py-3 text-right">定容至 {targetVolume} mL</td>
                                           <td></td>
                                       </tr>
                                   </tfoot>
                               </table>
                           </div>
                       </div>

                       {/* Instructions */}
                       <div>
                           <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                               <Clock size={20} className="text-emerald-500" /> 配制步骤
                           </h3>
                           <div className="space-y-4 relative pl-4 border-l-2 border-slate-100 ml-2">
                               {selectedReagent.steps.map((step, idx) => (
                                   <div key={idx} className="relative">
                                       <div className="absolute -left-[21px] top-0 bg-white border-2 border-slate-200 text-slate-400 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                                           {idx + 1}
                                       </div>
                                       <p className="text-slate-700 leading-relaxed pl-4">{step}</p>
                                   </div>
                               ))}
                           </div>
                       </div>

                       {/* Footer Meta */}
                       <div className="grid md:grid-cols-2 gap-4 pt-6 border-t border-slate-100">
                           <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex items-start gap-3">
                               <Thermometer size={20} className="text-blue-500 shrink-0 mt-0.5" />
                               <div>
                                   <h4 className="font-bold text-slate-700 text-sm">保存条件</h4>
                                   <p className="text-sm text-slate-600">{selectedReagent.storage}</p>
                               </div>
                           </div>
                           {selectedReagent.safety && (
                               <div className="bg-red-50 p-4 rounded-lg border border-red-100 flex items-start gap-3">
                                   <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
                                   <div>
                                       <h4 className="font-bold text-red-800 text-sm">安全警示</h4>
                                       <p className="text-sm text-red-700">{selectedReagent.safety}</p>
                                   </div>
                               </div>
                           )}
                       </div>

                   </div>
               ) : (
                   <div className="h-full flex flex-col items-center justify-center text-slate-300 min-h-[400px]">
                       <FlaskConical size={64} className="mb-4 opacity-30" />
                       <p>请从左侧选择一个试剂配方</p>
                   </div>
               )}
           </div>

       </div>
    </div>
  );
};
