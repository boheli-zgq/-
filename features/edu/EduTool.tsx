import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { CircleDot, Upload, Trash2, Sliders, Play, RefreshCw, Eye, Download, Info, BarChart3, Layers, CheckCircle2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ErrorBar, Cell } from 'recharts';

// --- Types ---

interface DetectedCell {
  x: number;
  y: number;
  radius: number;
  meanEduIntensity: number;
  isPositive: boolean;
}

interface EduImage {
  id: string;
  name: string;
  group: string;
  src: string;
  
  // Stats
  totalCount: number | null; // DAPI Count
  positiveCount: number | null; // EdU+ Count
  proliferationRate: number | null; // %
  
  // Visualization Data
  cells: DetectedCell[];
  
  processed: boolean;
  width: number;
  height: number;
}

interface ProcessSettings {
  nucleiChannel: 'blue' | 'red' | 'green' | 'gray';
  nucleiThreshold: number; // For Segmentation
  eduChannel: 'green' | 'red' | 'blue' | 'gray';
  eduThreshold: number; // For Classification (Intensity within nucleus)
  minSize: number; // Min pixel count
  maxSize: number;
}

// --- File Helpers (Reuse UTIF logic) ---

const ensureUtifLoaded = async () => {
    if ((window as any).UTIF) return true;
    return new Promise<boolean>((resolve) => {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js";
        script.crossOrigin = "anonymous";
        script.onload = () => resolve(true);
        script.onerror = () => {
             const script2 = document.createElement('script');
             script2.src = "https://unpkg.com/utif@3.1.0/UTIF.js";
             script2.onload = () => resolve(true);
             script2.onerror = () => resolve(false);
             document.body.appendChild(script2);
        };
        document.body.appendChild(script);
    });
};

const processFile = async (file: File): Promise<string | null> => {
    const isTiff = file.type === 'image/tiff' || 
                   file.type === 'image/x-tiff' ||
                   file.name.toLowerCase().endsWith('.tif') || 
                   file.name.toLowerCase().endsWith('.tiff');
    
    if (!isTiff) return URL.createObjectURL(file);

    try {
        const loaded = await ensureUtifLoaded();
        if (!loaded) return null;
        
        const utifLib = (window as any).UTIF;
        const buffer = await file.arrayBuffer();
        const ifds = utifLib.decode(buffer);
        if (ifds && ifds.length > 0) {
            const page = ifds[0];
            utifLib.decodeImage(buffer, page);
            const rgba = utifLib.toRGBA8(page);
            const canvas = document.createElement('canvas');
            canvas.width = page.width;
            canvas.height = page.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const imageData = ctx.createImageData(page.width, page.height);
                imageData.data.set(rgba);
                ctx.putImageData(imageData, 0, 0);
                return new Promise((resolve) => {
                    canvas.toBlob((blob) => {
                        resolve(blob ? URL.createObjectURL(blob) : null);
                    }, 'image/png');
                });
            }
        }
    } catch (e) {
        console.error("TIFF processing error", e);
    }
    return null;
};

// --- Detection Logic (Nuclei First) ---

const getPixelValue = (data: Uint8ClampedArray, idx: number, channel: string) => {
    // idx is pixel index (0 to w*h), data has 4 bytes per pixel
    const i = idx * 4;
    if (channel === 'red') return data[i];
    if (channel === 'green') return data[i+1];
    if (channel === 'blue') return data[i+2];
    return (data[i] + data[i+1] + data[i+2]) / 3;
};

