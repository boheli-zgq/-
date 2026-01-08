import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Network, Upload, Trash2, Sliders, Play, RefreshCw, Eye, Download, Info, BarChart3, Scissors, Eraser, Lightbulb } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { processImageFile } from '../../services/imageUtils';

// --- Types ---

interface AngioImage {
  id: string;
  name: string;
  group: string;
  src: string;
  
  // Metrics
  totalLength: number | null; // px
  junctions: number | null;
  endpoints: number | null;
  meshes: number | null; // loops
  
  // Visualization Data
  skeleton: Uint8Array | null; // Flattened binary array (0 or 1)
  width: number;
  height: number;
  
  processed: boolean;
}

interface ProcessSettings {
  adaptive: boolean; // New: Adaptive Thresholding
  threshold: number; // 0-255 (Global) OR Sensitivity (Adaptive)
  invert: boolean; // True for dark tubes on bright bg (Phase contrast)
  blurRadius: number; // Smoothness (0-5)
  minBlobSize: number; // Despeckle
  pruneLength: number; // Pruning
}

// --- Algorithms ---

// Optimized Sliding Window Box Blur (O(1) per pixel independent of radius)
// Used for background estimation in Adaptive Thresholding
const fastBoxBlur = (src: Uint8Array, width: number, height: number, radius: number): Uint8Array => {
    if (radius < 1) return new Uint8Array(src);
    
    const size = width * height;
    const target = new Uint8Array(size);
    const temp = new Float32Array(size);
    const div = radius * 2 + 1;
    
    // Horizontal pass
    for (let y = 0; y < height; y++) {
        let rowStart = y * width;
        let sum = 0;
        
        // Initial window setup (clamp to edge)
        for (let i = -radius; i <= radius; i++) {
            sum += src[rowStart + Math.min(width - 1, Math.max(0, i))];
        }
        
        for (let x = 0; x < width; x++) {
            temp[rowStart + x] = sum / div;
            
            // Move window: subtract leaving pixel, add entering pixel
            const leftOut = src[rowStart + Math.max(0, x - radius)];
            const rightIn = src[rowStart + Math.min(width - 1, x + radius + 1)];
            sum = sum - leftOut + rightIn;
        }
    }

    // Vertical pass
    for (let x = 0; x < width; x++) {
        let sum = 0;
        // Initial window
        for (let i = -radius; i <= radius; i++) {
            sum += temp[Math.min(height - 1, Math.max(0, i)) * width + x];
        }
        
        for (let y = 0; y < height; y++) {
            target[y * width + x] = sum / div;
            
            const topOut = temp[Math.max(0, y - radius) * width + x];
            const bottomIn = temp[Math.min(height - 1, y + radius + 1) * width + x];
            sum = sum - topOut + bottomIn;
        }
    }
    return target;
};

// Simple Gaussian Blur (Small radius) for pre-smoothing
const applySmallBlur = (data: Uint8Array, width: number, height: number, radius: number) => {
    if (radius < 1) return data;
    return fastBoxBlur(data, width, height, radius); 
};

