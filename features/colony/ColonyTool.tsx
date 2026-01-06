import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Disc, Upload, Trash2, Sliders, Play, RefreshCw, Eye, Download, Info, BarChart3, ScanLine } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ErrorBar, Cell } from 'recharts';

// --- Types ---

interface DetectedColony {
  x: number;
  y: number;
  area: number; // pixel count
  radius: number; // approx
}

interface ColonyImage {
  id: string;
  name: string;
  group: string;
  src: string;
  
  // Results
  count: number | null;
  colonies: DetectedColony[];
  
  processed: boolean;
  width: number;
  height: number;
}

interface ProcessSettings {
  threshold: number; // 0-255 (Darker < Threshold = Colony)
  minSize: number; // Min pixels to be a colony
  maxSize: number; // Max pixels
  circularMask: boolean; // Whether to mask the edges of the dish
  maskRatio: number; // 0.0 - 1.0 (Radius ratio for mask)
}

// --- File Helpers (TIFF Support) ---

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

// --- Detection Logic ---

const processColonyImage = (img: HTMLImageElement, settings: ProcessSettings): DetectedColony[] => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    const binary = new Uint8Array(width * height);
    
    // Dish Mask Parameters
    const centerX = width / 2;
    const centerY = height / 2;
    // Radius is based on the smaller dimension to fit in the dish
    const maxRadius = Math.min(width, height) / 2;
    const maskRadiusSq = Math.pow(maxRadius * settings.maskRatio, 2);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const px = idx * 4;
            
            // 1. Circular Mask Check
            if (settings.circularMask) {
                const distSq = Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2);
                if (distSq > maskRadiusSq) {
                    continue; // Skip pixels outside mask
                }
            }

            // 2. Grayscale Conversion
            // Simple luminance: 0.299R + 0.587G + 0.114B
            const gray = 0.299 * data[px] + 0.587 * data[px+1] + 0.114 * data[px+2];

            // 3. Thresholding (Colonies are typically darker than background in Crystal Violet)
            // If gray < threshold -> It is a colony pixel (1)
            if (gray < settings.threshold) {
                binary[idx] = 1;
            }
        }
    }

    // 4. Blob Detection (BFS)
    const visited = new Uint8Array(width * height);
    const colonies: DetectedColony[] = [];
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (binary[idx] === 1 && visited[idx] === 0) {
                const stack = [[x, y]];
                visited[idx] = 1;
                let pixelCount = 0;
                let minX = x, maxX = x, minY = y, maxY = y;

                while (stack.length > 0) {
                    const [cx, cy] = stack.pop()!;
                    pixelCount++;
                    
                    if (cx < minX) minX = cx;
                    if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy;
                    if (cy > maxY) maxY = cy;

                    const neighbors = [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]];
                    for (const [nx, ny] of neighbors) {
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = ny * width + nx;
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
                    colonies.push({
                        x: minX + w / 2,
                        y: minY + h / 2,
                        area: pixelCount,
                        radius: Math.max(2, radius)
                    });
                }
            }
        }
    }

    return colonies;
};

