import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Aperture, Upload, Trash2, Sliders, Play, RefreshCw, Eye, Download, Info, BarChart3, Layers } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { processImageFile } from '../../services/imageUtils';

// --- Types ---

interface IFImage {
  id: string;
  name: string;
  group: string;
  src: string;
  
  // Analysis Results
  channel: 'red' | 'green' | 'blue' | 'gray';
  threshold: number;
  positiveAreaPct: number | null;
  meanIntensity: number | null;
  integratedDensity: number | null;
  
  // Visualization
  mask: ImageData | null;
  
  processed: boolean;
  width: number;
  height: number;
}

interface AnalysisSettings {
  channel: 'red' | 'green' | 'blue' | 'gray';
  threshold: number; // 0-255
}

// --- Analysis Logic ---

const analyzeImage = (
  img: HTMLImageElement,
  settings: AnalysisSettings
): { positiveAreaPct: number; meanIntensity: number; integratedDensity: number; mask: ImageData } => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Canvas context failed");

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Output mask (Highlight positive pixels)
  const maskData = ctx.createImageData(canvas.width, canvas.height);
  const dst = maskData.data;

  let positiveCount = 0;
  let totalIntensity = 0;
  
  for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      let value = 0;
      
      switch (settings.channel) {
          case 'red': value = r; break;
          case 'green': value = g; break;
          case 'blue': value = b; break;
          case 'gray': value = (0.299 * r + 0.587 * g + 0.114 * b); break;
      }
      
      if (value >= settings.threshold) {
          positiveCount++;
          totalIntensity += value;
          
          // Draw mask (White with transparency, or colored based on channel)
          dst[i] = 255; 
          dst[i+1] = 255;
          dst[i+2] = 255;
          dst[i+3] = 150; // Semi-transparent
      }
  }
  
  const totalPixels = canvas.width * canvas.height;
  const positiveAreaPct = (positiveCount / totalPixels) * 100;
  const meanIntensity = positiveCount > 0 ? totalIntensity / positiveCount : 0;
  const integratedDensity = meanIntensity * positiveCount; // Simplified IntDen (Mean * Area)

  return { positiveAreaPct, meanIntensity, integratedDensity, mask: maskData };
};


