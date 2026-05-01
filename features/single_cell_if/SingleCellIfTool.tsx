import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Aperture, Upload, Trash2, Sliders, Play, RefreshCw, Eye, Download, Info, BarChart3, Layers } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, ZAxis, Cell } from 'recharts';
import { processImageFile } from '../../services/imageUtils';

// --- Types ---

interface SingleCellData {
  id: number;
  area: number;
  mfi: number;
}

interface IFImage {
  id: string;
  name: string;
  group: string;
  src: string;
  
  // Analysis Results
  cells: SingleCellData[];
  avgMfi: number | null;
  cellCount: number | null;
  
  // Visualization
  maskDataUrl: string | null;
  
  processed: boolean;
  width: number;
  height: number;
}

interface AnalysisSettings {
  nucleiChannel: 'red' | 'green' | 'blue' | 'gray';
  nucleiThreshold: number; // 0-255
  minNucleusArea: number; // to filter debris
  targetChannel: 'red' | 'green' | 'blue' | 'gray';
  cellRadius: number; // pixels to dilate
}

// --- Image Processing Logic ---

const getChannelValue = (data: Uint8ClampedArray, index: number, channel: string) => {
    switch (channel) {
        case 'red': return data[index];
        case 'green': return data[index + 1];
        case 'blue': return data[index + 2];
        case 'gray': return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
        default: return 0;
    }
};

const generateRainbowColor = (id: number) => {
    const hue = (id * 137.508) % 360; // Use golden ratio to distribute colors
    return `hsla(${hue}, 80%, 50%, 0.3)`;
};