const detectNucleiAndClassify = (
    img: HTMLImageElement,
    settings: ProcessSettings
): DetectedCell[] => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    const binary = new Uint8Array(width * height);
    
    // 1. Segmentation: Identify Nuclei (Total Cells)
    for (let i = 0; i < width * height; i++) {
        const val = getPixelValue(data, i, settings.nucleiChannel);
        if (val > settings.nucleiThreshold) {
            binary[i] = 1;
        }
    }

    // 2. Blob Detection (BFS)
    const visited = new Uint8Array(width * height);
    const cells: DetectedCell[] = [];
    const getIdx = (x: number, y: number) => y * width + x;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = getIdx(x, y);
            if (binary[idx] === 1 && visited[idx] === 0) {
                const stack = [[x, y]];
                visited[idx] = 1;
                let pixelCount = 0;
                let minX = x, maxX = x, minY = y, maxY = y;
                
                // Accumulate EdU intensity within this blob
                let eduIntensitySum = 0;

                while (stack.length > 0) {
                    const [cx, cy] = stack.pop()!;
                    const cIdx = getIdx(cx, cy);
                    
                    pixelCount++;
                    eduIntensitySum += getPixelValue(data, cIdx, settings.eduChannel);

                    if (cx < minX) minX = cx;
                    if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy;
                    if (cy > maxY) maxY = cy;

                    const neighbors = [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]];
                    for (const [nx, ny] of neighbors) {
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = getIdx(nx, ny);
                            if (binary[nIdx] === 1 && visited[nIdx] === 0) {
                                visited[nIdx] = 1;
                                stack.push([nx, ny]);
                            }
                        }
                    }
                }

                if (pixelCount >= settings.minSize && pixelCount <= settings.maxSize) {
                    const w = maxX - minX;
                    const h = maxY - minY;
                    const radius = Math.sqrt(pixelCount / Math.PI);
                    const meanEdu = eduIntensitySum / pixelCount;
                    
                    cells.push({
                        x: minX + w / 2,
                        y: minY + h / 2,
                        radius: Math.max(2, radius),
                        meanEduIntensity: meanEdu,
                        isPositive: meanEdu > settings.eduThreshold
                    });
                }
            }
        }
    }
    return cells;
};