// 2. Zhang-Suen Thinning Algorithm
const thinningZhangSuen = (data: Uint8Array, width: number, height: number): Uint8Array => {
    const skeleton = new Uint8Array(data); // Copy
    let changing = true;

    const getPixel = (arr: Uint8Array, x: number, y: number) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        return arr[y * width + x];
    };

    while (changing) {
        changing = false;
        for (let sub = 0; sub < 2; sub++) {
            const markers: number[] = [];
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    if (getPixel(skeleton, x, y) === 0) continue;

                    const p2 = getPixel(skeleton, x, y - 1);
                    const p3 = getPixel(skeleton, x + 1, y - 1);
                    const p4 = getPixel(skeleton, x + 1, y);
                    const p5 = getPixel(skeleton, x + 1, y + 1);
                    const p6 = getPixel(skeleton, x, y + 1);
                    const p7 = getPixel(skeleton, x - 1, y + 1);
                    const p8 = getPixel(skeleton, x - 1, y);
                    const p9 = getPixel(skeleton, x - 1, y - 1);

                    const A = (p2 === 0 && p3 === 1 ? 1 : 0) +
                              (p3 === 0 && p4 === 1 ? 1 : 0) +
                              (p4 === 0 && p5 === 1 ? 1 : 0) +
                              (p5 === 0 && p6 === 1 ? 1 : 0) +
                              (p6 === 0 && p7 === 1 ? 1 : 0) +
                              (p7 === 0 && p8 === 1 ? 1 : 0) +
                              (p8 === 0 && p9 === 1 ? 1 : 0) +
                              (p9 === 0 && p2 === 1 ? 1 : 0);
                    
                    const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                    
                    let m1, m2;
                    if (sub === 0) {
                        m1 = p2 * p4 * p6;
                        m2 = p4 * p6 * p8;
                    } else {
                        m1 = p2 * p4 * p8;
                        m2 = p2 * p6 * p8;
                    }

                    if (A === 1 && (B >= 2 && B <= 6) && m1 === 0 && m2 === 0) {
                        markers.push(y * width + x);
                    }
                }
            }
            if (markers.length > 0) {
                changing = true;
                for (const idx of markers) skeleton[idx] = 0;
            }
        }
    }
    return skeleton;
};

// 3. Pruning Algorithm
const pruneSkeleton = (skeleton: Uint8Array, width: number, height: number, pruneLen: number) => {
    if (pruneLen <= 0) return skeleton;
    const temp = new Uint8Array(skeleton);
    
    for (let k = 0; k < pruneLen; k++) {
        const toRemove: number[] = [];
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (temp[idx] === 1) {
                    let neighbors = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            if (temp[(y + dy) * width + (x + dx)] === 1) neighbors++;
                        }
                    }
                    if (neighbors === 1) toRemove.push(idx);
                }
            }
        }
        if (toRemove.length === 0) break;
        for (const idx of toRemove) temp[idx] = 0;
    }
    return temp;
};

// 4. Analyze Graph
const analyzeSkeleton = (skeleton: Uint8Array, width: number, height: number) => {
    let totalLength = 0;
    let junctions = 0;
    let endpoints = 0;
    
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            if (skeleton[y * width + x] === 1) {
                totalLength++;
                let neighbors = 0;
                for(let dy = -1; dy <= 1; dy++) {
                    for(let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        if (skeleton[(y + dy) * width + (x + dx)] === 1) neighbors++;
                    }
                }
                if (neighbors === 1) endpoints++;
                if (neighbors > 2) junctions++;
            }
        }
    }

    // Meshes (Connected Components of Background)
    const visited = new Uint8Array(width * height);
    let bgComponents = 0;
    
    for(let i=0; i<width*height; i++) {
        if (skeleton[i] === 0 && visited[i] === 0) {
            bgComponents++;
            const stack = [i];
            visited[i] = 1;
            while(stack.length > 0) {
                const idx = stack.pop()!;
                const cx = idx % width;
                const cy = Math.floor(idx / width);
                
                // 4-connectivity for background
                const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
                if (cx > 0 && skeleton[idx - 1] === 0 && visited[idx - 1] === 0) { visited[idx - 1] = 1; stack.push(idx - 1); }
                if (cx < width - 1 && skeleton[idx + 1] === 0 && visited[idx + 1] === 0) { visited[idx + 1] = 1; stack.push(idx + 1); }
                if (cy > 0 && skeleton[idx - width] === 0 && visited[idx - width] === 0) { visited[idx - width] = 1; stack.push(idx - width); }
                if (cy < height - 1 && skeleton[idx + width] === 0 && visited[idx + width] === 0) { visited[idx + width] = 1; stack.push(idx + width); }
            }
        }
    }
    const meshes = Math.max(0, bgComponents - 1);

    return { totalLength, junctions, endpoints, meshes };
};