const analyzeSingleCells = (
  img: HTMLImageElement,
  settings: AnalysisSettings
): { cells: SingleCellData[]; avgMfi: number; cellCount: number; maskDataUrl: string } => {
  const canvas = document.createElement('canvas');
  const width = img.width;
  const height = img.height;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Canvas context failed");

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const nucleiMask = new Uint8Array(width * height);
  
  // 1. Threshold
  for (let i = 0; i < width * height; i++) {
    const val = getChannelValue(data, i * 4, settings.nucleiChannel);
    nucleiMask[i] = val >= settings.nucleiThreshold ? 1 : 0;
  }

  // 2. Connected Components Labeling (CCL)
  const labels = new Int32Array(width * height);
  let currentLabel = 0;
  const areas: number[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (nucleiMask[idx] === 1 && labels[idx] === 0) {
        currentLabel++;
        let area = 0;
        const queue: number[] = [idx];
        labels[idx] = currentLabel;
        
        let qIdx = 0;
        while(qIdx < queue.length) {
          const curr = queue[qIdx++];
          area++;
          const cx = curr % width;
          const cy = Math.floor(curr / width);
          
          const neighbors = [
            [cx-1, cy], [cx+1, cy], [cx, cy-1], [cx, cy+1]
          ];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = ny * width + nx;
              if (nucleiMask[nIdx] === 1 && labels[nIdx] === 0) {
                labels[nIdx] = currentLabel;
                queue.push(nIdx);
              }
            }
          }
        }
        areas[currentLabel] = area;
      }
    }
  }

  // Filter by min area
  const MIN_AREA = settings.minNucleusArea;
  const validLabels = new Map<number, number>();
  let validLabelCount = 0;
  for(let i=1; i<=currentLabel; i++) {
     if(areas[i] >= MIN_AREA) {
       validLabelCount++;
       validLabels.set(i, validLabelCount);
     }
  }

  const cellLabels = new Int32Array(width * height);
  const dQueue: number[] = [];
  const dist = new Int32Array(width * height).fill(-1);

  for(let i=0; i<width*height; i++) {
    const L = labels[i];
    if(L > 0 && validLabels.has(L)) {
      const newL = validLabels.get(L)!;
      cellLabels[i] = newL;
      dist[i] = 0;
      dQueue.push(i);
    }
  }

  // 3. Dilate nuclei up to setting.cellRadius
  let qIdx = 0;
  while(qIdx < dQueue.length) {
    const curr = dQueue[qIdx++];
    const d = dist[curr];
    if (d >= settings.cellRadius) continue;
    
    const cx = curr % width;
    const cy = Math.floor(curr / width);
    const L = cellLabels[curr];
    
    const neighbors = [
      [cx-1, cy], [cx+1, cy], [cx, cy-1], [cx, cy+1]
    ];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (dist[nIdx] === -1) {
          dist[nIdx] = d + 1;
          cellLabels[nIdx] = L;
          dQueue.push(nIdx);
        }
      }
    }
  }

  // 4. Calculate MFI of target channel
  const sums = new Float64Array(validLabelCount + 1);
  const counts = new Int32Array(validLabelCount + 1);

  for(let i=0; i<width*height; i++) {
    const L = cellLabels[i];
    if(L > 0) {
      const val = getChannelValue(data, i * 4, settings.targetChannel);
      sums[L] += val;
      counts[L]++;
    }
  }

  const cells: SingleCellData[] = [];
  let totalMfi = 0;
  for(let i=1; i<=validLabelCount; i++) {
    const mfi = sums[i] / counts[i];
    cells.push({
      id: i,
      area: counts[i],
      mfi: mfi
    });
    totalMfi += mfi;
  }
  const avgMfi = validLabelCount > 0 ? totalMfi / validLabelCount : 0;

  // 5. Generate transparent rainbow mask
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  
  if (outCtx) {
      const outImgData = outCtx.createImageData(width, height);
      for(let i=0; i<width*height; i++) {
          const L = cellLabels[i];
          if(L > 0) {
              // Hue based on L
              const hue = (L * 137.508) % 360;
              // converting hsl to rgb simplified for mask
              // We just use a quick approximation or just fix opacity
              // Easy way: write to imageData directly:
              // Actually, drawing colored pixels directly is tedious. Let's do it.
              const h = hue / 360;
              const s = 0.8;
              const l = 0.5;
              let r, g, b;
              const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
              const p = 2 * l - q;
              const hueToRgb = (p: number, q: number, t: number) => {
                  if(t < 0) t += 1;
                  if(t > 1) t -= 1;
                  if(t < 1/6) return p + (q - p) * 6 * t;
                  if(t < 1/2) return q;
                  if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                  return p;
              };
              r = hueToRgb(p, q, h + 1/3);
              g = hueToRgb(p, q, h);
              b = hueToRgb(p, q, h - 1/3);
              
              outImgData.data[i*4] = r * 255;
              outImgData.data[i*4+1] = g * 255;
              outImgData.data[i*4+2] = b * 255;
              outImgData.data[i*4+3] = 100; // opacity
          } else {
              outImgData.data[i*4+3] = 0;
          }
      }
      outCtx.putImageData(outImgData, 0, 0);
  }

  return { cells, avgMfi, cellCount: cells.length, maskDataUrl: outCanvas.toDataURL() };
};