export const ColonyTool: React.FC = () => {
  const [images, setImages] = useState<ColonyImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Settings
  const [settings, setSettings] = useState<ProcessSettings>({
    threshold: 160, // Standard Crystal Violet on light box is usually clear dark on bright.
    minSize: 20, // Filter dust
    maxSize: 10000,
    circularMask: true, // Default to true for petri dishes
    maskRatio: 0.95
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Handlers ---

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);

    const newImages: ColonyImage[] = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const src = await processFile(file);
        if (src) {
            newImages.push({
              id: Date.now() + i + Math.random().toString(),
              name: file.name,
              group: 'Group 1',
              src: src,
              count: null,
              colonies: [],
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
         const colonies = processColonyImage(img, settings);
         setImages(prev => prev.map(item => 
           item.id === activeImageId 
            ? { 
                ...item, 
                processed: true,
                count: colonies.length,
                colonies,
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
            const colonies = processColonyImage(img, settings);
            setImages(prev => prev.map(item => 
                item.id === imgData.id 
                ? { ...item, processed: true, count: colonies.length, colonies, width: img.width, height: img.height } 
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

          // Draw Mask Overlay (Visual guide)
          if (settings.circularMask) {
              const cx = canvas.width / 2;
              const cy = canvas.height / 2;
              const r = (Math.min(canvas.width, canvas.height) / 2) * settings.maskRatio;
              
              ctx.beginPath();
              // Outer rectangle
              ctx.rect(0, 0, canvas.width, canvas.height);
              // Inner circle (anti-clockwise to create hole)
              ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
              ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
              ctx.fill();
              
              ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.stroke();
          }

          if (imgData.processed) {
              ctx.strokeStyle = '#d946ef'; // Fuchsia
              ctx.lineWidth = 2;
              ctx.fillStyle = 'rgba(217, 70, 239, 0.2)';
              
              imgData.colonies.forEach(c => {
                  ctx.beginPath();
                  ctx.arc(c.x, c.y, c.radius + 2, 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.fill();
              });
          }
      };
  }, [activeImageId, images, settings.circularMask, settings.maskRatio]);

  // --- Stats & Export ---
  const groupStats = useMemo(() => {
      const groups: Record<string, { total: number; count: number; values: number[] }> = {};
      images.filter(i => i.processed && i.count !== null).forEach(img => {
          if (!groups[img.group]) groups[img.group] = { total: 0, count: 0, values: [] };
          const val = img.count || 0;
          groups[img.group].total += val;
          groups[img.group].count += 1;
          groups[img.group].values.push(val);
      });

      return Object.entries(groups).map(([name, stats]) => {
          const mean = stats.total / stats.count;
          const variance = stats.values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (stats.count > 1 ? stats.count - 1 : 1);
          const sd = Math.sqrt(variance);
          return { name, mean: parseFloat(mean.toFixed(1)), sd: parseFloat(sd.toFixed(1)), error: [parseFloat((mean - sd).toFixed(1)), parseFloat((mean + sd).toFixed(1))] };
      });
  }, [images]);

  const handleExportCsv = () => {
    let csv = "\uFEFFGroup,Image Name,Colony Count,Processing Settings\n";
    const settingStr = `Threshold:${settings.threshold};Mask:${settings.circularMask};MinSize:${settings.minSize}`;
    images.forEach(img => {
        csv += `"${img.group}","${img.name}",${img.count || 0},"${settingStr}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Colony_Formation_Results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-fuchsia-100 p-3 rounded-2xl text-fuchsia-600">
                <Disc size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">克隆形成定量分析</h2>
               <p className="text-slate-500">自动计数、培养皿掩膜去阴影、多格式图片支持</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px]">
           
           {/* LEFT: Controls */}
           <div className="lg:col-span-3 flex flex-col gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                    <input type="file" accept="image/*,.tif,.tiff" onChange={handleUpload} multiple id="colony-upload" className="hidden" />
                    <label htmlFor="colony-upload" className="w-full bg-fuchsia-50 hover:bg-fuchsia-100 text-fuchsia-700 border border-dashed border-fuchsia-200 rounded-lg py-3 flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors">
                        <Upload size={18} /> 上传克隆图片
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
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${activeImageId === img.id ? 'bg-fuchsia-50 border-fuchsia-400 ring-1 ring-fuchsia-400' : 'bg-white border-slate-200 hover:border-fuchsia-200'}`}
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
                                            <span className={`text-[10px] font-bold ${img.count !== null ? 'text-fuchsia-600' : 'text-slate-400'}`}>
                                                {img.count !== null ? `${img.count} colonies` : 'Pending'}
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
                            <button onClick={analyzeAll} disabled={isProcessing} className="w-full bg-fuchsia-600 hover:bg-fuchsia-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:bg-slate-300">
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
                           <Sliders size={16} /> 设置:
                       </div>
                       
                       {/* Threshold */}
                       <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                           <span className="text-xs text-slate-500">颜色深度</span>
                           <input 
                                type="range" min="1" max="250" 
                                value={settings.threshold} 
                                onChange={e => setSettings(s => ({...s, threshold: parseInt(e.target.value)}))}
                                className="w-20 h-1.5 accent-fuchsia-500" 
                           />
                       </div>

                       {/* Size */}
                       <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                           <span className="text-xs text-slate-500">最小尺寸</span>
                           <input 
                                type="number" 
                                value={settings.minSize} 
                                onChange={e => setSettings(s => ({...s, minSize: parseInt(e.target.value)}))}
                                className="w-12 text-xs border rounded px-1"
                           />
                       </div>

                       {/* Mask Toggle */}
                       <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer bg-slate-50 px-2 py-1.5 rounded border border-slate-200">
                           <input 
                                type="checkbox" 
                                checked={settings.circularMask} 
                                onChange={e => setSettings(s => ({...s, circularMask: e.target.checked}))}
                                className="rounded text-fuchsia-600 focus:ring-fuchsia-500"
                           />
                           圆形掩膜 (Dish Mask)
                       </label>
                   </div>
                   
                   {/* Mask Radius Adjustment */}
                   {settings.circularMask && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 px-1 mb-2">
                            <span>掩膜半径:</span>
                            <input 
                                type="range" min="0.5" max="1.0" step="0.01"
                                value={settings.maskRatio} 
                                onChange={e => setSettings(s => ({...s, maskRatio: parseFloat(e.target.value)}))}
                                className="flex-1 h-1.5 accent-yellow-400" 
                            />
                        </div>
                   )}

                   <div className="flex justify-end pt-2 border-t border-slate-100">
                        <button onClick={analyzeActiveImage} disabled={!activeImageId || isProcessing} className="bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-200 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors">
                            重新识别当前
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
                     <Info size={14} className="mt-0.5 shrink-0" />
                     <p>
                        <strong>提示：</strong> 开启“圆形掩膜”可以去除培养皿边缘的阴影干扰。如果克隆团颜色较浅，请提高“颜色深度”阈值。黄色圆圈表示掩膜范围，超出范围的区域不参与计数。
                     </p>
               </div>
           </div>

           {/* RIGHT: Stats */}
           <div className="lg:col-span-3 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <BarChart3 size={18} /> 统计结果
                   </h3>
                   
                   {groupStats.length > 0 ? (
                       <div className="h-[200px] w-full shrink-0 mb-4">
                           <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={groupStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                                    <Bar dataKey="mean" fill="#d946ef" radius={[4, 4, 0, 0]}>
                                        <ErrorBar dataKey="error" width={4} strokeWidth={2} stroke="#a21caf" />
                                        {groupStats.map((entry, index) => <Cell key={`cell-${index}`} fill={['#d946ef', '#8b5cf6', '#0ea5e9', '#f59e0b'][index % 4]} />)}
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
                                   <th className="py-2">Group</th>
                                   <th className="py-2 text-right">Count (Mean±SD)</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                               {groupStats.map(g => (
                                   <tr key={g.name}>
                                       <td className="py-2 font-medium text-slate-700">{g.name}</td>
                                       <td className="py-2 text-right text-fuchsia-600 font-mono font-bold">
                                           {g.mean} <span className="text-slate-400 text-[10px] font-normal">± {g.sd}</span>
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