// Filter Blobs (Despeckle)
const removeSmallBlobs = (binary: Uint8Array, width: number, height: number, minSize: number) => {
    const visited = new Uint8Array(width * height);
    
    for (let i = 0; i < width * height; i++) {
        if (binary[i] === 1 && visited[i] === 0) {
            const stack = [i];
            const componentIndices = [i];
            visited[i] = 1;
            
            while(stack.length > 0) {
                const idx = stack.pop()!;
                const cx = idx % width;
                const cy = Math.floor(idx / width);
                
                // 8-connectivity
                for(let dy=-1; dy<=1; dy++) {
                    for(let dx=-1; dx<=1; dx++) {
                        if(dx===0 && dy===0) continue;
                        const nx = cx + dx;
                        const ny = cy + dy;
                        if (nx>=0 && nx<width && ny>=0 && ny<height) {
                            const nIdx = ny * width + nx;
                            if (binary[nIdx] === 1 && visited[nIdx] === 0) {
                                visited[nIdx] = 1;
                                stack.push(nIdx);
                                componentIndices.push(nIdx);
                            }
                        }
                    }
                }
            }
            
            if (componentIndices.length < minSize) {
                for (const idx of componentIndices) binary[idx] = 0;
            }
        }
    }
};

const processImage = (img: HTMLImageElement, settings: ProcessSettings) => {
    // 1. Prepare Canvas
    const MAX_DIM = 800;
    let w = img.width;
    let h = img.height;
    if (w > MAX_DIM || h > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.floor(w * scale);
        h = Math.floor(h * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas init failed");
    
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    
    // Extract Grayscale
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const r = imgData.data[i * 4];
        const g = imgData.data[i * 4 + 1];
        const b = imgData.data[i * 4 + 2];
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // 2. Pre-smooth (Noise Reduction)
    let processedGray = applySmallBlur(gray, w, h, settings.blurRadius);
    
    // 3. Binarize (Adaptive vs Global)
    const binary = new Uint8Array(w * h);
    
    if (settings.adaptive) {
        // Adaptive Thresholding (Local Mean)
        // 1. Calculate local background using large box blur
        const radius = 25; // Large radius for background estimation
        const background = fastBoxBlur(processedGray, w, h, radius);
        
        // 2. Compare
        const sensitivity = settings.threshold; // reused slider as sensitivity (0-100)
        // Sensitivity maps to an offset. 
        // Higher sensitivity = smaller offset required = more noise but detects faint tubes.
        // Lower sensitivity = larger offset required = strict.
        
        // Let's invert the slider logic for intuition: 
        // Slider "Sensitivity": High (100) -> detects everything (offset 0). Low (0) -> detects only strong (offset 30).
        // Actually, user expects "Threshold" slider.
        // Let's stick to "Threshold/Sensitivity" as a value C.
        // Condition: Tube is darker than Background.
        // Tube < Background - C.
        // If C is small, we detect faint tubes. If C is large, we detect only strong tubes.
        
        const C = Math.max(2, 30 - (sensitivity * 0.3)); // Map 0-100 slider to C range ~30 to 0.
        
        for (let i = 0; i < w * h; i++) {
            const diff = background[i] - processedGray[i];
            // If invert=true (Phase contrast, dark tubes), diff should be positive (bg > tube)
            // If invert=false (Fluorescence, bright tubes), diff should be negative (bg < tube) -> Tube > Bg + C
            
            if (settings.invert) {
                // Dark tubes
                binary[i] = diff > C ? 1 : 0;
            } else {
                // Bright tubes
                binary[i] = (processedGray[i] > background[i] + C) ? 1 : 0;
            }
        }
    } else {
        // Global Thresholding
        for (let i = 0; i < w * h; i++) {
            const val = settings.invert 
                ? (processedGray[i] < settings.threshold ? 1 : 0) // Dark tubes on bright bg
                : (processedGray[i] > settings.threshold ? 1 : 0); // Bright tubes on dark bg
            binary[i] = val;
        }
    }

    // 4. Despeckle (Remove small blobs before thinning)
    removeSmallBlobs(binary, w, h, settings.minBlobSize);

    // 5. Skeletonize
    let skeleton = thinningZhangSuen(binary, w, h);

    // 6. Prune (Remove short spurs)
    if (settings.pruneLength > 0) {
        skeleton = pruneSkeleton(skeleton, w, h, settings.pruneLength);
    }

    // 7. Analyze
    const stats = analyzeSkeleton(skeleton, w, h);

    return { ...stats, skeleton, width: w, height: h };
};


export const AngiogenesisTool: React.FC = () => {
  const [images, setImages] = useState<AngioImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Settings
  const [settings, setSettings] = useState<ProcessSettings>({
    adaptive: false, // Default to Global, let user toggle if needed
    threshold: 110,
    invert: true, 
    blurRadius: 1, // Default smoothness
    minBlobSize: 30, // Default noise filter
    pruneLength: 8 // Default pruning
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Handlers ---

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);

    const newImages: AngioImage[] = [];
    for (let i = 0; i < files.length; i++) {
        const src = await processImageFile(files[i]);
        if (src) {
            newImages.push({
              id: Date.now() + i + Math.random().toString(),
              name: files[i].name,
              group: 'Group 1',
              src: src,
              totalLength: null,
              junctions: null,
              endpoints: null,
              meshes: null,
              skeleton: null,
              width: 0,
              height: 0,
              processed: false
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
            const result = processImage(img, settings);
            setImages(prev => prev.map(item => 
              item.id === activeImageId 
                ? { ...item, ...result, processed: true } 
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
            const result = processImage(img, settings);
            setImages(prev => prev.map(item => 
                item.id === imgData.id 
                ? { ...item, ...result, processed: true } 
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
        const w = imgData.width || img.width;
        const h = imgData.height || img.height;
        
        canvas.width = w;
        canvas.height = h;
        
        ctx.drawImage(img, 0, 0, w, h);

        // Overlay Skeleton
        if (imgData.processed && imgData.skeleton) {
            const skel = imgData.skeleton;
            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;
            
            // Draw skeleton in Red
            for(let i=0; i<w*h; i++) {
                if (skel[i] === 1) {
                    const idx = i * 4;
                    data[idx] = 255;   // R
                    data[idx+1] = 0;   // G
                    data[idx+2] = 0;   // B
                    data[idx+3] = 255; // A
                }
            }
            ctx.putImageData(imageData, 0, 0);

            // Draw Junctions (Blue) & Endpoints (Green)
            ctx.fillStyle = '#3b82f6'; // Blue Junctions
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    if (skel[y * w + x] === 1) {
                        let n = 0;
                        for(let dy=-1; dy<=1; dy++) 
                            for(let dx=-1; dx<=1; dx++) 
                                if((dx!==0||dy!==0) && skel[(y+dy)*w + (x+dx)] === 1) n++;
                        
                        if (n > 2) ctx.fillRect(x-1, y-1, 3, 3);
                    }
                }
            }
            
            ctx.fillStyle = '#22c55e'; // Green Endpoints
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    if (skel[y * w + x] === 1) {
                        let n = 0;
                        for(let dy=-1; dy<=1; dy++) 
                            for(let dx=-1; dx<=1; dx++) 
                                if((dx!==0||dy!==0) && skel[(y+dy)*w + (x+dx)] === 1) n++;
                        
                        if (n === 1) ctx.fillRect(x-1, y-1, 3, 3);
                    }
                }
            }
        }
    };
  }, [activeImageId, images]); 

  // --- Stats Export ---

  const groupStats = useMemo(() => {
      const groups: Record<string, { totalLen: number; junc: number; mesh: number; count: number }> = {};
      images.filter(i => i.processed).forEach(img => {
          if (!groups[img.group]) groups[img.group] = { totalLen: 0, junc: 0, mesh: 0, count: 0 };
          groups[img.group].totalLen += img.totalLength || 0;
          groups[img.group].junc += img.junctions || 0;
          groups[img.group].mesh += img.meshes || 0;
          groups[img.group].count++;
      });

      return Object.entries(groups).map(([name, stats]) => ({
          name,
          meanLen: parseFloat((stats.totalLen / stats.count).toFixed(0)),
          meanJunc: parseFloat((stats.junc / stats.count).toFixed(1)),
          meanMesh: parseFloat((stats.mesh / stats.count).toFixed(1))
      }));
  }, [images]);

  const handleExportCsv = () => {
    let csv = "\uFEFFGroup,Image Name,Total Length (px),Junctions,Endpoints,Meshes (Loops)\n";
    images.forEach(img => {
        csv += `"${img.group}","${img.name}",${img.totalLength || 0},${img.junctions || 0},${img.endpoints || 0},${img.meshes || 0}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Angiogenesis_Results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-red-100 p-3 rounded-2xl text-red-600">
                <Network size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">血管生成分析 (Tube Formation)</h2>
               <p className="text-slate-500">自动识别血管生成实验中的管腔网络，计算总管长、节点数与成环数</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px]">
           
           {/* LEFT: Controls */}
           <div className="lg:col-span-3 flex flex-col gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                    <input type="file" accept="image/*,.tif,.tiff" onChange={handleUpload} multiple id="angio-upload" className="hidden" />
                    <label htmlFor="angio-upload" className="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-dashed border-red-200 rounded-lg py-3 flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors">
                        <Upload size={18} /> 上传实验图片
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
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${activeImageId === img.id ? 'bg-red-50 border-red-400 ring-1 ring-red-400' : 'bg-white border-slate-200 hover:border-red-200'}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-12 h-12 bg-slate-200 rounded overflow-hidden shrink-0 relative">
                                        <img src={img.src} className="w-full h-full object-cover" />
                                        {img.processed && <div className="absolute inset-0 bg-red-500/10" />}
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
                                            <span className={`text-[10px] font-bold ${img.totalLength !== null ? 'text-red-600' : 'text-slate-400'}`}>
                                                {img.totalLength !== null ? `Len: ${img.totalLength}` : 'Pending'}
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
                            <button onClick={analyzeAll} disabled={isProcessing} className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:bg-slate-300">
                                {isProcessing ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />} 批量分析
                            </button>
                        </div>
                    )}
                </div>
           </div>

           {/* CENTER: Settings & Preview */}
           <div className="lg:col-span-6 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
                   <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-sm text-slate-600 font-bold">
                           <Sliders size={16} /> 识别参数:
                        </div>
                        <div className="flex gap-2">
                            {/* Adaptive Toggle */}
                            <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer bg-amber-50 border border-amber-200 px-2 py-1 rounded hover:bg-amber-100 transition-colors">
                                <input 
                                        type="checkbox" 
                                        checked={settings.adaptive} 
                                        onChange={e => setSettings(s => ({...s, adaptive: e.target.checked}))}
                                        className="rounded text-amber-600 focus:ring-amber-500"
                                />
                                自适应阈值 (Adaptive)
                            </label>
                            
                            {/* Invert */}
                            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer bg-slate-50 px-2 py-1 rounded border border-slate-200">
                                <input 
                                        type="checkbox" 
                                        checked={settings.invert} 
                                        onChange={e => setSettings(s => ({...s, invert: e.target.checked}))}
                                        className="rounded text-red-600 focus:ring-red-500"
                                />
                                相差模式 (Phase Contrast)
                            </label>
                        </div>
                   </div>
                   
                   <div className="space-y-3 px-1">
                       {/* Threshold */}
                       <div className="flex items-center gap-2" title={settings.adaptive ? "Sensitivity to local contrast" : "Global binary threshold"}>
                           <span className={`text-xs w-16 text-right font-medium ${settings.adaptive ? 'text-amber-600' : 'text-slate-500'}`}>
                               {settings.adaptive ? '灵敏度' : '灰度阈值'}
                           </span>
                           <input 
                                type="range" min="1" max={settings.adaptive ? "100" : "255"} 
                                value={settings.threshold} 
                                onChange={e => setSettings(s => ({...s, threshold: parseInt(e.target.value)}))}
                                className={`flex-1 h-1.5 rounded-lg ${settings.adaptive ? 'accent-amber-500 bg-amber-100' : 'accent-red-500 bg-slate-200'}`} 
                           />
                           <span className="text-xs font-mono w-6">{settings.threshold}</span>
                       </div>

                       {/* Blur Radius */}
                       <div className="flex items-center gap-2" title="Pre-processing smoothness to remove grainy noise">
                           <span className="text-xs text-slate-500 w-16 text-right">平滑度</span>
                           <input 
                                type="range" min="0" max="5" 
                                value={settings.blurRadius} 
                                onChange={e => setSettings(s => ({...s, blurRadius: parseInt(e.target.value)}))}
                                className="flex-1 h-1.5 accent-blue-500 bg-slate-200 rounded-lg" 
                           />
                           <span className="text-xs font-mono w-6">{settings.blurRadius}</span>
                       </div>

                       {/* Min Blob Size (Despeckle) */}
                       <div className="flex items-center gap-2" title="Remove small objects (noise) before skeletonization">
                           <span className="text-xs text-slate-500 w-16 text-right">去噪斑</span>
                           <input 
                                type="range" min="0" max="200" step="10"
                                value={settings.minBlobSize} 
                                onChange={e => setSettings(s => ({...s, minBlobSize: parseInt(e.target.value)}))}
                                className="flex-1 h-1.5 accent-orange-500 bg-slate-200 rounded-lg" 
                           />
                           <Eraser size={12} className="text-orange-400" />
                       </div>

                       {/* Prune Length */}
                       <div className="flex items-center gap-2" title="Remove short branches (spurs) from skeleton">
                           <span className="text-xs text-slate-500 w-16 text-right">修剪毛刺</span>
                           <input 
                                type="range" min="0" max="30" 
                                value={settings.pruneLength} 
                                onChange={e => setSettings(s => ({...s, pruneLength: parseInt(e.target.value)}))}
                                className="flex-1 h-1.5 accent-purple-500 bg-slate-200 rounded-lg" 
                           />
                           <Scissors size={12} className="text-purple-400" />
                       </div>
                   </div>
                   
                   <div className="flex justify-end pt-3 border-t border-slate-100 mt-2">
                        <button onClick={analyzeActiveImage} disabled={!activeImageId || isProcessing} className="bg-red-100 text-red-700 hover:bg-red-200 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors">
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
                     <Lightbulb size={14} className="mt-0.5 shrink-0 text-amber-500" />
                     <div>
                        <p className="mb-1"><strong>识别优化建议：</strong></p>
                        <p className="mb-1">1. 遇到图片光照不均（如中间亮、四周暗）导致边缘血管无法识别时，请勾选 <b>“自适应阈值”</b>。</p>
                        <p className="mb-1">2. 开启自适应后，调节 <b>“灵敏度”</b>：数值越高，对微弱对比度的血管识别能力越强（但也可能引入噪点）。</p>
                     </div>
               </div>
           </div>

           {/* RIGHT: Stats */}
           <div className="lg:col-span-3 flex flex-col gap-4">
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col">
                   <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                       <BarChart3 size={18} /> 总管长比较
                   </h3>
                   
                   {groupStats.length > 0 ? (
                       <div className="h-[200px] w-full shrink-0 mb-4">
                           <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={groupStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                                    <Bar dataKey="meanLen" fill="#dc2626" radius={[4, 4, 0, 0]} name="Length">
                                        {groupStats.map((entry, index) => <Cell key={`cell-${index}`} fill={['#dc2626', '#ea580c', '#0ea5e9', '#8b5cf6'][index % 4]} />)}
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
                                   <th className="py-2 text-right">Length</th>
                                   <th className="py-2 text-right">Juncs</th>
                                   <th className="py-2 text-right">Loops</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                               {images.map(img => (
                                   <tr key={img.id} className={activeImageId === img.id ? "bg-red-50" : ""}>
                                       <td className="py-2 font-medium text-slate-700 max-w-[60px] truncate" title={img.name}>{img.name}</td>
                                       <td className="py-2 text-right text-slate-600 font-mono">
                                           {img.totalLength || '-'}
                                       </td>
                                       <td className="py-2 text-right text-slate-600 font-mono">
                                           {img.junctions || '-'}
                                       </td>
                                       <td className="py-2 text-right text-red-600 font-mono font-bold">
                                           {img.meshes || '-'}
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                   </div>
                   
                   <button onClick={handleExportCsv} className="w-full mt-4 bg-slate-800 hover:bg-slate-900 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                       <Download size={14} /> 导出 CSV
                   </button>
               </div>
           </div>
       </div>
    </div>
  );
};