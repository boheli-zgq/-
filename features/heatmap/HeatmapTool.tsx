
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Grid, Download, Upload, Sliders, RefreshCw, Palette, Info, Maximize2, Type } from 'lucide-react';

// --- Types ---

interface HeatmapData {
  rows: string[]; // Row labels (e.g., Genes)
  cols: string[]; // Col labels (e.g., Samples)
  matrix: number[][]; // Raw values
}

type ColorPalette = 'rwb' | 'gbr' | 'viridis' | 'magma' | 'plasma' | 'blue' | 'red' | 'rainbow' | 'bgyr';

// --- Constants ---

const PALETTES: Record<ColorPalette, { name: string, colors: string[], type: 'diverging' | 'sequential' }> = {
  'rwb': { name: 'Red-White-Blue', colors: ['#3b82f6', '#ffffff', '#ef4444'], type: 'diverging' },
  'gbr': { name: 'Green-Black-Red', colors: ['#22c55e', '#000000', '#ef4444'], type: 'diverging' },
  'viridis': { name: 'Viridis', colors: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'], type: 'sequential' },
  'magma': { name: 'Magma', colors: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fecf92'], type: 'sequential' },
  'plasma': { name: 'Plasma', colors: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'], type: 'sequential' },
  'blue': { name: 'Sequential Blue', colors: ['#f0f9ff', '#0284c7'], type: 'sequential' },
  'red': { name: 'Sequential Red', colors: ['#fef2f2', '#dc2626'], type: 'sequential' },
  'rainbow': { name: 'Rainbow', colors: ['#7e22ce', '#3b82f6', '#06b6d4', '#22c55e', '#eab308', '#ef4444'], type: 'sequential' },
  'bgyr': { name: 'Blue-Green-Yellow-Red', colors: ['#0000ff', '#00ff00', '#ffff00', '#ff0000'], type: 'diverging' },
};

const DEFAULT_DATA = `Gene\tCtrl_1\tCtrl_2\tCtrl_3\tTreat_1\tTreat_2\tTreat_3
Actin\t10.2\t10.5\t10.1\t10.3\t10.4\t10.2
Gapdh\t12.1\t12.0\t12.2\t12.1\t11.9\t12.0
IL-6\t2.1\t2.3\t2.0\t8.5\t9.1\t8.8
TNF-a\t1.5\t1.8\t1.6\t6.2\t6.8\t6.5
CXCL1\t5.0\t5.2\t5.1\t15.3\t16.0\t15.5
BCL2\t8.0\t8.2\t8.1\t3.2\t3.0\t3.1
BAX\t4.1\t4.0\t4.2\t9.5\t9.8\t9.6
p53\t6.0\t6.2\t6.1\t6.3\t6.1\t6.2`;

// --- Helper Functions ---

const parseInput = (text: string): HeatmapData | null => {
  try {
    const lines = text.trim().split(/[\r\n]+/);
    if (lines.length < 2) return null;

    // Header (Columns)
    const header = lines[0].split(/[\t,]/).map(s => s.trim());
    const cols = header.slice(1); // Skip the first corner cell

    const rows: string[] = [];
    const matrix: number[][] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/[\t,]/).map(s => s.trim());
      if (parts.length < 2) continue;
      
      rows.push(parts[0]);
      const values = parts.slice(1).map(v => parseFloat(v));
      
      // Pad or trim if inconsistent
      if (values.length !== cols.length) {
          // simple fix: fill NaN or trim
          while(values.length < cols.length) values.push(NaN);
          matrix.push(values.slice(0, cols.length));
      } else {
          matrix.push(values);
      }
    }

    return { rows, cols, matrix };
  } catch (e) {
    console.error("Parse error", e);
    return null;
  }
};

const calculateZScore = (matrix: number[][]): number[][] => {
  return matrix.map(row => {
    // Filter NaN
    const valid = row.filter(n => !isNaN(n));
    if (valid.length === 0) return row;

    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const std = Math.sqrt(valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (valid.length - 1)) || 1; // avoid div 0

    return row.map(v => isNaN(v) ? 0 : (v - mean) / std);
  });
};

const interpolateColor = (value: number, min: number, max: number, palette: string[]): string => {
  // Normalize value to 0-1
  let t = (value - min) / (max - min);
  t = Math.max(0, Math.min(1, t)); // Clamp

  if (palette.length === 2) {
      // Simple linear interpolation
      return lerpColor(palette[0], palette[1], t);
  } else if (palette.length === 3) {
      // Diverging: 0 -> 0.5 -> 1
      if (t < 0.5) return lerpColor(palette[0], palette[1], t * 2);
      return lerpColor(palette[1], palette[2], (t - 0.5) * 2);
  } else {
      // Multi-stop (e.g. Viridis 5 steps)
      // Map t to segment index
      const segments = palette.length - 1;
      const idx = Math.floor(t * segments);
      const subT = (t * segments) - idx;
      const safeIdx = Math.min(idx, segments - 1);
      return lerpColor(palette[safeIdx], palette[safeIdx + 1], subT);
  }
};

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};

