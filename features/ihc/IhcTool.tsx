import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ScanFace, Upload, Trash2, Sliders, Play, RefreshCw, Eye, Download, Info, BarChart3, Layers, Palette } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { processImageFile } from '../../services/imageUtils';

// --- Types ---

interface IhcImage {
  id: string;
  name: string;
  group: string;
  src: string;
  
  // Results
  positiveAreaPct: number | null; // % Area
  meanDensity: number | null; // AOD
  hScore: number | null; // Area-based H-Score (0-300)
  
  // Counts for H-Score buckets (pixels)
  pixelsWeak: number;
  pixelsMod: number;
  pixelsStrong: number;
  pixelsNeg: number;
  
  // Visualization
  mask: ImageData | null; // Color coded mask
  dabChannel: ImageData | null; // Extracted DAB channel for review
  
  processed: boolean;
  width: number;
  height: number;
}

interface IhcSettings {
  threshold: number; // 0-255: Cutoff for DAB intensity to be considered positive
  weakThreshold: number; // Threshold for Weak vs Mod
  strongThreshold: number; // Threshold for Mod vs Strong
}

// --- Color Deconvolution Algorithm (H&E DAB) ---
// Vectors from Ruifrok and Johnston (2001)
// Hematoxylin: [0.650, 0.704, 0.286]
// DAB:         [0.268, 0.570, 0.776]
// Residual:    [0.711, 0.423, 0.561]

const analyzeIhcImage = (
  img: HTMLImageElement,
  settings: IhcSettings
): { 
    positiveAreaPct: number; 
    meanDensity: number; 
    hScore: number;
    pixelsWeak: number;
    pixelsMod: number;
    pixelsStrong: number;
    pixelsNeg: number;
    mask: ImageData;
    dabChannel: ImageData;
} => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Canvas context failed");

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data; // RGBA
  const len = data.length;

  // Output Buffers
  const maskData = ctx.createImageData(canvas.width, canvas.height);
  const mask = maskData.data;
  const dabData = ctx.createImageData(canvas.width, canvas.height);
  const dabImg = dabData.data;

  // Normalized OD vectors
  const MODx = [0.650, 0.704, 0.286]; // He
  const MODy = [0.268, 0.570, 0.776]; // DAB
  const MODz = [0.711, 0.423, 0.561]; // Res

  let totalTissuePixels = 0;
  let totalDabOD = 0;
  let pxWeak = 0, pxMod = 0, pxStrong = 0, pxNeg = 0;

  // Inverse elements for DAB (Row 2):
  // Determinant = 0.226
  const det = 0.226;
  const Q21 = (MODx[1]*MODz[2] - MODx[2]*MODz[1]) / det; 
  const Q22 = (MODx[2]*MODz[0] - MODx[0]*MODz[2]) / det;
  const Q23 = (MODx[0]*MODz[1] - MODx[1]*MODz[0]) / det;

  for (let i = 0; i < len; i += 4) {
      const R = data[i];
      const G = data[i+1];
      const B = data[i+2];
      
      // 1. Convert RGB to Optical Density (OD)
      const rOD = -Math.log((R + 1) / 255);
      const gOD = -Math.log((G + 1) / 255);
      const bOD = -Math.log((B + 1) / 255);

      // 2. Unmix
      const dabValOD = rOD * Q21 + gOD * Q22 + bOD * Q23;
      
      // Scale for intensity (0-255)
      const dabIntensity = Math.max(0, dabValOD * 200); 

      // Identify Tissue (Noise filter)
      if (rOD < 0.05 && gOD < 0.05 && bOD < 0.05) {
          mask[i+3] = 0;
          dabImg[i] = 255; dabImg[i+1] = 255; dabImg[i+2] = 255; dabImg[i+3] = 255; 
          continue;
      }

      totalTissuePixels++;

      // Visualization: DAB Channel (Grayscale, inverted so dark = high stain)
      const visVal = Math.max(0, Math.min(255, 255 - dabIntensity));
      dabImg[i] = visVal;
      dabImg[i+1] = visVal;
      dabImg[i+2] = visVal;
      dabImg[i+3] = 255;

      // Analysis & Mask Coloring
      if (dabIntensity < settings.threshold) {
          // Negative (Blue in mask - Nuclei only)
          pxNeg++;
          mask[i] = 0; mask[i+1] = 0; mask[i+2] = 255; mask[i+3] = 100; // Blue, semi-trans
      } else {
          // Positive
          totalDabOD += dabIntensity;
          
          if (dabIntensity < settings.weakThreshold) {
              // Weak (Yellow)
              pxWeak++;
              mask[i] = 255; mask[i+1] = 255; mask[i+2] = 0; mask[i+3] = 150;
          } else if (dabIntensity < settings.strongThreshold) {
              // Moderate (Orange)
              pxMod++;
              mask[i] = 255; mask[i+1] = 165; mask[i+2] = 0; mask[i+3] = 150;
          } else {
              // Strong (Red)
              pxStrong++;
              mask[i] = 255; mask[i+1] = 0; mask[i+2] = 0; mask[i+3] = 150;
          }
      }
  }

  const totalPos = pxWeak + pxMod + pxStrong;
  const positiveAreaPct = totalTissuePixels > 0 ? (totalPos / totalTissuePixels) * 100 : 0;
  const meanDensity = totalPos > 0 ? totalDabOD / totalPos : 0;
  
  // Area-based H-Score
  const pctWeak = (pxWeak / totalTissuePixels) * 100;
  const pctMod = (pxMod / totalTissuePixels) * 100;
  const pctStrong = (pxStrong / totalTissuePixels) * 100;
  const hScore = (1 * pctWeak) + (2 * pctMod) + (3 * pctStrong);

  return {
      positiveAreaPct,
      meanDensity,
      hScore,
      pixelsWeak: pxWeak,
      pixelsMod: pxMod,
      pixelsStrong: pxStrong,
      pixelsNeg: pxNeg,
      mask: maskData,
      dabChannel: dabData
  };
};


