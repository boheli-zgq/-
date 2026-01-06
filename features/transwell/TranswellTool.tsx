import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Target, Upload, Image as ImageIcon, Plus, Trash2, Sliders, Play, RefreshCw, Eye, Download, Info, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ErrorBar, Cell } from 'recharts';

// --- Types ---

interface DetectedCell {
  x: number;
  y: number;
  radius: number;
}

interface TranswellImage {
  id: string;
  name: string;
  group: string;
  src: string;
  count: number | null;
  cells: DetectedCell[];
  processed: boolean;
  width: number;
  height: number;
}

interface ProcessSettings {
  threshold: number; // 0-255, pixels darker than this are cells
  minSize: number; // minimum pixel count to be considered a cell
  maxSize: number; // max pixel count (to avoid artifacts)
  sensitivity: number; // 1-10
}

// --- Helpers for File Processing (TIFF Support) ---

const ensureUtifLoaded = async () => {
    if ((window as any).UTIF) return true;
    
    return new Promise<boolean>((resolve) => {
        // Try jsdelivr first
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js";
        script.crossOrigin = "anonymous";
        script.onload = () => resolve(true);
        script.onerror = () => {
             // Try fallback unpkg
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
    
    if (!isTiff) {
        return URL.createObjectURL(file);
    }

    try {
        const loaded = await ensureUtifLoaded();
        if (!loaded) {
            console.error("UTIF library failed to load");
            return null;
        }
        
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

// --- Image Processing Logic (Web Worker alternative running on main thread for simplicity) ---

const processImage = (
  img: HTMLImageElement,
  settings: ProcessSettings
): { count: number; cells: DetectedCell[] } => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { count: 0, cells: [] };

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  // 1. Grayscale & Binarization
  const binary = new Uint8Array(width * height); // 1 = cell, 0 = background
  const threshold = settings.threshold;

  for (let i = 0; i < data.length; i += 4) {
    // Standard luminosity method
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // In Transwell (e.g., Crystal Violet), cells are dark on light background.
    // So if gray < threshold, it's a cell.
    if (gray < threshold) {
      binary[i / 4] = 1;
    }
  }

  // 2. Connected Component Labeling (Simple BFS)
  const visited = new Uint8Array(width * height);
  const blobs: DetectedCell[] = [];
  const minSize = settings.minSize;
  const maxSize = settings.maxSize || width * height * 0.1; // Safety cap

  const getIdx = (x: number, y: number) => y * width + x;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIdx(x, y);
      if (binary[idx] === 1 && visited[idx] === 0) {
        // Start BFS for a new component
        const stack = [[x, y]];
        visited[idx] = 1;
        
        let minX = x, maxX = x, minY = y, maxY = y;
        let pixelCount = 0;

        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          pixelCount++;
          
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // Check 4-neighbors
          const neighbors = [
            [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
          ];

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

        // Filter blobs
        if (pixelCount >= minSize && pixelCount <= maxSize) {
          const w = maxX - minX;
          const h = maxY - minY;
          // Calculate approx radius based on area
          const radius = Math.sqrt(pixelCount / Math.PI);
          blobs.push({
            x: minX + w / 2,
            y: minY + h / 2,
            radius: Math.max(2, radius)
          });
        }
      }
    }
  }

  return { count: blobs.length, cells: blobs };
};


export const TranswellTool: React.FC = () => {
  const [images, setImages] = useState<TranswellImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Settings
  const [settings, setSettings] = useState<ProcessSettings>({
    threshold: 140, // Default for crystal violet
    minSize: 10,
    maxSize: 5000,
    sensitivity: 5
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Handlers ---

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);

    const newImages: TranswellImage[] = [];

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
              cells: [],
              processed: false,
              width: 0,
              height: 0
            });
        }
    }

    setImages(prev => [...prev, ...newImages]);
    if (!activeImageId && newImages.length > 0) {
      setActiveImageId(newImages[0].id);
    }
    
    setIsProcessing(false);
    e.target.value = '';
  };

  const removeImage = (id: string) => {
    const imgToRemove = images.find(img => img.id === id);
    if (imgToRemove && imgToRemove.src.startsWith('blob:')) {
        URL.revokeObjectURL(imgToRemove.src);
    }
    setImages(prev => prev.filter(img => img.id !== id));
    if (activeImageId === id) setActiveImageId(null);
  };

  const updateImageGroup = (id: string, group: string) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, group } : img));
  };

  // --- Core Action: Run Analysis ---

  const analyzeActiveImage = useCallback(() => {
    if (!activeImageId) return;
    const imgData = images.find(i => i.id === activeImageId);
    if (!imgData) return;

    setIsProcessing(true);

    // Use setTimeout to allow UI to render "Processing" state
    setTimeout(() => {
      const img = new Image();
      img.src = imgData.src;
      img.onload = () => {
        const result = processImage(img, settings);
        
        setImages(prev => prev.map(item => 
          item.id === activeImageId 
            ? { ...item, count: result.count, cells: result.cells, processed: true, width: img.width, height: img.height } 
            : item
        ));
        setIsProcessing(false);
      };
    }, 100);
  }, [activeImageId, images, settings]);

  const analyzeAll = () => {
    setIsProcessing(true);
    let processedCount = 0;
    
    // Process sequentially to avoid freezing
    const processNext = (index: number) => {
        if (index >= images.length) {
            setIsProcessing(false);
            return;
        }

        const imgData = images[index];
        const img = new Image();
        img.src = imgData.src;
        img.onload = () => {
            const result = processImage(img, settings);
            setImages(prev => prev.map(item => 
                item.id === imgData.id 
                ? { ...item, count: result.count, cells: result.cells, processed: true, width: img.width, height: img.height } 
                : item
            ));
            
            // Go to next
            setTimeout(() => processNext(index + 1), 10);
        };
    };

    processNext(0);
  };

  // --- Drawing Logic ---

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

        // Draw overlays if processed
        if (imgData.processed && imgData.cells.length > 0) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.4)'; // Red dot
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1;

            imgData.cells.forEach(cell => {
                ctx.beginPath();
                ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
        }
    };
  }, [activeImageId, images]); // Re-draw when images state updates (including processing results)


  // --- Stats Calculation ---

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
    let csvContent = "\uFEFF"; 
    csvContent += "Group,Image Name,Cell Count\n";
    images.forEach(img => {
        csvContent += `"${img.group}","${img.name}",${img.count || 0}\n`;
    });
    
    csvContent += "\nSummary Statistics\nGroup,Mean,SD\n";
    groupStats.forEach(g => {
        csvContent += `"${g.name}",${g.mean},${g.sd}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "Transwell_Results.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-indigo-100 p-3 rounded-2xl text-indigo-600">
                <Target size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">Transwell 细胞计数</h2>
               <p className="text-slate-500">自动识别迁移/侵袭细胞，批量统计分析</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 h-[calc(100vh-200px)] min-h-[600px]">
           
           {/* LEFT: Image List & Controls (3 cols) */}
           <div className="lg:col-span-3 flex flex-col gap-4 h-full">
                {/* Upload Area */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 shrink-0">
                    <input type="file" accept="image/jpeg,image/png,image/tiff,.tif,.tiff,.jpg,.jpeg,.png" onChange={handleUpload} multiple id="trans-upload" className="hidden" />
                    <label htmlFor="trans-upload" className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-dashed border-indigo-200 rounded-lg py-3 flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors">
                        <Upload size={18} /> 上传图片
                    </label>
                </div>

                {/* Image List */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col">
                    <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <span className="font-bold text-slate-700 text-sm">图片列表 ({images.length})</span>
                        <button onClick={() => setImages([])} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {images.length === 0 && (
                            <div className="text-center text-slate-400 text-sm mt-10 p-4">
                                请先上传 Transwell 拍摄图片
                            </div>
                        )}
                        {images.map(img => (
                            <div 
                                key={img.id} 
                                onClick={() => setActiveImageId(img.id)}
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${activeImageId === img.id ? 'bg-indigo-50 border-indigo-400 ring-1 ring-indigo-400' : 'bg-white border-slate-200 hover:border-indigo-200'}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-12 h-12 bg-slate-200 rounded overflow-hidden shrink-0">
                                        <img src={img.src} className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-slate-700 truncate" title={img.name}>{img.name}</div>
                                        <input 
                                            type="text" 
                                            value={img.group}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => updateImageGroup(img.id, e.target.value)}
                                            className="text-[10px] text-indigo-600 bg-transparent border-b border-transparent hover:border-indigo-200 focus:border-indigo-500 w-full outline-none mt-1"
                                            placeholder="Group Name"
                                        />
                                        <div className="flex items-center justify-between mt-1">
                                            <span className={`text-xs font-bold ${img.count !== null ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                {img.count !== null ? `${img.count} cells` : 'Pending'}
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
                            <button 
                                onClick={analyzeAll} 
                                disabled={isProcessing}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:bg-slate-300"
                            >
                                {isProcessing ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />}
                                批量分析
                            </button>
                        </div>
                    )}
                </div>
           </div>

           {/* CENTER: Image Preview & Settings (6 cols) */}
           <div className="lg:col-span-6 flex flex-col gap-4 h-full overflow-hidden">
               {/* Toolbar */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 flex items-center gap-4 flex-wrap">
                   <div className="flex items-center gap-2 text-sm text-slate-600">
                       <Sliders size={16} /> 识别参数:
                   </div>
                   <div className="flex items-center gap-2">
                       <span className="text-xs text-slate-500">阈值 (Darkness)</span>
                       <input 
                            type="range" min="1" max="250" 
                            value={settings.threshold} 
                            onChange={(e) => setSettings(s => ({ ...s, threshold: parseInt(e.target.value) }))}
                            className="w-24 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                       />
                       <span className="text-xs font-mono w-6 text-right">{settings.threshold}</span>
                   </div>
                   <div className="w-px h-4 bg-slate-300 mx-2"></div>
                   <div className="flex items-center gap-2">
                       <span className="text-xs text-slate-500">最小尺寸 (Px)</span>
                       <input 
                            type="number" min="1" 
                            value={settings.minSize} 
                            onChange={(e) => setSettings(s => ({ ...s, minSize: parseInt(e.target.value) }))}
                            className="w-12 text-xs border border-slate-300 rounded px-1 py-0.5"
                       />
                   </div>
                   <button 
                        onClick={analyzeActiveImage}
                        disabled={!activeImageId || isProcessing}
                        className="ml-auto bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                   >
                       重新识别当前
                   </button>
               </div>

               {/* Canvas View */}
               <div className="bg-slate-900 rounded-xl flex-1 overflow-hidden relative flex items-center justify-center border border-slate-800 group" ref={containerRef}>
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

               {/* Hint */}
               <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-lg flex gap-2 items-start border border-blue-100">
                     <Info size={14} className="mt-0.5 shrink-0" />
                     <p>调整"阈值"以匹配细胞颜色深度（数值越小越黑）。调整"最小尺寸"以过滤噪点杂质。参数调整后需点击“重新识别”生效。</p>
               </div>
           </div>

           {/* RIGHT: Stats (3 cols) */}
           <div className="lg:col-span-3 flex flex-col gap-4 h-full overflow-hidden">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex-1 flex flex-col">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <BarChart3 size={18} /> 统计结果
                   </h3>

                   {groupStats.length > 0 ? (
                       <>
                           <div className="h-[200px] w-full shrink-0 mb-4">
                               <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={groupStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                        <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                                        <Bar dataKey="mean" fill="#6366f1" radius={[4, 4, 0, 0]}>
                                            <ErrorBar dataKey="error" width={4} strokeWidth={2} stroke="#4338ca" />
                                            {groupStats.map((entry, index) => <Cell key={`cell-${index}`} fill={['#6366f1', '#ec4899', '#10b981', '#f59e0b'][index % 4]} />)}
                                        </Bar>
                                    </BarChart>
                               </ResponsiveContainer>
                           </div>

                           <div className="flex-1 overflow-y-auto border-t border-slate-100 pt-2">
                               <table className="w-full text-xs text-left">
                                   <thead className="text-slate-500">
                                       <tr>
                                           <th className="py-2">Group</th>
                                           <th className="py-2 text-right">Mean ± SD</th>
                                       </tr>
                                   </thead>
                                   <tbody className="divide-y divide-slate-100">
                                       {groupStats.map(g => (
                                           <tr key={g.name}>
                                               <td className="py-2 font-medium text-slate-700">{g.name}</td>
                                               <td className="py-2 text-right text-indigo-600 font-mono">
                                                   {g.mean} <span className="text-slate-400">± {g.sd}</span>
                                               </td>
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