export const ImmunofluorescenceTool: React.FC = () => {
  const [images, setImages] = useState<IFImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Global Settings for new analysis
  const [settings, setSettings] = useState<AnalysisSettings>({
    channel: 'green',
    threshold: 50
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Handlers ---

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);

    const newImages: IFImage[] = [];
    for (let i = 0; i < files.length; i++) {
        // Use shared image utils
        const src = await processImageFile(files[i]);
        if (src) {
            newImages.push({
              id: Date.now() + i + Math.random().toString(),
              name: files[i].name,
              group: 'Group 1',
              src: src,
              // Init with defaults
              channel: settings.channel,
              threshold: settings.threshold,
              positiveAreaPct: null,
              meanIntensity: null,
              integratedDensity: null,
              mask: null,
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
            const result = analyzeImage(img, settings);
            setImages(prev => prev.map(item => 
              item.id === activeImageId 
                ? { 
                    ...item, 
                    ...settings, // Store parameters used
                    positiveAreaPct: result.positiveAreaPct, 
                    meanIntensity: result.meanIntensity,
                    integratedDensity: result.integratedDensity,
                    mask: result.mask, 
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
            const result = analyzeImage(img, settings);
            setImages(prev => prev.map(item => 
                item.id === imgData.id 
                ? { 
                    ...item, 
                    ...settings,
                    positiveAreaPct: result.positiveAreaPct, 
                    meanIntensity: result.meanIntensity,
                    integratedDensity: result.integratedDensity,
                    mask: result.mask, 
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
        
        // Draw original
        ctx.drawImage(img, 0, 0);

        // Draw Mask Overlay
        if (imgData.processed && imgData.mask) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imgData.mask.width;
            tempCanvas.height = imgData.mask.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx?.putImageData(imgData.mask, 0, 0);
            
            ctx.drawImage(tempCanvas, 0, 0);
        }
    };
  }, [activeImageId, images]); // Redraw on update

  // --- Stats Export ---

  const handleExportCsv = () => {
    let csv = "\uFEFFGroup,Image Name,Channel,Threshold,Positive Area (%),Mean Intensity,IntDen\n";
    images.forEach(img => {
        csv += `"${img.group}","${img.name}","${img.channel || '-'}",${img.threshold || 0},${img.positiveAreaPct?.toFixed(2) || ''},${img.meanIntensity?.toFixed(2) || ''},${img.integratedDensity?.toFixed(0) || ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "IF_Analysis_Results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Visualization Helpers ---
  const getChannelColor = (c: string) => {
      switch(c) {
          case 'red': return 'text-red-500';
          case 'green': return 'text-emerald-500';
          case 'blue': return 'text-blue-500';
          default: return 'text-slate-500';
      }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-rose-100 p-3 rounded-2xl text-rose-600">
                <Aperture size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">免疫荧光定量分析</h2>
               <p className="text-slate-500">计算荧光强度与阳性区域占比 (MFI & Area Fraction)</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px]">
           
           {/* LEFT: Controls (3 cols) */}
           <div className="lg:col-span-3 flex flex-col gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                    <input type="file" accept="image/jpeg,image/png,image/tiff,.tif,.tiff,.jpg,.jpeg,.png" onChange={handleUpload} multiple id="if-upload" className="hidden" />
                    <label htmlFor="if-upload" className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-dashed border-rose-200 rounded-lg py-3 flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors">
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
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${activeImageId === img.id ? 'bg-rose-50 border-rose-400 ring-1 ring-rose-400' : 'bg-white border-slate-200 hover:border-rose-200'}`}
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
                                            <span className={`text-[10px] font-bold ${img.meanIntensity !== null ? getChannelColor(img.channel) : 'text-slate-400'}`}>
                                                {img.meanIntensity !== null ? `MFI: ${img.meanIntensity.toFixed(0)}` : 'Pending'}
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
                            <button onClick={analyzeAll} disabled={isProcessing} className="w-full bg-rose-600 hover:bg-rose-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:bg-slate-300">
                                {isProcessing ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />} 批量分析
                            </button>
                        </div>
                    )}
                </div>
           </div>

           {/* CENTER: Preview & Settings (6 cols) */}
           <div className="lg:col-span-6 flex flex-col gap-4">
               {/* Settings Bar */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
                   <div className="flex items-center gap-4 flex-wrap mb-3">
                       <div className="flex items-center gap-2 text-sm text-slate-600 font-bold">
                           <Sliders size={16} /> 分析参数:
                       </div>
                       <div className="flex items-center gap-2">
                           <span className="text-xs text-slate-500">分析通道</span>
                           <select 
                                value={settings.channel} 
                                onChange={(e) => setSettings(s => ({ ...s, channel: e.target.value as any }))}
                                className="text-xs border border-slate-300 rounded px-2 py-1 outline-none focus:border-rose-500"
                           >
                               <option value="red">Red (R)</option>
                               <option value="green">Green (G)</option>
                               <option value="blue">Blue (B)</option>
                               <option value="gray">Grayscale</option>
                           </select>
                       </div>
                       <div className="w-px h-4 bg-slate-300 mx-1"></div>
                       <div className="flex items-center gap-2 flex-1 min-w-[150px]">
                           <span className="text-xs text-slate-500">阈值 ({settings.threshold})</span>
                           <input 
                                type="range" min="0" max="255" 
                                value={settings.threshold} 
                                onChange={(e) => setSettings(s => ({ ...s, threshold: parseInt(e.target.value) }))}
                                className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-rose-500"
                           />
                       </div>
                   </div>
                   <div className="flex justify-end">
                       <button onClick={analyzeActiveImage} disabled={!activeImageId || isProcessing} className="bg-rose-100 text-rose-700 hover:bg-rose-200 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors">
                           重新计算当前图片
                       </button>
                   </div>
               </div>

               {/* Canvas View */}
               <div className="bg-slate-900 rounded-xl flex-1 overflow-hidden relative flex items-center justify-center border border-slate-800 h-[450px]" ref={containerRef}>
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
                     <p>拖动“阈值”滑块以区分背景与阳性信号。白色高亮区域即为被统计的阳性区域。请针对染料颜色选择正确的通道 (DAPI选Blue, FITC选Green, TRITC选Red)。</p>
               </div>
           </div>

           {/* RIGHT: Stats (3 cols) */}
           <div className="lg:col-span-3 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <BarChart3 size={18} /> 详细数据
                   </h3>
                   
                   <div className="flex-1 overflow-y-auto border-t border-slate-100 pt-2">
                       <table className="w-full text-xs text-left">
                           <thead className="text-slate-500">
                               <tr>
                                   <th className="py-2">Image</th>
                                   <th className="py-2 text-right">Area %</th>
                                   <th className="py-2 text-right">MFI</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                               {images.map(img => (
                                   <tr key={img.id} className={activeImageId === img.id ? "bg-rose-50" : ""}>
                                       <td className="py-2 font-medium text-slate-700 max-w-[80px] truncate" title={img.name}>{img.name}</td>
                                       <td className="py-2 text-right text-slate-600 font-mono">
                                           {img.positiveAreaPct !== null ? `${img.positiveAreaPct.toFixed(1)}%` : '-'}
                                       </td>
                                       <td className="py-2 text-right text-rose-600 font-mono font-bold">
                                           {img.meanIntensity !== null ? img.meanIntensity.toFixed(0) : '-'}
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                       {images.length === 0 && (
                           <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                               <Layers size={32} className="mb-2 opacity-20" />
                               <p>暂无数据</p>
                           </div>
                       )}
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