export const IhcTool: React.FC = () => {
  const [images, setImages] = useState<IhcImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewMode, setViewMode] = useState<'original' | 'dab' | 'mask'>('mask');
  
  // Settings
  const [settings, setSettings] = useState<IhcSettings>({
    threshold: 20, // Lower bound for positive
    weakThreshold: 80, // Upper bound for weak (Low -> High intensity)
    strongThreshold: 150 // Upper bound for mod
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Handlers ---

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);

    const newImages: IhcImage[] = [];
    for (let i = 0; i < files.length; i++) {
        // Use shared image utils
        const src = await processImageFile(files[i]);
        if (src) {
            newImages.push({
              id: Date.now() + i + Math.random().toString(),
              name: files[i].name,
              group: 'Group 1',
              src: src,
              positiveAreaPct: null,
              meanDensity: null,
              hScore: null,
              pixelsWeak: 0,
              pixelsMod: 0,
              pixelsStrong: 0,
              pixelsNeg: 0,
              mask: null,
              dabChannel: null,
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
            const result = analyzeIhcImage(img, settings);
            setImages(prev => prev.map(item => 
              item.id === activeImageId 
                ? { 
                    ...item, 
                    ...result,
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
            const result = analyzeIhcImage(img, settings);
            setImages(prev => prev.map(item => 
                item.id === imgData.id 
                ? { ...item, ...result, processed: true, width: img.width, height: img.height } 
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
        canvas.width = img.width;
        canvas.height = img.height;
        
        if (viewMode === 'dab' && imgData.processed && imgData.dabChannel) {
            ctx.putImageData(imgData.dabChannel, 0, 0);
        } else {
            // Draw original for 'original' and 'mask' modes
            ctx.drawImage(img, 0, 0);
            
            // Overlay mask
            if (viewMode === 'mask' && imgData.processed && imgData.mask) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = imgData.mask.width;
                tempCanvas.height = imgData.mask.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx?.putImageData(imgData.mask, 0, 0);
                
                ctx.drawImage(tempCanvas, 0, 0);
            }
        }
    };
  }, [activeImageId, images, viewMode]);

  // --- Stats Export ---

  const handleExportCsv = () => {
    let csv = "\uFEFFGroup,Image Name,Positive Area (%),H-Score,Mean Density,Weak%,Mod%,Strong%,Neg%\n";
    images.forEach(img => {
        const total = img.pixelsWeak + img.pixelsMod + img.pixelsStrong + img.pixelsNeg;
        const pWeak = total ? (img.pixelsWeak/total*100).toFixed(1) : 0;
        const pMod = total ? (img.pixelsMod/total*100).toFixed(1) : 0;
        const pStrong = total ? (img.pixelsStrong/total*100).toFixed(1) : 0;
        const pNeg = total ? (img.pixelsNeg/total*100).toFixed(1) : 0;
        
        csv += `"${img.group}","${img.name}",${img.positiveAreaPct?.toFixed(2) || ''},${img.hScore?.toFixed(2) || ''},${img.meanDensity?.toFixed(2) || ''},${pWeak},${pMod},${pStrong},${pNeg}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "IHC_Analysis_Results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Chart Data Helpers ---
  const activeStats = useMemo(() => {
      const img = images.find(i => i.id === activeImageId);
      if (!img || !img.processed) return null;
      return [
          { name: 'Negative', value: img.pixelsNeg, color: '#94a3b8' },
          { name: 'Weak (+)', value: img.pixelsWeak, color: '#facc15' },
          { name: 'Moderate (++)', value: img.pixelsMod, color: '#fb923c' },
          { name: 'Strong (+++)', value: img.pixelsStrong, color: '#ef4444' },
      ].filter(d => d.value > 0);
  }, [activeImageId, images]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-amber-100 p-3 rounded-2xl text-amber-700">
                <Palette size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">免疫组化 (IHC) 定量分析</h2>
               <p className="text-slate-500">基于颜色解卷积 (H&E DAB) 自动计算阳性率与 H-Score</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px]">
           
           {/* LEFT: Controls */}
           <div className="lg:col-span-3 flex flex-col gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                    <input type="file" accept="image/jpeg,image/png,image/tiff,.tif,.tiff,.jpg,.jpeg,.png" onChange={handleUpload} multiple id="ihc-upload" className="hidden" />
                    <label htmlFor="ihc-upload" className="w-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-dashed border-amber-300 rounded-lg py-3 flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors">
                        <Upload size={18} /> 上传 IHC 切片
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
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${activeImageId === img.id ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-400' : 'bg-white border-slate-200 hover:border-amber-200'}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-12 h-12 bg-slate-200 rounded overflow-hidden shrink-0 relative">
                                        <img src={img.src} className="w-full h-full object-cover" />
                                        {img.processed && <div className="absolute inset-0 bg-white/20" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-slate-700 truncate mb-1">{img.name}</div>
                                        <input 
                                            value={img.group}
                                            onClick={e => e.stopPropagation()}
                                            onChange={e => updateImageGroup(img.id, e.target.value)}
                                            className="w-full text-[10px] px-1 border rounded bg-slate-50 mb-1"
                                            placeholder="Group Name"
                                        />
                                        <div className="flex items-center justify-between">
                                            <span className={`text-[10px] font-bold ${img.hScore !== null ? 'text-amber-600' : 'text-slate-400'}`}>
                                                {img.hScore !== null ? `H-Score: ${img.hScore.toFixed(0)}` : 'Pending'}
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
                            <button onClick={analyzeAll} disabled={isProcessing} className="w-full bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:bg-slate-300">
                                {isProcessing ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />} 批量分析
                            </button>
                        </div>
                    )}
                </div>
           </div>

           {/* CENTER: Preview & Settings */}
           <div className="lg:col-span-6 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
                   {/* View Mode Toggles */}
                   <div className="flex justify-center mb-3 bg-slate-100 p-1 rounded-lg">
                       <button onClick={() => setViewMode('original')} className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${viewMode === 'original' ? 'bg-white text-slate-800 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-700'}`}>原图</button>
                       <button onClick={() => setViewMode('dab')} className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${viewMode === 'dab' ? 'bg-white text-amber-800 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-700'}`}>DAB 通道 (黑白)</button>
                       <button onClick={() => setViewMode('mask')} className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${viewMode === 'mask' ? 'bg-white text-blue-600 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-700'}`}>分析遮罩 (Color)</button>
                   </div>

                   {/* Threshold Sliders */}
                   <div className="space-y-3 px-1">
                       <div className="flex items-center gap-2">
                           <span className="text-[10px] font-bold w-12 text-slate-500">阳性阈值</span>
                           <input type="range" min="1" max="100" value={settings.threshold} onChange={e => setSettings(s => ({...s, threshold: parseInt(e.target.value)}))} className="flex-1 h-1.5 bg-slate-200 rounded-lg accent-blue-500" />
                           <span className="text-[10px] font-mono w-6">{settings.threshold}</span>
                       </div>
                       <div className="flex items-center gap-2">
                           <span className="text-[10px] font-bold w-12 text-amber-500">弱/中强</span>
                           <input type="range" min="settings.threshold" max="200" value={settings.weakThreshold} onChange={e => setSettings(s => ({...s, weakThreshold: parseInt(e.target.value)}))} className="flex-1 h-1.5 bg-slate-200 rounded-lg accent-amber-400" />
                           <span className="text-[10px] font-mono w-6">{settings.weakThreshold}</span>
                       </div>
                       <div className="flex items-center gap-2">
                           <span className="text-[10px] font-bold w-12 text-red-500">中/强阳</span>
                           <input type="range" min="settings.weakThreshold" max="255" value={settings.strongThreshold} onChange={e => setSettings(s => ({...s, strongThreshold: parseInt(e.target.value)}))} className="flex-1 h-1.5 bg-slate-200 rounded-lg accent-red-500" />
                           <span className="text-[10px] font-mono w-6">{settings.strongThreshold}</span>
                       </div>
                   </div>

                   <div className="flex justify-end mt-2 pt-2 border-t border-slate-100">
                        <button onClick={analyzeActiveImage} disabled={!activeImageId || isProcessing} className="bg-amber-100 text-amber-700 hover:bg-amber-200 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors">
                            重新计算
                        </button>
                   </div>
               </div>

               <div className="bg-slate-900 rounded-xl flex-1 overflow-hidden relative flex items-center justify-center border border-slate-800 h-[400px]" ref={containerRef}>
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
                     <p>
                        系统使用颜色解卷积分离 DAB 信号。调整滑块以定义强度分级：<br/>
                        <span className="text-blue-600 font-bold">蓝色(阴性)</span> &lt; 阳性阈值 &lt; <span className="text-yellow-600 font-bold">黄色(弱阳)</span> &lt; <span className="text-orange-500 font-bold">橙色(中阳)</span> &lt; <span className="text-red-500 font-bold">红色(强阳)</span>
                     </p>
               </div>
           </div>

           {/* RIGHT: Stats */}
           <div className="lg:col-span-3 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <BarChart3 size={18} /> 分析结果
                   </h3>
                   
                   {activeStats ? (
                       <div className="mb-4 bg-slate-50 rounded-xl p-3 border border-slate-100">
                           <div className="text-center mb-3">
                               <div className="text-xs text-slate-500 uppercase tracking-wider font-bold">H-Score</div>
                               <div className="text-3xl font-bold text-amber-600">{images.find(i => i.id === activeImageId)?.hScore?.toFixed(0) || 0}</div>
                               <div className="text-[10px] text-slate-400">Range: 0 - 300</div>
                           </div>
                           <div className="h-[120px] w-full">
                               <ResponsiveContainer width="100%" height="100%">
                                   <PieChart>
                                       <Pie
                                           data={activeStats}
                                           dataKey="value"
                                           nameKey="name"
                                           cx="50%"
                                           cy="50%"
                                           innerRadius={25}
                                           outerRadius={45}
                                           paddingAngle={2}
                                       >
                                           {activeStats.map((entry, index) => (
                                               <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                                           ))}
                                       </Pie>
                                       <Tooltip />
                                   </PieChart>
                               </ResponsiveContainer>
                           </div>
                           <div className="flex flex-wrap gap-2 justify-center mt-2">
                               {activeStats.map(s => (
                                   <div key={s.name} className="flex items-center gap-1 text-[10px]">
                                       <div className="w-2 h-2 rounded-full" style={{backgroundColor: s.color}}></div>
                                       <span className="text-slate-600">{s.name}</span>
                                   </div>
                               ))}
                           </div>
                       </div>
                   ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-sm min-h-[150px]">
                           <BarChart3 size={40} className="mb-2 opacity-20" />
                           <p>暂无数据</p>
                       </div>
                   )}
                   
                   <div className="flex-1 overflow-y-auto border-t border-slate-100 pt-2">
                       <table className="w-full text-xs text-left">
                           <thead className="text-slate-500">
                               <tr>
                                   <th className="py-2">Image</th>
                                   <th className="py-2 text-right">Pos %</th>
                                   <th className="py-2 text-right">H-Score</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                               {images.map(img => (
                                   <tr key={img.id} className={activeImageId === img.id ? "bg-amber-50" : ""}>
                                       <td className="py-2 font-medium text-slate-700 max-w-[80px] truncate" title={img.name}>{img.name}</td>
                                       <td className="py-2 text-right text-slate-500">
                                           {img.positiveAreaPct?.toFixed(1) || '-'}%
                                       </td>
                                       <td className="py-2 text-right text-amber-600 font-mono font-bold">
                                           {img.hScore?.toFixed(0) || '-'}
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                   </div>
                   
                   <button onClick={handleExportCsv} className="w-full mt-4 bg-slate-800 hover:bg-slate-900 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                       <Download size={14} /> 导出结果 CSV
                   </button>
               </div>
           </div>
       </div>
    </div>
  );
};