export const SingleCellIfTool: React.FC = () => {
  const [images, setImages] = useState<IFImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [settings, setSettings] = useState<AnalysisSettings>({
    nucleiChannel: 'blue',
    nucleiThreshold: 50,
    minNucleusArea: 20,
    targetChannel: 'green',
    cellRadius: 15
  });

  const [maskOpacity, setMaskOpacity] = useState(0.5);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);

    const newImages: IFImage[] = [];
    for (let i = 0; i < files.length; i++) {
        const src = await processImageFile(files[i]);
        if (src) {
            newImages.push({
              id: Date.now() + i + Math.random().toString(),
              name: files[i].name,
              group: 'Group 1',
              src: src,
              cells: [],
              avgMfi: null,
              cellCount: null,
              maskDataUrl: null,
              processed: false,
              width: 0,
              height: 0
            });
        }
    }
    setImages(prev => [...prev, ...newImages]);
    if (!activeImageId && newImages.length > 0) setActiveImageId(newImages[0].id);
    setIsProcessing(false);
    e.target.value = '';
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (activeImageId === id) setActiveImageId(null);
  };

  const updateImageGroup = (id: string, group: string) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, group } : img));
  };

  const analyzeActiveImage = useCallback(() => {
    if (!activeImageId) return;
    const imgData = images.find(i => i.id === activeImageId);
    if (!imgData) return;

    setIsProcessing(true);
    setTimeout(() => {
      const img = new Image();
      img.src = imgData.src;
      img.onload = () => {
        try {
            const result = analyzeSingleCells(img, settings);
            setImages(prev => prev.map(item => 
              item.id === activeImageId 
                ? { 
                    ...item, 
                    cells: result.cells,
                    avgMfi: result.avgMfi,
                    cellCount: result.cellCount,
                    maskDataUrl: result.maskDataUrl,
                    processed: true,
                    width: img.width,
                    height: img.height 
                  } 
                : item
            ));
        } catch(e) {
            console.error(e);
        } finally {
            setIsProcessing(false);
        }
      };
    }, 50);
  }, [activeImageId, images, settings]);

  const analyzeAll = () => {
    setIsProcessing(true);
    const processNext = (index: number) => {
        if (index >= images.length) {
            setIsProcessing(false);
            return;
        }
        const imgData = images[index];
        const img = new Image();
        img.src = imgData.src;
        img.onload = () => {
            const result = analyzeSingleCells(img, settings);
            setImages(prev => prev.map(item => 
                item.id === imgData.id 
                ? { 
                    ...item, 
                    cells: result.cells,
                    avgMfi: result.avgMfi,
                    cellCount: result.cellCount,
                    maskDataUrl: result.maskDataUrl,
                    processed: true, 
                    width: img.width, 
                    height: img.height 
                  } 
                : item
            ));
            setTimeout(() => processNext(index + 1), 10);
        };
    };
    processNext(0);
  };

  useEffect(() => {
    if (!activeImageId || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const imgData = images.find(i => i.id === activeImageId);

    if (!ctx || !imgData) return;

    const img = new Image();
    img.src = imgData.src;
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        if (imgData.processed && imgData.maskDataUrl) {
           const maskImg = new Image();
           maskImg.src = imgData.maskDataUrl;
           maskImg.onload = () => {
               ctx.globalAlpha = maskOpacity;
               ctx.drawImage(maskImg, 0, 0);
               ctx.globalAlpha = 1.0;
           };
        }
    };
  }, [activeImageId, images, maskOpacity]);

  const handleExportCsv = () => {
    let csv = "\uFEFFGroup,Image Name,Cell ID,Cell Area (px),Cell Mean Intensity\n";
    images.forEach(img => {
        img.cells.forEach(cell => {
             csv += `"${img.group}","${img.name}",${cell.id},${cell.area},${cell.mfi.toFixed(2)}\n`;
        });
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "SingleCell_IF_Analysis.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Group stats for chart
  const groupStats = React.useMemo(() => {
     const groups: Record<string, { cells: number[], totalMfi: number, count: number }> = {};
     images.forEach(img => {
         if (!img.processed) return;
         if (!groups[img.group]) groups[img.group] = { cells: [], totalMfi: 0, count: 0 };
         img.cells.forEach(c => {
             groups[img.group].cells.push(c.mfi);
         });
     });
     
     return Object.keys(groups).map(g => {
         const cells = groups[g].cells;
         const n = cells.length;
         const mean = n > 0 ? cells.reduce((a,b)=>a+b, 0) / n : 0;
         const std = n > 1 ? Math.sqrt(cells.reduce((sq, val) => sq + Math.pow(val - mean, 2), 0) / (n - 1)) : 0;
         return {
             group: g,
             mean: parseFloat(mean.toFixed(2)),
             std: parseFloat(std.toFixed(2)),
             n
         }
     });
  }, [images]);

  // Scatter plot data for single cells
  const scatterData = React.useMemo(() => {
      const data: any[] = [];
      images.forEach(img => {
          if (!img.processed) return;
          img.cells.forEach(c => {
              data.push({
                  group: img.group,
                  mfi: c.mfi,
                  imageName: img.name
              });
          });
      });
      return data;
  }, [images]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-600">
                <Aperture size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">单细胞荧光强度分析 (Single-Cell IF)</h2>
               <p className="text-slate-500">基于核酸染色圈定细胞范围，量化单个细胞内的目标探针(如 Lysosensor)荧光强度。</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px]">
           <div className="lg:col-span-3 flex flex-col gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                    <input type="file" accept="image/jpeg,image/png,image/tiff,.tif,.tiff,.jpg,.jpeg,.png" onChange={handleUpload} multiple id="sc-upload" className="hidden" />
                    <label htmlFor="sc-upload" className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-dashed border-emerald-200 rounded-lg py-3 flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors">
                        <Upload size={18} /> 上传荧光图片
                    </label>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col h-[500px]">
                    <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <span className="font-bold text-slate-700 text-sm">图片列表 ({images.length})</span>
                        <button onClick={() => setImages([])} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {images.map(img => (
                            <div 
                                key={img.id} 
                                onClick={() => setActiveImageId(img.id)}
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${activeImageId === img.id ? 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-400' : 'bg-white border-slate-200 hover:border-emerald-200'}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-12 h-12 bg-slate-200 rounded overflow-hidden shrink-0 relative flex items-center justify-center text-[8px] text-slate-400">
                                        <img src={img.src} className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-slate-700 truncate mb-1">{img.name}</div>
                                        <input 
                                            value={img.group}
                                            onClick={e => e.stopPropagation()}
                                            onChange={e => updateImageGroup(img.id, e.target.value)}
                                            className="w-full text-[10px] px-1 border rounded bg-slate-50 mb-1 outline-emerald-500"
                                            placeholder="Group Name"
                                        />
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-emerald-600">
                                                {img.cellCount !== null ? `${img.cellCount} Cells` : 'Pending'}
                                            </span>
                                            <button onClick={(e) => { e.stopPropagation(); removeImage(img.id); }} className="text-slate-300 hover:text-red-400"><Trash2 size={12} /></button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    {images.length > 0 && (
                        <div className="p-3 border-t border-slate-100 bg-slate-50">
                            <button onClick={analyzeAll} disabled={isProcessing} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:bg-slate-300 transition-colors">
                                {isProcessing ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />} 批量分析
                            </button>
                        </div>
                    )}
                </div>
           </div>

           <div className="lg:col-span-6 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
                   <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
                       <div>
                           <div className="text-xs text-slate-500 mb-1">定位细胞通道 (如 DAPI)</div>
                           <select 
                                value={settings.nucleiChannel} 
                                onChange={(e) => setSettings(s => ({ ...s, nucleiChannel: e.target.value as any }))}
                                className="w-full text-xs border border-slate-300 rounded px-2 py-1 outline-none focus:border-emerald-500"
                           >
                               <option value="blue">Blue (Hoechst/DAPI)</option>
                               <option value="green">Green (FITC)</option>
                               <option value="red">Red (TRITC)</option>
                               <option value="gray">Grayscale</option>
                           </select>
                       </div>
                       
                       <div>
                           <div className="text-xs text-slate-500 mb-1 text-center">定位阈值 ({settings.nucleiThreshold})</div>
                           <input 
                                type="range" min="0" max="255" 
                                value={settings.nucleiThreshold} 
                                onChange={(e) => setSettings(s => ({ ...s, nucleiThreshold: parseInt(e.target.value) }))}
                                className="w-full h-2 mt-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                           />
                       </div>

                       <div>
                           <div className="text-xs text-slate-500 mb-1 text-center">最小核面积 ({settings.minNucleusArea})</div>
                           <input 
                                type="range" min="0" max="500" 
                                value={settings.minNucleusArea} 
                                onChange={(e) => setSettings(s => ({ ...s, minNucleusArea: parseInt(e.target.value) }))}
                                className="w-full h-2 mt-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
                           />
                       </div>

                       <div>
                           <div className="text-xs text-slate-500 mb-1">分析目标通道 (如 Lysosensor)</div>
                           <select 
                                value={settings.targetChannel} 
                                onChange={(e) => setSettings(s => ({ ...s, targetChannel: e.target.value as any }))}
                                className="w-full text-xs border border-slate-300 rounded px-2 py-1 outline-none focus:border-emerald-500"
                           >
                               <option value="green">Green (Lysosensor/FITC)</option>
                               <option value="red">Red (TRITC)</option>
                               <option value="blue">Blue (DAPI)</option>
                               <option value="gray">Grayscale</option>
                           </select>
                       </div>
                       
                       <div>
                           <div className="text-xs text-slate-500 mb-1 text-center">扩张半径 ({settings.cellRadius}px)</div>
                           <input 
                                type="range" min="0" max="50" 
                                value={settings.cellRadius} 
                                onChange={(e) => setSettings(s => ({ ...s, cellRadius: parseInt(e.target.value) }))}
                                className="w-full h-2 mt-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                           />
                       </div>
                   </div>
                   <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                       <div className="flex items-center gap-2">
                           <span className="text-xs text-slate-500">遮罩透明度:</span>
                           <input 
                                type="range" min="0" max="1" step="0.05"
                                value={maskOpacity} 
                                onChange={(e) => setMaskOpacity(parseFloat(e.target.value))}
                                className="w-24 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-600"
                           />
                       </div>
                       <button onClick={analyzeActiveImage} disabled={!activeImageId || isProcessing} className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors">
                           重新计算当前图片
                       </button>
                   </div>
               </div>

               <div className="bg-slate-900 rounded-xl flex-1 overflow-hidden relative flex items-center justify-center border border-slate-800 h-[450px]" ref={containerRef}>
                   {!activeImageId ? (
                       <div className="text-slate-500 flex flex-col items-center">
                           <Eye size={48} className="mb-2 opacity-50" />
                           <p>选择一张图片进行预览</p>
                       </div>
                   ) : (
                       <>
                           <div className="absolute top-4 left-4 z-10 bg-black/60 text-white text-xs px-2 py-1 rounded backdrop-blur-sm pointer-events-none border border-white/10">
                               {images.find(i => i.id === activeImageId)?.name}
                           </div>
                           <canvas ref={canvasRef} className="max-w-full max-h-full object-contain" />
                       </>
                   )}
                   {isProcessing && (
                       <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-20">
                           <div className="text-emerald-400 font-medium flex items-center gap-2 text-lg">
                               <RefreshCw className="animate-spin" /> 处理中...
                           </div>
                       </div>
                   )}
               </div>
               
               <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-xl flex gap-2 items-start border border-blue-100">
                     <Info size={14} className="mt-0.5 shrink-0" />
                     <div className="space-y-1">
                        <p><strong>怎么使用？</strong></p>
                        <p>1. <strong>定位细胞：</strong> 选择核染色通道 (如DAPI为蓝色)，调整阈值使系统能准确识别各个细胞核。</p>
                        <p>2. <strong>圈定范围：</strong> 调整扩展半径，系统会以细胞核为中心向外扩张，模拟出细胞质区域。</p>
                        <p>3. <strong>强度分析：</strong> 选择您关注探针的通道 (如Lysosensor通常为绿色)，系统会自动计算每个扩张区域内绿色的平均强度。</p>
                     </div>
               </div>
           </div>

           <div className="lg:col-span-3 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <BarChart3 size={18} /> 组间数据统计
                   </h3>
                   
                   <div className="flex-1 min-h-[250px] bg-slate-50 rounded-xl mb-4 p-2 relative">
                       {groupStats.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={groupStats} margin={{ top: 20, right: 10, left: -20, bottom: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                    <XAxis dataKey="group" tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                                    <YAxis tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                                    <Tooltip 
                                        contentStyle={{ borderRadius: '8px', fontSize: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        formatter={(value: any, name: string, props: any) => [
                                            `${value} ± ${props.payload.std}`, 'Average MFI'
                                        ]}
                                    />
                                    <Bar dataKey="mean" fill="#10b981" radius={[4, 4, 0, 0]} barSize={24}>
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                       ) : (
                           <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-xs">
                               <BarChart3 size={32} className="mb-2 opacity-20" />
                               数据准备中
                           </div>
                       )}
                   </div>

                   <button onClick={handleExportCsv} className="w-full mt-auto bg-slate-800 hover:bg-slate-900 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                       <Download size={14} /> 导出单细胞数据 CSV
                   </button>
               </div>
           </div>
       </div>
    </div>
  );
};
