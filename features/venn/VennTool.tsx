import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Combine, Download, Copy, RefreshCw, ChevronDown, ChevronRight, Info, Image as ImageIcon, Palette } from 'lucide-react';

// --- Types ---

interface VennSet {
  id: string;
  name: string;
  text: string;
  color: string;
}

interface IntersectionRegion {
  id: string; // binary key e.g. "1010" (Set A & C)
  sets: string[]; // Names of sets involved
  count: number;
  items: string[];
  labelPosition?: { x: number; y: number }; // For SVG label placement
}

// --- Constants ---

const VENN_PALETTES: Record<string, string[]> = {
  'default': ['#4A90E2', '#50E3C2', '#F5A623', '#E04F5F'], // BioRender Standard
  'pastel': ['#FF9AA2', '#C7CEEA', '#B5EAD7', '#FFDAC1'],  // Soft Pastel
  'retro': ['#264653', '#2A9D8F', '#E9C46A', '#F4A261'],    // Retro/Earth
  'neon': ['#F72585', '#4CC9F0', '#7209B7', '#4361EE'],     // High Contrast
  'cool': ['#0077B6', '#00B4D8', '#90E0EF', '#03045E'],     // Cool Blues
  'warm': ['#E63946', '#F1FAEE', '#A8DADC', '#457B9D'],     // Red/Blue contrast (actually 4th is blue) -> Let's fix warm
  'nature': ['#606C38', '#283618', '#DDA15E', '#BC6C25'],   // Forest
};

// Initial Presets using Default Colors
const PRESETS: Record<number, VennSet[]> = {
  2: [
    { id: 'A', name: 'Group A', text: 'Gene1\nGene2\nGene3\nGene4', color: VENN_PALETTES['default'][0] },
    { id: 'B', name: 'Group B', text: 'Gene3\nGene4\nGene5\nGene6', color: VENN_PALETTES['default'][1] },
  ],
  3: [
    { id: 'A', name: 'Group A', text: '1\n2\n3\n4\n5', color: VENN_PALETTES['default'][0] },
    { id: 'B', name: 'Group B', text: '4\n5\n6\n7\n8', color: VENN_PALETTES['default'][1] },
    { id: 'C', name: 'Group C', text: '1\n5\n8\n9\n10', color: VENN_PALETTES['default'][2] },
  ],
  4: [
    { id: 'A', name: 'Group A', text: 'A\nB\nC\nD', color: VENN_PALETTES['default'][0] },
    { id: 'B', name: 'Group B', text: 'C\nD\nE\nF', color: VENN_PALETTES['default'][1] },
    { id: 'C', name: 'Group C', text: 'E\nF\nG\nH', color: VENN_PALETTES['default'][2] },
    { id: 'D', name: 'Group D', text: 'A\nG\nH\nI', color: VENN_PALETTES['default'][3] },
  ],
};

// --- Helper Functions ---

const parseItems = (text: string) => {
  return new Set(
    text.split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(s => s !== '')
  );
};

const calculateIntersections = (sets: VennSet[]): IntersectionRegion[] => {
  const parsedSets = sets.map(s => ({
    id: s.id,
    name: s.name,
    items: parseItems(s.text)
  }));

  const n = sets.length;
  const regions: IntersectionRegion[] = [];
  
  // Iterate through all 2^n - 1 combinations (1 to 2^n - 1)
  const totalCombs = Math.pow(2, n);
  
  for (let i = 1; i < totalCombs; i++) {
    // Determine which sets are IN this combination
    const includedIndices: number[] = [];
    for (let bit = 0; bit < n; bit++) {
      if ((i >> bit) & 1) {
        includedIndices.push(bit);
      }
    }

    // Determine the items that are in ALL included sets
    // Start with items from the first included set
    let candidateItems = Array.from(parsedSets[includedIndices[0]].items);
    
    // Filter to keep only items present in ALL other included sets
    for (let k = 1; k < includedIndices.length; k++) {
        const setIndex = includedIndices[k];
        candidateItems = candidateItems.filter(item => parsedSets[setIndex].items.has(item));
    }

    // IMPORTANT: Now exclude items that are present in any EXCLUDED sets (to make regions exclusive)
    const exclusiveItems = candidateItems.filter(item => {
        for (let bit = 0; bit < n; bit++) {
            if (!((i >> bit) & 1)) { // If set is NOT in combination
                if (parsedSets[bit].items.has(item)) return false;
            }
        }
        return true;
    });

    if (exclusiveItems.length > 0 || true) { // We keep empty regions for complete mapping if needed, or filter
       regions.push({
           id: i.toString(2).padStart(n, '0').split('').reverse().join(''), // Binary key (LSB is Set A)
           sets: includedIndices.map(idx => parsedSets[idx].name),
           count: exclusiveItems.length,
           items: exclusiveItems.sort()
       });
    }
  }
  
  return regions;
};