export const EduTool: React.FC = () => {
  const [images, setImages] = useState<EduImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Settings
  const [settings, setSettings] = useState<ProcessSettings>({
    nucleiChannel: 'blue', // DAPI
    nucleiThreshold: 40,
    eduChannel: 'green', // EdU
    eduThreshold: 60,
    minSize: 10,
    maxSize: 5000
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Handlers ---

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);

    const newImages: EduImage[] = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const src = await processFile(file);
        if (src) {
            newImages.push({
              id: Date.now() + i + Math.random().toString(),
              name: file.name,
              group: 'Group 1',
              src: src,
              totalCount: null,
              positiveCount: null,
              proliferationRate: null,
              cells: [],
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
         const cells = detectNucleiAndClassify(img, settings);
         const tCount = cells.length;
         const pCount = cells.filter(c => c.isPositive).length;
         const rate = tCount > 0 ? (pCount / tCount) * 100 : 0;
         
         setImages(prev => prev.map(item => 
           item.id === activeImageId 
            ? { 
                ...item, 
                processed: true,
                totalCount: tCount,
                positiveCount: pCount,
                proliferationRate: rate,
                cells,
                width: img.width,
                height: img.height
              }
            : item
         ));
         setIsProcessing(false);
      };
    }, 100);
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
            const cells = detectNucleiAndClassify(img, settings);
            const tCount = cells.length;
            const pCount = cells.filter(c => c.isPositive).length;
            const rate = tCount > 0 ? (pCount / tCount) * 100 : 0;

            setImages(prev => prev.map(item => 
                item.id === imgData.id 
                ? { ...item, processed: true, totalCount: tCount, positiveCount: pCount, proliferationRate: rate, cells, width: img.width, height: img.height } 
                : item
            ));
            setTimeout(() => processNext(index + 1), 10);
        };
    };
    processNext(0);
  };

  // --- Visualization ---
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
          ctx.drawImage(img, 0, 0);

          if (imgData.processed) {
              // 1. Draw Total (Nuclei) Outlines
              imgData.cells.forEach(b => {
                  ctx.beginPath();
                  ctx.arc(b.x, b.y, b.radius + 1, 0, Math.PI * 2);
                  ctx.lineWidth = 1;
                  // If positive, solid stroke. If negative, dashed or thinner?
                  // Just use blue outline for all to show DAPI recognition.
                  ctx.strokeStyle = 'rgba(60, 130, 246, 0.8)'; // Blue
                  ctx.stroke();
              });

              // 2. Draw Positive Indicators (Filled)
              const eduColor = settings.eduChannel === 'green' ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)';
              imgData.cells.filter(c => c.isPositive).forEach(b => {
                  ctx.beginPath();
                  ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
                  ctx.fillStyle = eduColor;
                  ctx.fill();
                  
                  // Optional: center dot
                  ctx.beginPath();
                  ctx.arc(b.x, b.y, 1, 0, Math.PI * 2);
                  ctx.fillStyle = '#fff';
                  ctx.fill();
              });
          }
      };
  }, [activeImageId, images, settings.eduChannel]);

  // --- Stats & Export ---
  const groupStats = useMemo(() => {
      const groups: Record<string, { totalRate: number; count: number; values: number[] }> = {};
      images.filter(i => i.processed && i.proliferationRate !== null).forEach(img => {
          if (!groups[img.group]) groups[img.group] = { totalRate: 0, count: 0, values: [] };
          const val = img.proliferationRate || 0;
          groups[img.group].totalRate += val;
          groups[img.group].count += 1;
          groups[img.group].values.push(val);
      });

      return Object.entries(groups).map(([name, stats]) => {
          const mean = stats.totalRate / stats.count;
          const variance = stats.values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (stats.count > 1 ? stats.count - 1 : 1);
          const sd = Math.sqrt(variance);
          return { name, mean: parseFloat(mean.toFixed(2)), sd: parseFloat(sd.toFixed(2)), error: [parseFloat((mean - sd).toFixed(2)), parseFloat((mean + sd).toFixed(2))] };
      });
  }, [images]);

  const handleExportCsv = () => {
    let csv = "\uFEFFGroup,Image Name,Total Cells (DAPI),Positive Cells (EdU),Proliferation Rate (%)\n";
    images.forEach(img => {
        csv += `"${img.group}","${img.name}",${img.totalCount || 0},${img.positiveCount || 0},${img.proliferationRate?.toFixed(2) || 0}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "EdU_Assay_Results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-lime-100 p-3 rounded-2xl text-lime-600">
                <CircleDot size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">EdU 细胞增殖分析</h2>
               <p className="text-slate-500">基于 DAPI 细胞核定位与 EdU 信号共定位分析 (Co-localization)</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px]">
           
           {/* LEFT: Controls */}
           <div className="lg:col-span-3 flex flex-col gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                    <input type="file" accept="image/*,.tif,.tiff" onChange={handleUpload} multiple id="edu-upload" className="hidden" />
                    <label htmlFor="edu-upload" className="w-full bg-lime-50 hover:bg-lime-100 text-lime-700 border border-dashed border-lime-200 rounded-lg py-3 flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors">
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
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${activeImageId === img.id ? 'bg-lime-50 border-lime-400 ring-1 ring-lime-400' : 'bg-white border-slate-200 hover:border-lime-200'}`}
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
                                            <span className={`text-[10px] font-bold ${img.proliferationRate !== null ? 'text-lime-600' : 'text-slate-400'}`}>
                                                {img.proliferationRate !== null ? `${img.proliferationRate.toFixed(1)}%` : 'Pending'}
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
                            <button onClick={analyzeAll} disabled={isProcessing} className="w-full bg-lime-600 hover:bg-lime-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:bg-slate-300">
                                {isProcessing ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />} 批量分析
                            </button>
                        </div>
                    )}
                </div>
           </div>

           {/* CENTER: Settings & Preview */}
           <div className="lg:col-span-6 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
                   <div className="flex items-center gap-4 flex-wrap mb-3">
                       <div className="flex items-center gap-2 text-sm text-slate-600 font-bold">
                           <Sliders size={16} /> 参数:
                       </div>
                       
                       {/* Total (Nuclei) */}
                       <div className="flex flex-col gap-1 p-2 bg-blue-50 rounded-lg border border-blue-100">
                           <div className="flex items-center gap-2">
                               <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                               <span className="text-xs font-bold text-blue-700">步骤1: 细胞核识别 (DAPI)</span>
                               <select 
                                   value={settings.nucleiChannel}
                                   onChange={e => setSettings(s => ({...s, nucleiChannel: e.target.value as any}))}
                                   className="text-[10px] border rounded px-1"
                               >
                                   <option value="blue">Blue</option>
                                   <option value="gray">Gray</option>
                               </select>
                           </div>
                           <div className="flex items-center gap-1">
                               <span className="text-[10px] text-slate-500">分割阈值</span>
                               <input type="range" min="1" max="255" value={settings.nucleiThreshold} onChange={e => setSettings(s => ({...s, nucleiThreshold: parseInt(e.target.value)}))} className="w-16 h-1.5" />
                           </div>
                       </div>

                       {/* Positive (EdU) */}
                       <div className="flex flex-col gap-1 p-2 bg-lime-50 rounded-lg border border-lime-100">
                           <div className="flex items-center gap-2">
                               <div className="w-2 h-2 rounded-full bg-lime-500"></div>
                               <span className="text-xs font-bold text-lime-700">步骤2: 阳性判定 (EdU)</span>
                               <select 
                                   value={settings.eduChannel}
                                   onChange={e => setSettings(s => ({...s, eduChannel: e.target.value as any}))}
                                   className="text-[10px] border rounded px-1"
                               >
                                   <option value="green">Green</option>
                                   <option value="red">Red</option>
                               </select>
                           </div>
                           <div className="flex items-center gap-1">
                               <span className="text-[10px] text-slate-500">强度阈值</span>
                               <input type="range" min="1" max="255" value={settings.eduThreshold} onChange={e => setSettings(s => ({...s, eduThreshold: parseInt(e.target.value)}))} className="w-16 h-1.5" />
                           </div>
                       </div>
                   </div>
                   <div className="flex justify-between items-center border-t border-slate-100 pt-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>最小细胞尺寸:</span>
                            <input type="number" value={settings.minSize} onChange={e => setSettings(s => ({...s, minSize: parseInt(e.target.value)}))} className="w-12 border rounded px-1" />
                        </div>
                        <button onClick={analyzeActiveImage} disabled={!activeImageId || isProcessing} className="bg-lime-100 text-lime-700 hover:bg-lime-200 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors">
                            重新识别
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
                     <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-blue-600" />
                     <p>
                        <strong>逻辑更新：</strong> 系统采用“以核为中心”的分析方法。
                        首先识别蓝色通道中的所有 DAPI 细胞核（总数），然后测量每个细胞核区域内的 EdU 荧光强度。
                        如果强度高于阈值，则判定为阳性。这确保了在 Merge 图中，即使 EdU 信号覆盖了 DAPI，总细胞数依然准确。
                     </p>
               </div>
           </div>

           {/* RIGHT: Stats */}
           <div className="lg:col-span-3 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <BarChart3 size={18} /> 阳性率 (%)
                   </h3>
                   
                   {groupStats.length > 0 ? (
                       <div className="h-[200px] w-full shrink-0 mb-4">
                           <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={groupStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                                    <Bar dataKey="mean" fill="#84cc16" radius={[4, 4, 0, 0]}>
                                        <ErrorBar dataKey="error" width={4} strokeWidth={2} stroke="#4d7c0f" />
                                        {groupStats.map((entry, index) => <Cell key={`cell-${index}`} fill={['#84cc16', '#22c55e', '#3b82f6', '#f59e0b'][index % 4]} />)}
                                    </Bar>
                                </BarChart>
                           </ResponsiveContainer>
                       </div>
                   ) : (
                       <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-sm">
                           <BarChart3 size={40} className="mb-2 opacity-20" />
                           <p>暂无数据</p>
                       </div>
                   )}
                   
                   <div className="flex-1 overflow-y-auto border-t border-slate-100 pt-2">
                       <table className="w-full text-xs text-left">
                           <thead className="text-slate-500">
                               <tr>
                                   <th className="py-2">Image</th>
                                   <th className="py-2 text-right">Count (Pos/Total)</th>
                                   <th className="py-2 text-right">Rate</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                               {images.map(img => (
                                   <tr key={img.id} className={activeImageId === img.id ? "bg-lime-50" : ""}>
                                       <td className="py-2 font-medium text-slate-700 max-w-[80px] truncate" title={img.name}>{img.name}</td>
                                       <td className="py-2 text-right text-slate-500">
                                           {img.positiveCount || 0} / {img.totalCount || 0}
                                       </td>
                                       <td className="py-2 text-right text-lime-600 font-mono font-bold">
                                           {img.proliferationRate !== null ? `${img.proliferationRate.toFixed(1)}%` : '-'}
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