const componentToHex = (c: number) => {
  const hex = Math.round(c).toString(16);
  return hex.length === 1 ? "0" + hex : hex;
};

const rgbToHex = (r: number, g: number, b: number) => {
  return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

const lerpColor = (c1: string, c2: string, t: number) => {
  const rgb1 = hexToRgb(c1);
  const rgb2 = hexToRgb(c2);
  const r = rgb1.r + (rgb2.r - rgb1.r) * t;
  const g = rgb1.g + (rgb2.g - rgb1.g) * t;
  const b = rgb1.b + (rgb2.b - rgb1.b) * t;
  return rgbToHex(r, g, b);
};

// --- Component ---

export const HeatmapTool: React.FC = () => {
  // Data State
  const [inputText, setInputText] = useState(DEFAULT_DATA);
  const [data, setData] = useState<HeatmapData | null>(parseInput(DEFAULT_DATA));
  
  // Settings
  const [useZScore, setUseZScore] = useState(true);
  const [paletteKey, setPaletteKey] = useState<ColorPalette>('rwb');
  
  // Scale Settings
  const [customMin, setCustomMin] = useState<number | ''>('');
  const [customMax, setCustomMax] = useState<number | ''>('');
  
  // Visual Settings
  const [cellWidth, setCellWidth] = useState(30);
  const [cellHeight, setCellHeight] = useState(20);
  const [fontSize, setFontSize] = useState(12);
  const [labelAngle, setLabelAngle] = useState(-45);
  const [showValues, setShowValues] = useState(false);
  const [gap, setGap] = useState(1);

  const svgRef = useRef<SVGSVGElement>(null);

  // Parse input on change
  useEffect(() => {
      const parsed = parseInput(inputText);
      setData(parsed);
  }, [inputText]);

  // Process Matrix (Normalization)
  const processedMatrix = useMemo(() => {
      if (!data) return [];
      if (useZScore) {
          return calculateZScore(data.matrix);
      }
      return data.matrix;
  }, [data, useZScore]);

  // Handle Z-Score Toggle (Reset custom ranges as they likely don't apply anymore)
  const handleZScoreChange = (checked: boolean) => {
      setUseZScore(checked);
      setCustomMin('');
      setCustomMax('');
  };

  // Determine Range for Color Scale
  const autoRange = useMemo(() => {
      if (processedMatrix.length === 0) return { min: 0, max: 0 };
      let min = Infinity;
      let max = -Infinity;
      processedMatrix.forEach(row => {
          row.forEach(v => {
              if (!isNaN(v)) {
                  if (v < min) min = v;
                  if (v > max) max = v;
              }
          });
      });
      
      // If Z-Score, symmetric range is usually better for diverging palettes
      if (useZScore) {
          const absMax = Math.max(Math.abs(min), Math.abs(max));
          // Cap at 2.5 or 3 for standard deviation to avoid washout
          const cap = Math.min(absMax, 3); 
          return { min: -cap, max: cap };
      }
      
      return { min, max };
  }, [processedMatrix, useZScore]);

  // Effective Range (User override or Auto)
  const range = useMemo(() => ({
      min: customMin !== '' ? Number(customMin) : autoRange.min,
      max: customMax !== '' ? Number(customMax) : autoRange.max
  }), [autoRange, customMin, customMax]);

  // Handle Export
  const handleExportSvg = () => {
      if (!svgRef.current) return;
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(svgRef.current);
      
      // Namespace injection
      if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
          source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      source = '<?xml version="1.0" standalone="no"?>\r\n' + source;

      const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Heatmap_${useZScore ? 'ZScore' : 'Raw'}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  // Render Constants
  const margin = { top: 100, left: 100, right: 50, bottom: 50 }; // Space for labels
  const legendHeight = 20;
  
  // Calculate SVG Dimensions
  const totalW = data ? data.cols.length * (cellWidth + gap) : 0;
  const totalH = data ? data.rows.length * (cellHeight + gap) : 0;
  const svgWidth = totalW + margin.left + margin.right;
  const svgHeight = totalH + margin.top + margin.bottom + legendHeight + 20;

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-rose-100 p-3 rounded-2xl text-rose-600">
                <Grid size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">热图绘制 (Heatmap)</h2>
               <p className="text-slate-500">生成用于发表的科研热图，支持 Z-Score 归一化与矢量导出</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px] items-start">
           
           {/* LEFT: Settings & Data */}
           <div className="lg:col-span-4 flex flex-col gap-4">
               {/* 1. Data Input */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                   <div className="flex justify-between items-center mb-2">
                       <h3 className="font-bold text-slate-700 flex items-center gap-2"><Upload size={16}/> 数据输入</h3>
                       <span className="text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded">支持 Excel 粘贴</span>
                   </div>
                   <textarea 
                       value={inputText}
                       onChange={(e) => setInputText(e.target.value)}
                       className="w-full h-48 p-2 text-xs font-mono border border-slate-200 rounded-lg outline-none focus:border-rose-500 resize-none whitespace-pre"
                       placeholder={`Gene\tSample1\tSample2\nGeneA\t10\t20...`}
                   />
               </div>

               {/* 2. Visual Settings */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-4">
                   <h3 className="font-bold text-slate-700 flex items-center gap-2"><Sliders size={16}/> 绘图参数</h3>
                   
                   {/* Normalization */}
                   <div className="flex items-center justify-between">
                       <span className="text-sm text-slate-600">标准化 (Row Z-Score)</span>
                       <label className="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" checked={useZScore} onChange={e => handleZScoreChange(e.target.checked)} className="sr-only peer" />
                           <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
                       </label>
                   </div>

                   {/* Palette */}
                   <div>
                       <label className="block text-xs font-bold text-slate-500 mb-2">配色方案</label>
                       <div className="grid grid-cols-4 gap-2">
                           {Object.entries(PALETTES).map(([key, p]) => (
                               <button 
                                   key={key}
                                   onClick={() => setPaletteKey(key as ColorPalette)}
                                   className={`h-6 rounded border transition-all ${paletteKey === key ? 'ring-2 ring-rose-500 border-transparent' : 'border-slate-200 hover:border-slate-300'}`}
                                   title={p.name}
                                   style={{ background: `linear-gradient(to right, ${p.colors.join(', ')})` }}
                               />
                           ))}
                       </div>
                   </div>

                   {/* Scale Range */}
                   <div>
                       <label className="block text-xs font-bold text-slate-500 mb-2">标尺范围 (Scale Range)</label>
                       <div className="grid grid-cols-2 gap-3">
                           <div>
                               <label className="block text-[10px] text-slate-400 mb-1">Min (Auto: {autoRange.min.toFixed(1)})</label>
                               <input 
                                   type="number" 
                                   value={customMin} 
                                   onChange={e => setCustomMin(e.target.value === '' ? '' : Number(e.target.value))} 
                                   placeholder={autoRange.min.toFixed(2)}
                                   className="w-full text-sm border border-slate-300 rounded px-2 py-1 focus:border-rose-500 outline-none" 
                               />
                           </div>
                           <div>
                               <label className="block text-[10px] text-slate-400 mb-1">Max (Auto: {autoRange.max.toFixed(1)})</label>
                               <input 
                                   type="number" 
                                   value={customMax} 
                                   onChange={e => setCustomMax(e.target.value === '' ? '' : Number(e.target.value))} 
                                   placeholder={autoRange.max.toFixed(2)} 
                                   className="w-full text-sm border border-slate-300 rounded px-2 py-1 focus:border-rose-500 outline-none" 
                               />
                           </div>
                       </div>
                   </div>

                   {/* Dimensions */}
                   <div className="grid grid-cols-2 gap-3">
                       <div>
                           <label className="block text-xs text-slate-500 mb-1">单元格宽</label>
                           <input type="number" value={cellWidth} onChange={e => setCellWidth(Number(e.target.value))} className="w-full text-sm border rounded px-2 py-1" />
                       </div>
                       <div>
                           <label className="block text-xs text-slate-500 mb-1">单元格高</label>
                           <input type="number" value={cellHeight} onChange={e => setCellHeight(Number(e.target.value))} className="w-full text-sm border rounded px-2 py-1" />
                       </div>
                       <div>
                           <label className="block text-xs text-slate-500 mb-1">字体大小</label>
                           <input type="number" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-full text-sm border rounded px-2 py-1" />
                       </div>
                       <div>
                           <label className="block text-xs text-slate-500 mb-1">间隙 (Gap)</label>
                           <input type="number" value={gap} onChange={e => setGap(Number(e.target.value))} className="w-full text-sm border rounded px-2 py-1" />
                       </div>
                   </div>

                   <div className="flex items-center gap-2">
                       <span className="text-xs text-slate-500">显示数值</span>
                       <input type="checkbox" checked={showValues} onChange={e => setShowValues(e.target.checked)} className="rounded text-rose-500 focus:ring-rose-500" />
                   </div>
                   
                   <button onClick={handleExportSvg} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-slate-900 transition-colors">
                       <Download size={16} /> 导出 SVG
                   </button>
               </div>
           </div>

           {/* RIGHT: Preview */}
           <div className="lg:col-span-8">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 overflow-auto relative min-h-[600px] flex items-center justify-center">
                   {data ? (
                       <svg 
                           ref={svgRef}
                           width={svgWidth} 
                           height={svgHeight} 
                           viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                           className="drop-shadow-sm bg-white"
                           xmlns="http://www.w3.org/2000/svg"
                       >
                           {/* Styles for SVG export compatibility */}
                           <style>{`
                               text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
                           `}</style>
                           
                           {/* Background (White) */}
                           <rect width={svgWidth} height={svgHeight} fill="white" />

                           {/* Main Group */}
                           <g transform={`translate(${margin.left}, ${margin.top})`}>
                               
                               {/* Column Labels (Top) */}
                               {data.cols.map((col, i) => (
                                   <text 
                                       key={`col-${i}`}
                                       x={(i * (cellWidth + gap)) + cellWidth / 2}
                                       y={-10}
                                       textAnchor="start"
                                       transform={`rotate(${labelAngle}, ${(i * (cellWidth + gap)) + cellWidth / 2}, -10)`}
                                       fontSize={fontSize}
                                       fill="#374151"
                                       fontWeight="bold"
                                   >
                                       {col}
                                   </text>
                               ))}

                               {/* Rows & Cells */}
                               {processedMatrix.map((row, rIdx) => (
                                   <g key={`row-${rIdx}`} transform={`translate(0, ${rIdx * (cellHeight + gap)})`}>
                                       {/* Row Label (Left) */}
                                       <text 
                                           x={-10} 
                                           y={cellHeight / 2 + (fontSize * 0.35)} 
                                           textAnchor="end" 
                                           fontSize={fontSize}
                                           fill="#374151"
                                           fontWeight="bold"
                                       >
                                           {data.rows[rIdx]}
                                       </text>

                                       {/* Cells */}
                                       {row.map((val, cIdx) => {
                                           const color = isNaN(val) ? '#e5e7eb' : interpolateColor(val, range.min, range.max, PALETTES[paletteKey].colors);
                                           return (
                                               <g key={`cell-${cIdx}`}>
                                                   <rect
                                                       x={cIdx * (cellWidth + gap)}
                                                       y={0}
                                                       width={cellWidth}
                                                       height={cellHeight}
                                                       fill={color}
                                                       shapeRendering="crispEdges" // Sharp edges for heatmap
                                                   >
                                                       <title>{`${data.rows[rIdx]} - ${data.cols[cIdx]}: ${val.toFixed(2)}`}</title>
                                                   </rect>
                                                   {showValues && !isNaN(val) && (
                                                       <text
                                                           x={cIdx * (cellWidth + gap) + cellWidth / 2}
                                                           y={cellHeight / 2 + (fontSize * 0.35)}
                                                           textAnchor="middle"
                                                           fontSize={Math.min(fontSize, cellHeight * 0.8)}
                                                           fill={Math.abs(val) > (range.max/2) ? 'white' : 'black'} // simple contrast
                                                           pointerEvents="none"
                                                       >
                                                           {val.toFixed(1)}
                                                       </text>
                                                   )}
                                               </g>
                                           );
                                       })}
                                   </g>
                               ))}
                           </g>

                           {/* Legend (Bottom) */}
                           <g transform={`translate(${margin.left}, ${totalH + margin.top + 30})`}>
                               <defs>
                                   <linearGradient id="legendGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                       {PALETTES[paletteKey].colors.map((c, i) => (
                                           <stop key={i} offset={`${(i / (PALETTES[paletteKey].colors.length - 1)) * 100}%`} stopColor={c} />
                                       ))}
                                   </linearGradient>
                               </defs>
                               <rect x={0} y={0} width={150} height={12} fill="url(#legendGrad)" stroke="#e5e7eb" strokeWidth="1" />
                               <text x={0} y={24} fontSize="10" textAnchor="start" fill="#6b7280">{range.min.toFixed(1)}</text>
                               <text x={75} y={24} fontSize="10" textAnchor="middle" fill="#6b7280">{((range.min + range.max)/2).toFixed(1)}</text>
                               <text x={150} y={24} fontSize="10" textAnchor="end" fill="#6b7280">{range.max.toFixed(1)}</text>
                               <text x={160} y={10} fontSize="10" fill="#374151" fontWeight="bold">
                                   {useZScore ? 'Z-Score' : 'Value'}
                               </text>
                           </g>
                       </svg>
                   ) : (
                       <div className="text-slate-400 flex flex-col items-center">
                           <RefreshCw size={40} className="mb-2 animate-spin-slow opacity-20" />
                           <p>解析数据中...</p>
                       </div>
                   )}
                   
                   <div className="absolute top-4 right-4 bg-white/80 p-2 rounded backdrop-blur text-xs text-slate-500 border border-slate-100 shadow-sm max-w-xs">
                       <div className="flex items-start gap-2">
                           <Info size={14} className="mt-0.5 shrink-0 text-rose-500" />
                           <p>SVG 是矢量格式，下载后可拖入 Adobe Illustrator、CorelDRAW 或 Inkscape 中无限放大并编辑每一个文字和色块。</p>
                       </div>
                   </div>
               </div>
           </div>

       </div>
    </div>
  );
};