// --- Components ---

const IntersectionList: React.FC<{ regions: IntersectionRegion[], sets: VennSet[] }> = ({ regions, sets }) => {
    const [expanded, setExpanded] = useState<string | null>(null);

    // Sort regions by number of sets involved (desc) then count (desc)
    const sortedRegions = [...regions].sort((a, b) => {
        if (a.sets.length !== b.sets.length) return b.sets.length - a.sets.length;
        return b.count - a.count;
    });

    return (
        <div className="space-y-2">
            {sortedRegions.map(region => {
                if (region.count === 0) return null; // Skip empty
                const isExpanded = expanded === region.id;
                
                // Construct label "A ∩ B"
                // Map binary ID back to Set Names or Indices
                const indices: number[] = [];
                for(let i=0; i<region.id.length; i++) {
                    if (region.id[i] === '1') indices.push(i);
                }
                const label = indices.map(idx => sets[idx]?.name || `Set ${idx+1}`).join(' ∩ ');
                
                // Construct exclusive label "Only in A"
                const exclusiveLabel = indices.length === 1 ? `Unique to ${sets[indices[0]]?.name}` : label;

                return (
                    <div key={region.id} className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                        <button 
                            onClick={() => setExpanded(isExpanded ? null : region.id)}
                            className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                        >
                            <div className="flex items-center gap-2 overflow-hidden">
                                {isExpanded ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                                <div className="flex flex-col min-w-0">
                                    <span className="text-sm font-medium text-slate-700 truncate" title={label}>{exclusiveLabel}</span>
                                    <span className="text-xs text-slate-400 truncate">{label}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="bg-white border border-slate-200 px-2 py-0.5 rounded-full text-xs font-bold text-slate-600">
                                    {region.count}
                                </span>
                            </div>
                        </button>
                        
                        {isExpanded && (
                            <div className="p-3 border-t border-slate-200 bg-white">
                                <div className="flex justify-end mb-2">
                                    <button 
                                        onClick={() => navigator.clipboard.writeText(region.items.join('\n'))}
                                        className="text-xs flex items-center gap-1 text-slate-500 hover:text-blue-600 transition-colors"
                                    >
                                        <Copy size={12} /> 复制列表
                                    </button>
                                </div>
                                <div className="max-h-40 overflow-y-auto text-xs font-mono bg-slate-50 p-2 rounded border border-slate-100 select-all">
                                    {region.items.join(', ')}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// --- SVG Renderers (BioRender Style) ---
// Style Notes: Thinner distinct strokes, lower opacity fill, clean font.

const SvgText: React.FC<{x: number, y: number, children: React.ReactNode, color?: string, fontSize?: number, bold?: boolean}> = ({x, y, children, color = "#374151", fontSize=12, bold=true}) => (
    <text 
        x={x} y={y} 
        textAnchor="middle" 
        fill={color} 
        style={{ fontFamily: 'sans-serif', fontWeight: bold ? 'bold' : 'normal', fontSize: `${fontSize}px`, pointerEvents: 'none' }}
    >
        {children}
    </text>
);

const Venn2: React.FC<{ counts: Record<string, number>, sets: VennSet[], svgRef: React.RefObject<SVGSVGElement | null> }> = ({ counts, sets, svgRef }) => (
    <svg ref={svgRef} viewBox="0 0 240 160" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <style>{`
            .venn-circle { mix-blend-mode: multiply; } 
            text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        `}</style>
        <rect width="240" height="160" fill="white" />
        
        {/* Set A */}
        <circle cx="85" cy="80" r="55" fill={sets[0].color} fillOpacity="0.5" stroke={sets[0].color} strokeWidth="2" className="venn-circle" />
        {/* Set B */}
        <circle cx="155" cy="80" r="55" fill={sets[1].color} fillOpacity="0.5" stroke={sets[1].color} strokeWidth="2" className="venn-circle" />

        {/* Labels & Counts */}
        <SvgText x={45} y={85} fontSize={14}>{counts['10'] || 0}</SvgText>
        <SvgText x={45} y={40} color={sets[0].color} fontSize={12}>{sets[0].name}</SvgText>

        <SvgText x={195} y={85} fontSize={14}>{counts['01'] || 0}</SvgText>
        <SvgText x={195} y={40} color={sets[1].color} fontSize={12}>{sets[1].name}</SvgText>

        {/* Intersection */}
        <SvgText x={120} y={85} fontSize={14}>{counts['11'] || 0}</SvgText>
    </svg>
);

const Venn3: React.FC<{ counts: Record<string, number>, sets: VennSet[], svgRef: React.RefObject<SVGSVGElement | null> }> = ({ counts, sets, svgRef }) => (
    <svg ref={svgRef} viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <style>{`
            .venn-circle { mix-blend-mode: multiply; }
            text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        `}</style>
        <rect width="240" height="240" fill="white" />
        
        <g transform="translate(120, 130)">
            {/* A (Top) */}
            <circle cx="0" cy="-45" r="60" fill={sets[0].color} fillOpacity="0.5" stroke={sets[0].color} strokeWidth="2" className="venn-circle" />
            <SvgText x={0} y={-115} color={sets[0].color}>{sets[0].name}</SvgText>
            
            {/* B (Left Bottom) */}
            <circle cx="-40" cy="25" r="60" fill={sets[1].color} fillOpacity="0.5" stroke={sets[1].color} strokeWidth="2" className="venn-circle" />
            <SvgText x={-90} y={65} color={sets[1].color}>{sets[1].name}</SvgText>

            {/* C (Right Bottom) */}
            <circle cx="40" cy="25" r="60" fill={sets[2].color} fillOpacity="0.5" stroke={sets[2].color} strokeWidth="2" className="venn-circle" />
            <SvgText x={90} y={65} color={sets[2].color}>{sets[2].name}</SvgText>

            {/* Counts */}
            <SvgText x={0} y={-65} fontSize={14}>{counts['100'] || 0}</SvgText> {/* A only */}
            <SvgText x={-55} y={35} fontSize={14}>{counts['010'] || 0}</SvgText> {/* B only */}
            <SvgText x={55} y={35} fontSize={14}>{counts['001'] || 0}</SvgText> {/* C only */}
            
            <SvgText x={-32} y={-25} fontSize={12}>{counts['110'] || 0}</SvgText> {/* AB */}
            <SvgText x={32} y={-25} fontSize={12}>{counts['101'] || 0}</SvgText> {/* AC */}
            <SvgText x={0} y={55} fontSize={12}>{counts['011'] || 0}</SvgText> {/* BC */}
            
            <SvgText x={0} y={10} fontSize={14}>{counts['111'] || 0}</SvgText> {/* ABC */}
        </g>
    </svg>
);

const Venn4: React.FC<{ counts: Record<string, number>, sets: VennSet[], svgRef: React.RefObject<SVGSVGElement | null> }> = ({ counts, sets, svgRef }) => (
    <svg ref={svgRef} viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <style>{`
            .venn-ellipse { mix-blend-mode: multiply; }
            text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        `}</style>
        <rect width="300" height="200" fill="white" />

        <g transform="translate(150, 100) scale(1.1)">
            {/* Ellipse 1 (Rotated -45) */}
            <ellipse cx="-20" cy="-10" rx="35" ry="70" transform="rotate(-45 -20 -10)" fill={sets[0].color} fillOpacity="0.4" stroke={sets[0].color} strokeWidth="2" className="venn-ellipse" />
            <SvgText x={-95} y={-35} color={sets[0].color}>{sets[0].name}</SvgText>

            {/* Ellipse 2 (Rotated 45) */}
            <ellipse cx="20" cy="-10" rx="35" ry="70" transform="rotate(45 20 -10)" fill={sets[1].color} fillOpacity="0.4" stroke={sets[1].color} strokeWidth="2" className="venn-ellipse" />
            <SvgText x={95} y={-35} color={sets[1].color}>{sets[1].name}</SvgText>

            {/* Ellipse 3 (Rotated 45, shifted) */}
            <ellipse cx="-20" cy="10" rx="35" ry="70" transform="rotate(45 -20 10)" fill={sets[2].color} fillOpacity="0.4" stroke={sets[2].color} strokeWidth="2" className="venn-ellipse" />
            <SvgText x={-95} y={55} color={sets[2].color}>{sets[2].name}</SvgText>

            {/* Ellipse 4 (Rotated -45, shifted) */}
            <ellipse cx="20" cy="10" rx="35" ry="70" transform="rotate(-45 20 10)" fill={sets[3].color} fillOpacity="0.4" stroke={sets[3].color} strokeWidth="2" className="venn-ellipse" />
            <SvgText x={95} y={55} color={sets[3].color}>{sets[3].name}</SvgText>

            {/* Core Intersection */}
            <SvgText x={0} y={5} fontSize={10}>{counts['1111'] || 0}</SvgText>
            
            {/* Outer Uniques */}
            <SvgText x={-70} y={0} fontSize={10}>{counts['1000'] || 0}</SvgText>
            <SvgText x={70} y={0} fontSize={10}>{counts['0100'] || 0}</SvgText>
            <SvgText x={-40} y={65} fontSize={10}>{counts['0010'] || 0}</SvgText>
            <SvgText x={40} y={65} fontSize={10}>{counts['0001'] || 0}</SvgText>
        </g>
    </svg>
);


// --- Main Component ---

export const VennTool: React.FC = () => {
  const [numSets, setNumSets] = useState<number>(3);
  const [activePalette, setActivePalette] = useState<string>('default');
  const [sets, setSets] = useState<VennSet[]>(PRESETS[3]);
  const svgRef = useRef<SVGSVGElement>(null);

  // Sync colors when palette changes
  useEffect(() => {
      const colors = VENN_PALETTES[activePalette];
      if (!colors) return;
      
      setSets(prevSets => prevSets.map((s, i) => ({
          ...s,
          color: colors[i % colors.length]
      })));
  }, [activePalette]);

  // Update sets when number changes
  const handleNumSetsChange = (n: number) => {
      setNumSets(n);
      // Preserve existing data if possible, else load preset
      const current = [...sets];
      const palette = VENN_PALETTES[activePalette];

      if (current.length < n) {
          // Add
          const template = PRESETS[4]; // Use 4-set template to grab extra
          for(let i=current.length; i<n; i++) {
              current.push({ ...template[i], color: palette[i % palette.length] });
          }
      } else {
          // Trim
          current.length = n;
      }
      setSets(current);
  };

  const updateSet = (index: number, field: keyof VennSet, value: string) => {
      const newSets = [...sets];
      newSets[index] = { ...newSets[index], [field]: value };
      setSets(newSets);
  };

  const clearAll = () => {
      setSets(sets.map(s => ({ ...s, text: '' })));
  };

  // --- Calculation ---
  const results = useMemo(() => calculateIntersections(sets), [sets]);
  
  // Create a map for quick SVG lookup: "101" -> count
  const countMap = useMemo(() => {
      const map: Record<string, number> = {};
      results.forEach(r => map[r.id] = r.count);
      return map;
  }, [results]);

  const handleExportCsv = () => {
      let csv = "\uFEFFRegion,Sets,Count,Items\n";
      results.forEach(r => {
          // Resolve set names
          const indices: number[] = [];
          for(let i=0; i<r.id.length; i++) if(r.id[i] === '1') indices.push(i);
          const names = indices.map(idx => sets[idx].name).join(' & ');
          
          csv += `"${names}","${r.sets.join('+')}",${r.count},"${r.items.join(';')}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "Venn_Analysis.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleExportSvg = () => {
      if (!svgRef.current) return;
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(svgRef.current);
      
      // Ensure namespace
      if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
          source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      if (!source.match(/^<svg[^>]+xmlns:xlink/)) {
          source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
      }

      // Add XML declaration
      source = '<?xml version="1.0" standalone="no"?>\r\n' + source;

      const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Venn_Diagram_BioRender_Style.svg";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-600">
                <Combine size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">韦恩图 (Venn Diagram)</h2>
               <p className="text-slate-500">多组数据交集分析与可视化 (支持 2-4 组)</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px] items-start">
           
           {/* LEFT: Input Area */}
           <div className="lg:col-span-4 flex flex-col gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex bg-slate-100 p-1 rounded-lg">
                            {[2,3,4].map(n => (
                                <button 
                                    key={n} 
                                    onClick={() => handleNumSetsChange(n)}
                                    className={`px-3 py-1 text-xs font-bold rounded transition-all ${numSets === n ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-emerald-500'}`}
                                >
                                    {n} 组
                                </button>
                            ))}
                        </div>
                        <button onClick={clearAll} className="text-slate-400 hover:text-red-500 p-1.5 rounded hover:bg-slate-50 transition-colors" title="清空所有数据">
                            <RefreshCw size={16} />
                        </button>
                    </div>

                    {/* Palette Selector */}
                    <div className="mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <label className="text-xs font-bold text-slate-500 mb-2 block flex items-center gap-1">
                            <Palette size={12} /> 配色方案
                        </label>
                        <div className="flex gap-2 flex-wrap">
                            {Object.entries(VENN_PALETTES).map(([key, colors]) => (
                                <button
                                    key={key}
                                    onClick={() => setActivePalette(key)}
                                    className={`flex gap-0.5 p-1 rounded border transition-all ${activePalette === key ? 'border-emerald-500 ring-1 ring-emerald-500 bg-white shadow-sm' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                                    title={key}
                                >
                                    {colors.slice(0, 4).map((c, i) => (
                                        <div key={`${key}-${i}`} className="w-3 h-3 rounded-full" style={{ backgroundColor: c }} />
                                    ))}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4 max-h-[calc(100vh-380px)] overflow-y-auto pr-2">
                        {sets.map((set, idx) => (
                            <div key={set.id} className="flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: set.color }}></div>
                                    <input 
                                        type="text" 
                                        value={set.name} 
                                        onChange={(e) => updateSet(idx, 'name', e.target.value)}
                                        className="flex-1 text-sm font-bold text-slate-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-emerald-500 outline-none px-1"
                                    />
                                    <span className="text-xs text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded">{parseItems(set.text).size} items</span>
                                </div>
                                <textarea
                                    value={set.text}
                                    onChange={(e) => updateSet(idx, 'text', e.target.value)}
                                    className="w-full h-32 p-3 text-xs font-mono border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-y bg-slate-50 placeholder-slate-400"
                                    placeholder={`输入元素列表\n每行一个\n或逗号分隔`}
                                />
                            </div>
                        ))}
                    </div>
                </div>
           </div>

           {/* MIDDLE: Visualization */}
           <div className="lg:col-span-5 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col items-center justify-center min-h-[400px] relative group">
                   <div className="w-full aspect-square max-w-[400px]">
                       {numSets === 2 && <Venn2 counts={countMap} sets={sets} svgRef={svgRef} />}
                       {numSets === 3 && <Venn3 counts={countMap} sets={sets} svgRef={svgRef} />}
                       {numSets === 4 && <Venn4 counts={countMap} sets={sets} svgRef={svgRef} />}
                   </div>
                   
                   <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                            onClick={handleExportSvg}
                            className="flex items-center gap-1 bg-white border border-slate-200 shadow-sm px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                            title="导出为可编辑 SVG 矢量图"
                        >
                            <ImageIcon size={14} /> 导出图片 (SVG)
                        </button>
                   </div>

                   <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs text-slate-400 bg-white/80 p-1 rounded backdrop-blur">
                        <Info size={14} /> 
                        <span>数字代表各区域包含的元素数量</span>
                   </div>
               </div>
               
               <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-lg flex gap-2 items-start border border-blue-100">
                     <Info size={14} className="mt-0.5 shrink-0" />
                     <p>
                        <strong>提示：</strong> 您可以导出 SVG 格式的图片，然后在 Adobe Illustrator 或 Inkscape 中进行无限放大的编辑。4 组数据采用椭圆布局展示。
                     </p>
               </div>
           </div>

           {/* RIGHT: List & Export */}
           <div className="lg:col-span-3 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col min-h-[500px]">
                   <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                       <h3 className="font-bold text-slate-800 flex items-center gap-2">
                           交集明细
                       </h3>
                       <button 
                            onClick={handleExportCsv}
                            className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                       >
                           <Download size={14} /> 导出数据
                       </button>
                   </div>
                   
                   <div className="flex-1 overflow-y-auto">
                       {results.length > 0 ? (
                           <IntersectionList regions={results} sets={sets} />
                       ) : (
                           <div className="text-center text-slate-400 py-10">
                               <Combine size={40} className="mx-auto mb-2 opacity-20" />
                               <p className="text-sm">暂无数据</p>
                           </div>
                       )}
                   </div>
               </div>
           </div>

       </div>
    </div>
  );
};
