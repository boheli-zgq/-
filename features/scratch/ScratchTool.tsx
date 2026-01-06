import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Ruler, Upload, Plus, Trash2, Sliders, Play, RefreshCw, Eye, Download, Info, BarChart3, Image as ImageIcon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { processImageFile } from '../../services/imageUtils';

// --- Types ---

interface ScratchImage {
  id: string;
  name: string;
  group: string;
  timepoint: string; // e.g., "0h", "24h"
  src: string;
  woundAreaPct: number | null; // % of total area that is wound
  woundMask: ImageData | null; // For display
  processed: boolean;
  width: number;
  height: number;
}

interface ProcessSettings {
  textureThreshold: number; // Sensitivity to cell texture
  fillHoles: number; // Morphological closing size
  intensityThreshold: number; // Optional: basic brightness filter
}

// --- Algorithm: Scratch Detection via Texture ---

const processScratchImage = (
  img: HTMLImageElement,
  settings: ProcessSettings
): { woundAreaPct: number; mask: ImageData } => {
  // Use a smaller processing canvas for performance and noise reduction
  const procW = Math.min(img.width, 800);
  const scale = procW / img.width;
  const procH = Math.floor(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = procW;
  canvas.height = procH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Canvas context failed");

  ctx.drawImage(img, 0, 0, procW, procH);
  const inputData = ctx.getImageData(0, 0, procW, procH);
  const src = inputData.data;
  
  const width = procW;
  const height = procH;
  
  // Output mask (Yellow overlay for wound)
  const outputData = ctx.createImageData(width, height);
  const dst = outputData.data;

  // 1. Calculate Local Texture/Contrast
  // We assume cells have high local variation, wound is smooth.
  const textureMap = new Float32Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      // Convert to gray
      const gray = 0.299 * src[idx] + 0.587 * src[idx+1] + 0.114 * src[idx+2];
      
      // Compute simple edge score (sum of diffs with neighbors)
      let diffSum = 0;
      // Check 4 neighbors
      const neighbors = [
          ((y-1)*width + x)*4,
          ((y+1)*width + x)*4,
          (y*width + x-1)*4,
          (y*width + x+1)*4
      ];
      
      for(const nIdx of neighbors) {
          const nGray = 0.299 * src[nIdx] + 0.587 * src[nIdx+1] + 0.114 * src[nIdx+2];
          diffSum += Math.abs(gray - nGray);
      }
      
      textureMap[y * width + x] = diffSum;
    }
  }

  // 2. Thresholding & Density Smoothing
  // Cells areas are "busy", so textureMap > threshold.
  // Wound areas are "quiet", so textureMap < threshold.
  // However, pixel-by-pixel is noisy. We calculate density in a window.
  
  const windowSize = settings.fillHoles; // e.g., 5 to 20
  const threshold = settings.textureThreshold; // e.g., 10 to 50
  
  let woundPixels = 0;

  for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
          const i = (y * width + x);
          
          // Check neighborhood average texture
          let localTextureSum = 0;
          let count = 0;
          
          const startX = Math.max(0, x - windowSize);
          const endX = Math.min(width, x + windowSize);
          const startY = Math.max(0, y - windowSize);
          const endY = Math.min(height, y + windowSize);

          // Sampling for speed (skip pixels)
          for(let wy = startY; wy < endY; wy+=2) {
              for(let wx = startX; wx < endX; wx+=2) {
                  localTextureSum += textureMap[wy * width + wx];
                  count++;
              }
          }
          
          const avgTexture = count > 0 ? localTextureSum / count : 0;
          
          // IF average texture is LOW, it is WOUND.
          const isWound = avgTexture < threshold;
          
          if (isWound) {
              // Fill output mask (Yellow with transparency)
              // We fill a 2x2 block because of the outer loop stride
              const idxs = [
                  (y * width + x) * 4,
                  (y * width + Math.min(x+1, width-1)) * 4,
                  (Math.min(y+1, height-1) * width + x) * 4,
                  (Math.min(y+1, height-1) * width + Math.min(x+1, width-1)) * 4
              ];

              idxs.forEach(pidx => {
                  dst[pidx] = 255;   // R
                  dst[pidx+1] = 235; // G (Gold/Yellow)
                  dst[pidx+2] = 59;  // B
                  dst[pidx+3] = 120; // A (Semi-transparent)
              });
              
              woundPixels += 4;
          }
      }
  }
  
  const totalPixels = width * height;
  const woundPct = Math.min(100, Math.max(0, (woundPixels / totalPixels) * 100));

  return { woundAreaPct: woundPct, mask: outputData };
};


export const ScratchTool: React.FC = () => {
  const [images, setImages] = useState<ScratchImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Settings
  const [settings, setSettings] = useState<ProcessSettings>({
    textureThreshold: 15, // Lower = Detect only very smooth areas as wound. Higher = Detect slightly messy areas as wound.
    fillHoles: 4, // Smoothing radius. Higher = coarser blocks.
    intensityThreshold: 0
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Handlers ---

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);

    const newImages: ScratchImage[] = [];
    for (let i = 0; i < files.length; i++) {
        // Use shared image utils
        const src = await processImageFile(files[i]);
        if (src) {
            newImages.push({
              id: Date.now() + i + Math.random().toString(),
              name: files[i].name,
              group: 'Group 1',
              timepoint: '0h',
              src: src,
              woundAreaPct: null,
              woundMask: null,
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

  const updateImageMeta = (id: string, field: 'group' | 'timepoint', value: string) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, [field]: value } : img));
  };

  // --- Analysis ---

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
            const result = processScratchImage(img, settings);
            setImages(prev => prev.map(item => 
              item.id === activeImageId 
                ? { 
                    ...item, 
                    woundAreaPct: result.woundAreaPct, 
                    woundMask: result.mask, 
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
            const result = processScratchImage(img, settings);
            setImages(prev => prev.map(item => 
                item.id === imgData.id 
                ? { ...item, woundAreaPct: result.woundAreaPct, woundMask: result.mask, processed: true, width: img.width, height: img.height } 
                : item
            ));
            setTimeout(() => processNext(index + 1), 10);
        };
    };
    processNext(0);
  };

  // --- Drawing ---

  useEffect(() => {
    if (!activeImageId || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const imgData = images.find(i => i.id === activeImageId);

    if (!ctx || !imgData) return;

    const img = new Image();
    img.src = imgData.src;
    img.onload = () => {
        // Set canvas to display size (responsive) or image size?
        // Let's set it to the MASK size (which is scaled down usually to 800px width)
        // to ensure the overlay matches perfectly.
        const w = imgData.woundMask ? imgData.woundMask.width : img.width;
        const h = imgData.woundMask ? imgData.woundMask.height : img.height;
        
        canvas.width = w;
        canvas.height = h;
        
        // Draw original image scaled to canvas
        ctx.drawImage(img, 0, 0, w, h);

        // Draw Mask Overlay
        if (imgData.processed && imgData.woundMask) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imgData.woundMask.width;
            tempCanvas.height = imgData.woundMask.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx?.putImageData(imgData.woundMask, 0, 0);
            
            ctx.drawImage(tempCanvas, 0, 0, w, h);
        }
    };
  }, [activeImageId, images]); // Redraw on update

  // --- Stats ---

  const chartData = useMemo(() => {
      // Group by "Group" and "Timepoint"
      // Structure: { name: 'Group1', '0h': 50, '24h': 10 }
      const groups: Record<string, any> = {};
      
      images.forEach(img => {
          if (img.woundAreaPct === null) return;
          if (!groups[img.group]) groups[img.group] = { name: img.group };
          
          // Average if multiple images for same timepoint/group
          const key = img.timepoint;
          if (!groups[img.group][key]) {
             groups[img.group][key] = { sum: 0, count: 0 };
          }
          groups[img.group][key].sum += img.woundAreaPct;
          groups[img.group][key].count += 1;
      });

      return Object.values(groups).map((g: any) => {
          const res: any = { name: g.name };
          Object.keys(g).forEach(k => {
              if (k !== 'name') {
                  res[k] = parseFloat((g[k].sum / g[k].count).toFixed(2));
              }
          });
          return res;
      });
  }, [images]);

  // Extract unique timepoints for chart keys
  const timepoints = useMemo(() => Array.from(new Set(images.map(i => i.timepoint))).sort(), [images]);
  const colors = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981'];

  const handleExportCsv = () => {
    let csv = "\uFEFFGroup,Timepoint,Image Name,Wound Area (%)\n";
    images.forEach(img => {
        csv += `"${img.group}","${img.timepoint}","${img.name}",${img.woundAreaPct?.toFixed(2) || ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Scratch_Assay_Results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-cyan-100 p-3 rounded-2xl text-cyan-600">
                <Ruler size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">细胞划痕愈合分析</h2>
               <p className="text-slate-500">基于纹理识别算法，自动计算划痕面积与愈合率</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px]">
           
           {/* LEFT: Controls (3 cols) */}
           <div className="lg:col-span-3 flex flex-col gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                    <input type="file" accept="image/jpeg,image/png,image/tiff,.tif,.tiff,.jpg,.jpeg,.png" onChange={handleUpload} multiple id="scratch-upload" className="hidden" />
                    <label htmlFor="scratch-upload" className="w-full bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-dashed border-cyan-200 rounded-lg py-3 flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors">
                        <Upload size={18} /> 上传图片
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
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${activeImageId === img.id ? 'bg-cyan-50 border-cyan-400 ring-1 ring-cyan-400' : 'bg-white border-slate-200 hover:border-cyan-200'}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-12 h-12 bg-slate-200 rounded overflow-hidden shrink-0 relative">
                                        <img src={img.src} className="w-full h-full object-cover" />
                                        {img.processed && <div className="absolute inset-0 bg-cyan-500/20" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-slate-700 truncate mb-1">{img.name}</div>
                                        <div className="flex gap-1 mb-1">
                                            <input 
                                                value={img.group}
                                                onClick={e => e.stopPropagation()}
                                                onChange={e => updateImageMeta(img.id, 'group', e.target.value)}
                                                className="w-1/2 text-[10px] px-1 border rounded bg-slate-50"
                                                placeholder="Group"
                                            />
                                            <input 
                                                value={img.timepoint}
                                                onClick={e => e.stopPropagation()}
                                                onChange={e => updateImageMeta(img.id, 'timepoint', e.target.value)}
                                                className="w-1/2 text-[10px] px-1 border rounded bg-slate-50"
                                                placeholder="Time (0h)"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className={`text-[10px] font-bold ${img.woundAreaPct !== null ? 'text-cyan-600' : 'text-slate-400'}`}>
                                                {img.woundAreaPct !== null ? `Area: ${img.woundAreaPct.toFixed(1)}%` : 'Pending'}
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
                            <button onClick={analyzeAll} disabled={isProcessing} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:bg-slate-300">
                                {isProcessing ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />} 批量分析
                            </button>
                        </div>
                    )}
                </div>
           </div>

           {/* CENTER: Preview & Settings (6 cols) */}
           <div className="lg:col-span-6 flex flex-col gap-4">
               {/* Settings Bar */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 flex items-center gap-4 flex-wrap">
                   <div className="flex items-center gap-2 text-sm text-slate-600">
                       <Sliders size={16} /> 识别阈值:
                   </div>
                   <div className="flex items-center gap-2" title="Lower = Only very smooth areas are wound. Higher = Includes more areas.">
                       <span className="text-xs text-slate-500">纹理灵敏度</span>
                       <input 
                            type="range" min="1" max="50" 
                            value={settings.textureThreshold} 
                            onChange={(e) => setSettings(s => ({ ...s, textureThreshold: parseInt(e.target.value) }))}
                            className="w-24 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                       />
                       <span className="text-xs font-mono w-6 text-right">{settings.textureThreshold}</span>
                   </div>
                   <div className="w-px h-4 bg-slate-300 mx-2"></div>
                   <div className="flex items-center gap-2" title="Smoothing radius">
                       <span className="text-xs text-slate-500">平滑度</span>
                       <input 
                            type="range" min="1" max="10" 
                            value={settings.fillHoles} 
                            onChange={(e) => setSettings(s => ({ ...s, fillHoles: parseInt(e.target.value) }))}
                            className="w-20 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                       />
                   </div>
                   <button onClick={analyzeActiveImage} disabled={!activeImageId || isProcessing} className="ml-auto bg-cyan-100 text-cyan-700 hover:bg-cyan-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                       重新识别
                   </button>
               </div>

               {/* Canvas View */}
               <div className="bg-slate-900 rounded-xl flex-1 overflow-hidden relative flex items-center justify-center border border-slate-800 h-[500px]" ref={containerRef}>
                   {!activeImageId ? (
                       <div className="text-slate-500 flex flex-col items-center">
                           <Eye size={48} className="mb-2 opacity-50" />
                           <p>选择一张图片进行预览</p>
                       </div>
                   ) : (
                       <>
                           <div className="absolute top-4 left-4 z-10 bg-black/60 text-white text-xs px-2 py-1 rounded backdrop-blur-sm pointer-events-none">
                               {images.find(i => i.id === activeImageId)?.name}
                           </div>
                           <canvas ref={canvasRef} className="max-w-full max-h-full object-contain" />
                       </>
                   )}
                   {isProcessing && (
                       <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-20">
                           <div className="text-white font-medium flex items-center gap-2">
                               <RefreshCw className="animate-spin" /> 处理中...
                           </div>
                       </div>
                   )}
               </div>
               
               <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-lg flex gap-2 items-start border border-blue-100">
                     <Info size={14} className="mt-0.5 shrink-0" />
                     <p>黄色区域代表识别到的“划痕”（无细胞区域）。若识别区域过大（覆盖了细胞），请调低“纹理灵敏度”；若识别不全，请调高灵敏度。</p>
               </div>
           </div>

           {/* RIGHT: Stats (3 cols) */}
           <div className="lg:col-span-3 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <BarChart3 size={18} /> 愈合趋势
                   </h3>
                   
                   {chartData.length > 0 ? (
                       <>
                           <div className="h-[250px] w-full shrink-0 mb-4">
                               <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} label={{ value: 'Wound Area %', angle: -90, position: 'insideLeft', style: {fontSize: 10, fill: '#94a3b8'} }} />
                                        <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                                        {timepoints.map((tp, idx) => (
                                            <Bar key={tp} dataKey={tp} fill={colors[idx % colors.length]} name={tp} radius={[4, 4, 0, 0]} />
                                        ))}
                                    </BarChart>
                               </ResponsiveContainer>
                           </div>
                           
                           <div className="flex-1 overflow-y-auto border-t border-slate-100 pt-2">
                               <table className="w-full text-xs text-left">
                                   <thead className="text-slate-500">
                                       <tr>
                                           <th className="py-2">Group</th>
                                           {timepoints.map(t => <th key={t} className="py-2 text-right">{t}</th>)}
                                       </tr>
                                   </thead>
                                   <tbody className="divide-y divide-slate-100">
                                       {chartData.map((d: any) => (
                                           <tr key={d.name}>
                                               <td className="py-2 font-medium text-slate-700">{d.name}</td>
                                               {timepoints.map(t => (
                                                   <td key={t} className="py-2 text-right text-cyan-600 font-mono">
                                                       {d[t] !== undefined ? `${d[t]}%` : '-'}
                                                   </td>
                                               ))}
                                           </tr>
                                       ))}
                                   </tbody>
                               </table>
                           </div>
                           
                           <button onClick={handleExportCsv} className="w-full mt-4 bg-slate-800 hover:bg-slate-900 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                               <Download size={14} /> 导出结果
                           </button>
                       </>
                   ) : (
                       <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-sm">
                           <BarChart3 size={40} className="mb-2 opacity-20" />
                           <p>暂无数据</p>
                       </div>
                   )}
               </div>
           </div>
       </div>
    </div>
  );
};