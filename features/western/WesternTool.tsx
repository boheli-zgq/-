import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Upload, Plus, Trash2, Maximize, Check, BarChart3, AlertCircle, RotateCcw, Activity, Image as ImageIcon, X, Download, Undo, Redo, Copy, Move, GripHorizontal, ScanLine, BoxSelect, Sliders, MousePointer2, Crop, CheckSquare, Merge, ArrowRightLeft } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ErrorBar, Cell } from 'recharts';

// --- Types ---

interface WbImage {
  id: string;
  src: string;
  name: string;
}

interface Roi {
  imageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WbSample {
  id: string;
  name: string;
  group: string; // Added for biological replicates
  isControl: boolean;
  targetRoi?: Roi;
  refRoi?: Roi;
  // Computed values
  targetDensity?: number;
  refDensity?: number;
  normalizedRatio?: number; // Target / Ref
  relativeExpression?: number; // Ratio / Control_Ratio
}

interface HitResult {
  sampleId: string;
  type: 'target' | 'ref';
  handle: 'nw' | 'ne' | 'se' | 'sw' | 'center';
}

// History Snapshot
type HistoryState = WbSample[];

interface DragState {
  mode: 'none' | 'drawing' | 'moving' | 'resizing' | 'region_selecting';
  startPos: { x: number; y: number };
  // For moving/resizing/drawing samples
  targetSampleId?: string;
  targetRoiType?: 'target' | 'ref';
  initialRoi?: Roi;
  handle?: 'nw' | 'ne' | 'sw' | 'se';
  // For region selecting
  currentRect?: { x: number, y: number, w: number, h: number };
}

// --- Helper Functions ---

const calculateDensityFromImage = (
  img: HTMLImageElement,
  roi: Roi
): number => {
  if (roi.w <= 0 || roi.h <= 0) return 0;
  
  const canvas = document.createElement('canvas');
  canvas.width = roi.w;
  canvas.height = roi.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;

  try {
      ctx.drawImage(img, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
      const imageData = ctx.getImageData(0, 0, roi.w, roi.h);
      const data = imageData.data;
      let totalDensity = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const density = 255 - gray; // Assuming dark bands on light background
        totalDensity += density;
      }
      return totalDensity;
  } catch (e: any) {
      console.warn("Error calculating density (ROI likely out of bounds)", e);
      return 0;
  }
};

// --- Main Component ---

export const WesternTool: React.FC = () => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [wbImages, setWbImages] = useState<WbImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Detection Settings
  const [detectionThreshold, setDetectionThreshold] = useState<number>(180); // 0-255, pixels darker than this are considered bands
  const [detectType, setDetectType] = useState<'target' | 'ref'>('target');
  const [toolMode, setToolMode] = useState<'select' | 'region_detect'>('select');
  const [matchExisting, setMatchExisting] = useState<boolean>(true); // New: Match existing samples by order
  
  // Samples State with History
  const [samples, setSamples] = useState<WbSample[]>([
    { id: '1', name: 'Sample 1', group: 'Control', isControl: true },
    { id: '2', name: 'Sample 2', group: 'Control', isControl: true },
    { id: '3', name: 'Sample 3', group: 'Treated', isControl: false },
    { id: '4', name: 'Sample 4', group: 'Treated', isControl: false },
  ]);
  
  // Selection for Merging
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<string>>(new Set());

  const [history, setHistory] = useState<HistoryState[]>([samples]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Annotation State
  const [activeAnnotation, setActiveAnnotation] = useState<{ sampleId: string; type: 'target' | 'ref' } | null>(null);
  
  // Canvas Interaction State
  const [dragState, setDragState] = useState<DragState>({ mode: 'none', startPos: { x: 0, y: 0 } });
  const [hoveredRoi, setHoveredRoi] = useState<{ sampleId: string; type: 'target' | 'ref'; handle?: string } | null>(null);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  
  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      wbImages.forEach(img => {
          if (img.src.startsWith('blob:')) {
              URL.revokeObjectURL(img.src);
          }
      });
    };
  }, []);

  // --- Undo/Redo Logic ---

  const pushToHistory = (newSamples: WbSample[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newSamples);
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setSamples(newSamples);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setSamples(history[newIndex]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setSamples(history[newIndex]);
    }
  };

  const updateSamples = (newSamples: WbSample[], addToHistory = true) => {
      setSamples(newSamples);
      if (addToHistory) {
          pushToHistory(newSamples);
      }
  };

  // --- Auto Detection Logic ---

  const autoDetectBands = useCallback((bounds?: { x: number, y: number, w: number, h: number }) => {
    if (!activeImageId || !canvasRef.current) return;
    const img = imageCacheRef.current.get(activeImageId);
    if (!img) return;

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { width, height, data } = imageData;

    const startX = bounds ? Math.max(0, Math.floor(bounds.x)) : 0;
    const startY = bounds ? Math.max(0, Math.floor(bounds.y)) : 0;
    const endX = bounds ? Math.min(width, Math.ceil(bounds.x + bounds.w)) : width;
    const endY = bounds ? Math.min(height, Math.ceil(bounds.y + bounds.h)) : height;

    const visited = new Uint8Array(width * height);
    const blobs: { x: number, y: number, w: number, h: number, size: number }[] = [];
    const getIdx = (x: number, y: number) => (y * width + x) * 4;

    for (let y = startY; y < endY; y += 2) { 
        for (let x = startX; x < endX; x += 2) {
            const idx = getIdx(x, y);
            const intensity = (data[idx] + data[idx+1] + data[idx+2]) / 3;
            if (intensity < detectionThreshold && visited[y * width + x] === 0) {
                let minX = x, maxX = x, minY = y, maxY = y;
                let pixelCount = 0;
                const stack = [[x, y]];
                visited[y * width + x] = 1;

                while (stack.length > 0) {
                    const [cx, cy] = stack.pop()!;
                    pixelCount++;
                    if (cx < minX) minX = cx;
                    if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy;
                    if (cy > maxY) maxY = cy;
                    const neighbors = [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]];
                    for (const [nx, ny] of neighbors) {
                        const inBounds = nx >= startX && nx < endX && ny >= startY && ny < endY;
                        if (inBounds && visited[ny * width + nx] === 0) {
                             const nIdx = getIdx(nx, ny);
                             const nInt = (data[nIdx] + data[nIdx+1] + data[nIdx+2]) / 3;
                             if (nInt < detectionThreshold) {
                                 visited[ny * width + nx] = 1;
                                 stack.push([nx, ny]);
                             }
                        }
                    }
                }
                if (pixelCount > 120 && (maxX - minX) > 12 && (maxY - minY) > 6) {
                    blobs.push({
                        x: minX, y: minY, w: maxX - minX, h: maxY - minY, size: pixelCount
                    });
                }
            }
        }
    }

    if (blobs.length === 0) {
        alert(bounds ? "选区内未检测到条带。" : "未检测到条带，请尝试调高'检测灵敏度'阈值。");
        return;
    }

    // Smart Sort: Determine orientation
    // If range of X > range of Y, assume Horizontal layout (sort by X)
    // If range of Y > range of X, assume Vertical layout (sort by Y)
    let minBx = Infinity, maxBx = -Infinity, minBy = Infinity, maxBy = -Infinity;
    blobs.forEach(b => {
        if(b.x < minBx) minBx = b.x;
        if(b.x > maxBx) maxBx = b.x;
        if(b.y < minBy) minBy = b.y;
        if(b.y > maxBy) maxBy = b.y;
    });
    const rangeX = maxBx - minBx;
    const rangeY = maxBy - minBy;
    
    if (rangeX > rangeY) {
        blobs.sort((a, b) => a.x - b.x); // Left to Right
    } else {
        blobs.sort((a, b) => a.y - b.y); // Top to Bottom
    }

    // Calculate Box Size
    const sortedW = [...blobs].sort((a, b) => a.w - b.w);
    const sortedH = [...blobs].sort((a, b) => a.h - b.h);
    const medianW = sortedW[Math.floor(sortedW.length / 2)].w;
    const medianH = sortedH[Math.floor(sortedH.length / 2)].h;
    const boxW = medianW * 1.2;
    const boxH = medianH * 1.5;

    // --- Update Logic ---
    let updatedSamples = [...samples];
    const roiField = detectType === 'target' ? 'targetRoi' : 'refRoi';

    if (matchExisting && samples.length > 0) {
        // Match Mode: Update existing samples in order
        blobs.forEach((blob, index) => {
            const centerX = blob.x + blob.w / 2;
            const centerY = blob.y + blob.h / 2;
            const roi: Roi = {
                imageId: activeImageId,
                x: centerX - boxW / 2,
                y: centerY - boxH / 2,
                w: boxW,
                h: boxH
            };

            if (index < updatedSamples.length) {
                // Update existing
                updatedSamples[index] = {
                    ...updatedSamples[index],
                    [roiField]: roi
                };
            } else {
                // Create new if more bands than samples
                updatedSamples.push({
                    id: Date.now().toString() + index + Math.random().toString().slice(2,5),
                    name: `Sample ${updatedSamples.length + 1}`,
                    group: 'Auto-Group',
                    isControl: false,
                    [roiField]: roi,
                });
            }
        });
        updateSamples(updatedSamples);
    } else {
        // Original Mode: Create NEW samples or Append
        const newSamples: WbSample[] = blobs.map((blob, index) => {
            const centerX = blob.x + blob.w / 2;
            const centerY = blob.y + blob.h / 2;
            const roi: Roi = {
                imageId: activeImageId,
                x: centerX - boxW / 2,
                y: centerY - boxH / 2,
                w: boxW,
                h: boxH
            };
            return {
                id: Date.now().toString() + index + Math.random().toString().slice(2,5),
                name: `Band ${samples.length + index + 1}`,
                group: 'Auto-Group',
                isControl: samples.length === 0 && index === 0, 
                [roiField]: roi,
            };
        });

        if (bounds) {
             // Region mode: Just append if not matching
             updateSamples([...samples, ...newSamples]);
        } else {
            // Full auto: ask to replace
            if (confirm(`检测到 ${blobs.length} 个条带。是否清空当前列表并重新生成？\n(取消则追加)`)) {
                updateSamples(newSamples);
            } else {
                updateSamples([...samples, ...newSamples]);
            }
        }
    }

  }, [activeImageId, detectionThreshold, detectType, samples, matchExisting]);


  const applyUniformSize = () => {
      if (!activeAnnotation) {
          alert("请先选中一个标准的选区（点击选区框），然后点击此按钮将其他选区调整为相同大小。");
          return;
      }
      const sourceSample = samples.find(s => s.id === activeAnnotation.sampleId);
      const sourceRoi = activeAnnotation.type === 'target' ? sourceSample?.targetRoi : sourceSample?.refRoi;
      if (!sourceRoi) return;

      const newSamples = samples.map(s => {
          const updates: Partial<WbSample> = {};
          if (s.targetRoi && s.targetRoi.imageId === activeImageId) {
              const centerX = s.targetRoi.x + s.targetRoi.w / 2;
              const centerY = s.targetRoi.y + s.targetRoi.h / 2;
              updates.targetRoi = { ...s.targetRoi, x: centerX - sourceRoi.w / 2, y: centerY - sourceRoi.h / 2, w: sourceRoi.w, h: sourceRoi.h };
          }
          if (s.refRoi && s.refRoi.imageId === activeImageId) {
              const centerX = s.refRoi.x + s.refRoi.w / 2;
              const centerY = s.refRoi.y + s.refRoi.h / 2;
              updates.refRoi = { ...s.refRoi, x: centerX - sourceRoi.w / 2, y: centerY - sourceRoi.h / 2, w: sourceRoi.w, h: sourceRoi.h };
          }
          return { ...s, ...updates };
      });
      updateSamples(newSamples);
  };

  const batchSetGroup = () => {
      const groupName = prompt("请输入新的分组名称 (例如: Treated):", "Group 1");
      if (!groupName) return;
      const newSamples = samples.map(s => {
          // If samples are selected, only update those. Otherwise update all active on image.
          if (selectedSampleIds.size > 0) {
              if (selectedSampleIds.has(s.id)) return { ...s, group: groupName };
              return s;
          } else {
             const hasRoiOnActiveImage = (s.targetRoi?.imageId === activeImageId) || (s.refRoi?.imageId === activeImageId);
             if (hasRoiOnActiveImage) return { ...s, group: groupName };
             return s;
          }
      });
      updateSamples(newSamples);
      setSelectedSampleIds(new Set()); // Clear selection
  };

  // --- Selection & Merging Logic ---
  const toggleSampleSelection = (id: string) => {
      const newSet = new Set(selectedSampleIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedSampleIds(newSet);
  };

  const handleMergeSamples = () => {
      if (selectedSampleIds.size < 2) return;
      
      const ids = Array.from(selectedSampleIds);
      // We will merge into the first selected sample (base)
      // and try to fill missing ROIs from subsequent samples, then delete subsequent.
      const baseId = ids[0];
      const baseSample = samples.find(s => s.id === baseId);
      if (!baseSample) return;

      let mergedSample = { ...baseSample };
      const idsToRemove: string[] = [];

      for (let i = 1; i < ids.length; i++) {
          const otherId = ids[i];
          const otherSample = samples.find(s => s.id === otherId);
          if (otherSample) {
              if (!mergedSample.targetRoi && otherSample.targetRoi) {
                  mergedSample.targetRoi = otherSample.targetRoi;
              }
              if (!mergedSample.refRoi && otherSample.refRoi) {
                  mergedSample.refRoi = otherSample.refRoi;
              }
              // If conflict, we currently keep Base. 
              idsToRemove.push(otherId);
          }
      }

      const newSamples = samples.map(s => s.id === baseId ? mergedSample : s)
                                .filter(s => !idsToRemove.includes(s.id));
      
      updateSamples(newSamples);
      setSelectedSampleIds(new Set());
  };

  const handleDeleteSelected = () => {
      if (selectedSampleIds.size === 0) return;
      if (!confirm(`确定删除选中的 ${selectedSampleIds.size} 个样本吗？`)) return;
      
      const newSamples = samples.filter(s => !selectedSampleIds.has(s.id));
      updateSamples(newSamples);
      setSelectedSampleIds(new Set());
  };


  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);


  // --- Step 1: Logic (Upload) ---
  
  // Helper to ensure UTIF is loaded if missing
  const ensureUtifLoaded = async () => {
      if ((window as any).UTIF) return true;
      
      return new Promise<boolean>((resolve) => {
          console.log("UTIF not detected, attempting dynamic load...");
          
          // Try loading from fallback unpkg first
          const script = document.createElement('script');
          script.src = "https://unpkg.com/utif@3.1.0/UTIF.js";
          script.crossOrigin = "anonymous";
          script.onload = () => {
              console.log("UTIF loaded via unpkg");
              resolve(true);
          };
          script.onerror = () => {
              // Try another fallback if unpkg fails
              const script2 = document.createElement('script');
              script2.src = "https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js";
              script2.onload = () => {
                  console.log("UTIF loaded via jsdelivr");
                  resolve(true);
              };
              script2.onerror = () => {
                  console.error("Failed to load UTIF from all sources");
                  resolve(false);
              };
              document.body.appendChild(script2);
          };
          document.body.appendChild(script);
      });
  };

  const processFile = async (file: File): Promise<WbImage | null> => {
    const isTiff = file.type === 'image/tiff' || 
                   file.type === 'image/x-tiff' ||
                   file.name.toLowerCase().endsWith('.tif') || 
                   file.name.toLowerCase().endsWith('.tiff');
    
    if (!isTiff) {
        return {
            id: Math.random().toString(36).substring(2, 11),
            name: file.name,
            src: URL.createObjectURL(file)
        };
    }

    if (isTiff) {
        try {
            let utifLib = (window as any).UTIF;
            
            // If library is missing, try to load it dynamically
            if (!utifLib) {
                const loaded = await ensureUtifLoaded();
                if (loaded) {
                    utifLib = (window as any).UTIF;
                }
            }

            if (!utifLib) {
                console.error("UTIF library not found on window object.");
                alert("无法加载 TIFF 处理库。请检查网络连接，或尝试上传 JPG/PNG 格式的图片。");
                return null;
            }

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
                    return new Promise<WbImage | null>((resolve) => {
                        canvas.toBlob((blob) => {
                            if (blob) {
                                resolve({
                                    id: Math.random().toString(36).substring(2, 11),
                                    name: file.name,
                                    src: URL.createObjectURL(blob)
                                });
                            } else {
                                resolve(null);
                            }
                        }, 'image/png');
                    });
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("TIFF Processing Error:", msg);
            return null;
        }
    }
    return null;
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    const newImages: WbImage[] = [];

    for (let i = 0; i < files.length; i++) {
        try {
            const img = await processFile(files[i]);
            if (img) newImages.push(img);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Failed to process file ${files[i].name}`, msg);
        }
    }

    if (newImages.length > 0) {
        setWbImages(prev => [...prev, ...newImages]);
        if (!activeImageId) {
            setActiveImageId(newImages[0].id);
        }
    } else {
        alert("无法处理部分或所有文件，请确保文件格式正确 (JPG, PNG, TIFF)。");
    }
    
    setIsProcessing(false);
    e.target.value = '';
  };

  const removeImage = (id: string) => {
      const imgToRemove = wbImages.find(img => img.id === id);
      if (imgToRemove && imgToRemove.src.startsWith('blob:')) {
          URL.revokeObjectURL(imgToRemove.src);
      }
      setWbImages(prev => prev.filter(img => img.id !== id));
      const newSamples = samples.map(s => ({
          ...s,
          targetRoi: s.targetRoi?.imageId === id ? undefined : s.targetRoi,
          refRoi: s.refRoi?.imageId === id ? undefined : s.refRoi,
      }));
      updateSamples(newSamples);
      if (activeImageId === id) {
          const remaining = wbImages.filter(img => img.id !== id);
          setActiveImageId(remaining.length > 0 ? remaining[0].id : null);
      }
      imageCacheRef.current.delete(id);
  };

  const addSample = () => {
    const newId = (Math.max(0, ...samples.map(s => parseInt(s.id))) + 1).toString();
    const newSample: WbSample = { 
        id: newId, 
        name: `Sample ${samples.length + 1}`, 
        group: 'Group 1',
        isControl: false 
    };
    updateSamples([...samples, newSample]);
  };

  const duplicateSample = (sample: WbSample) => {
      const newId = (Math.max(0, ...samples.map(s => parseInt(s.id))) + 1).toString();
      const newSample = { ...sample, id: newId, name: `${sample.name} Copy`, targetRoi: undefined, refRoi: undefined };
      updateSamples([...samples, newSample]);
  };

  const removeSample = (id: string) => {
    if (samples.length <= 1) return;
    updateSamples(samples.filter(s => s.id !== id));
    // Also remove from selection
    const newSet = new Set(selectedSampleIds);
    newSet.delete(id);
    setSelectedSampleIds(newSet);
  };

  const updateSampleField = (id: string, field: keyof WbSample, value: any) => {
    const newSamples = samples.map(s => s.id === id ? { ...s, [field]: value } : s);
    updateSamples(newSamples);
  };

  // --- Step 2: Canvas & Annotation ---

  useEffect(() => {
      wbImages.forEach(imgData => {
          if (!imageCacheRef.current.has(imgData.id)) {
              const img = new Image();
              img.src = imgData.src;
              img.onerror = () => console.error(`Failed to load image: ${imgData.name}`);
              imageCacheRef.current.set(imgData.id, img);
          }
      });
  }, [wbImages]);

  useEffect(() => {
      if (step === 2 && !activeImageId && wbImages.length > 0) {
          setActiveImageId(wbImages[0].id);
      }
  }, [step, wbImages, activeImageId]);

  const draw = useCallback(() => {
    if (step !== 2 || !activeImageId || !canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = imageCacheRef.current.get(activeImageId);

    if (!ctx || !img || !img.complete || img.naturalWidth === 0) return;

    canvas.width = img.width;
    canvas.height = img.height;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    samples.forEach(sample => {
        if (sample.targetRoi && sample.targetRoi.imageId === activeImageId) {
            drawRoiOnCanvas(ctx, sample.targetRoi, '#3b82f6', `T-${sample.name}`);
        }
        if (sample.refRoi && sample.refRoi.imageId === activeImageId) {
            drawRoiOnCanvas(ctx, sample.refRoi, '#10b981', `R-${sample.name}`);
        }
    });

    if (dragState.mode === 'region_selecting' && dragState.currentRect) {
        const { x, y, w, h } = dragState.currentRect;
        ctx.save();
        ctx.strokeStyle = '#f59e0b'; // Amber
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.1)';
        ctx.fillRect(x, y, w, h);
        
        ctx.font = '12px Arial';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('松开鼠标以识别区域内条带', x, y - 5);
        ctx.restore();
    }

    if (hoveredRoi && hoveredRoi.sampleId) {
        const s = samples.find(sam => sam.id === hoveredRoi.sampleId);
        const r = hoveredRoi.type === 'target' ? s?.targetRoi : s?.refRoi;
        if (r && r.imageId === activeImageId) {
            drawHandles(ctx, r, hoveredRoi.type === 'target' ? '#3b82f6' : '#10b981');
        }
    }

  }, [step, activeImageId, samples, hoveredRoi, dragState]);

  useEffect(() => {
      draw();
  }, [draw]);


  const drawRoiOnCanvas = (ctx: CanvasRenderingContext2D, roi: Roi, color: string, label: string) => {
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '22';
    ctx.beginPath();
    ctx.rect(roi.x, roi.y, roi.w, roi.h);
    ctx.stroke();
    ctx.fill();

    const fontSize = Math.max(12, Math.round(roi.w / 4));
    if (fontSize > 8) {
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.fillStyle = color;
        ctx.fillText(label, roi.x, roi.y - 4);
    }
  };

  const drawHandles = (ctx: CanvasRenderingContext2D, roi: Roi, color: string) => {
      const handleSize = Math.max(6, Math.min(12, roi.w / 5));
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;

      const handles = [
          { x: roi.x, y: roi.y },
          { x: roi.x + roi.w, y: roi.y },
          { x: roi.x + roi.w, y: roi.y + roi.h },
          { x: roi.x, y: roi.y + roi.h },
      ];

      handles.forEach(h => {
          ctx.beginPath();
          ctx.rect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize);
          ctx.fill();
          ctx.stroke();
      });
  };

  // --- Interaction Logic ---
  // ... (Interaction Logic mostly unchanged, just reusing helpers) ...

  const getCanvasPos = (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY
      };
  };

  const hitTest = (x: number, y: number): HitResult | null => {
      if (!activeImageId) return null;
      for (let i = samples.length - 1; i >= 0; i--) {
          const s = samples[i];
          const rois: { r?: Roi, type: 'target' | 'ref' }[] = [
              { r: s.refRoi, type: 'ref' },
              { r: s.targetRoi, type: 'target' }
          ];
          for (const item of rois) {
              if (item.r && item.r.imageId === activeImageId) {
                  const r = item.r;
                  const handleSize = Math.max(16, r.w / 4); 
                  const handles: { name: 'nw' | 'ne' | 'se' | 'sw', cx: number, cy: number }[] = [
                    { name: 'nw', cx: r.x, cy: r.y },
                    { name: 'ne', cx: r.x + r.w, cy: r.y },
                    { name: 'se', cx: r.x + r.w, cy: r.y + r.h },
                    { name: 'sw', cx: r.x, cy: r.y + r.h },
                  ];
                  for (const h of handles) {
                      if (Math.abs(x - h.cx) <= handleSize/2 && Math.abs(y - h.cy) <= handleSize/2) {
                          return { sampleId: s.id, type: item.type, handle: h.name };
                      }
                  }
                  if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                      return { sampleId: s.id, type: item.type, handle: 'center' };
                  }
              }
          }
      }
      return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);
      if (toolMode === 'region_detect') {
          setDragState({ mode: 'region_selecting', startPos: pos, currentRect: { x: pos.x, y: pos.y, w: 0, h: 0 } });
          return;
      }
      const hit = hitTest(pos.x, pos.y);
      if (hit) {
          setActiveAnnotation({ sampleId: hit.sampleId, type: hit.type });
          const s = samples.find(sa => sa.id === hit.sampleId);
          const roi = hit.type === 'target' ? s?.targetRoi : s?.refRoi;
          if (roi) {
              setDragState({ 
                  mode: hit.handle === 'center' ? 'moving' : 'resizing', 
                  startPos: pos, 
                  targetSampleId: hit.sampleId, 
                  targetRoiType: hit.type, 
                  initialRoi: { ...roi }, 
                  handle: hit.handle === 'center' ? undefined : hit.handle 
              });
          }
      } else {
          if (activeAnnotation) {
             setDragState({ mode: 'drawing', startPos: pos, targetSampleId: activeAnnotation.sampleId, targetRoiType: activeAnnotation.type, initialRoi: { imageId: activeImageId!, x: pos.x, y: pos.y, w: 0, h: 0 } });
          }
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);
      if (dragState.mode === 'region_selecting') {
          const w = pos.x - dragState.startPos.x;
          const h = pos.y - dragState.startPos.y;
          setDragState(prev => ({ ...prev, currentRect: { x: w < 0 ? pos.x : prev.startPos.x, y: h < 0 ? pos.y : prev.startPos.y, w: Math.abs(w), h: Math.abs(h) } }));
          return;
      }
      if (dragState.mode === 'none') {
          if (toolMode === 'region_detect') { if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair'; return; }
          const hit = hitTest(pos.x, pos.y);
          if (hit) {
              setHoveredRoi({ sampleId: hit.sampleId, type: hit.type, handle: hit.handle });
              if (hit.handle === 'center') canvasRef.current!.style.cursor = 'move';
              else canvasRef.current!.style.cursor = 'nwse-resize';
          } else {
              setHoveredRoi(null);
              canvasRef.current!.style.cursor = activeAnnotation ? 'crosshair' : 'default';
          }
          return;
      }
      // Dragging/Resizing Logic (Identical to previous)
      if (dragState.mode === 'moving' && dragState.initialRoi && dragState.targetSampleId) {
          const dx = pos.x - dragState.startPos.x;
          const dy = pos.y - dragState.startPos.y;
          const newRoi = { ...dragState.initialRoi, x: dragState.initialRoi.x + dx, y: dragState.initialRoi.y + dy };
          updateRoiState(dragState.targetSampleId, dragState.targetRoiType!, newRoi, false);
      }
      if (dragState.mode === 'resizing' && dragState.initialRoi && dragState.targetSampleId && dragState.handle) {
          const dx = pos.x - dragState.startPos.x;
          const dy = pos.y - dragState.startPos.y;
          let newRoi = { ...dragState.initialRoi };
          if (dragState.handle === 'se') { newRoi.w = Math.max(5, dragState.initialRoi.w + dx); newRoi.h = Math.max(5, dragState.initialRoi.h + dy); }
          else if (dragState.handle === 'sw') { newRoi.x = Math.min(dragState.initialRoi.x + dragState.initialRoi.w - 5, dragState.initialRoi.x + dx); newRoi.w = Math.max(5, dragState.initialRoi.w - dx); newRoi.h = Math.max(5, dragState.initialRoi.h + dy); }
          else if (dragState.handle === 'ne') { newRoi.y = Math.min(dragState.initialRoi.y + dragState.initialRoi.h - 5, dragState.initialRoi.y + dy); newRoi.w = Math.max(5, dragState.initialRoi.w + dx); newRoi.h = Math.max(5, dragState.initialRoi.h - dy); }
          else if (dragState.handle === 'nw') { newRoi.x = Math.min(dragState.initialRoi.x + dragState.initialRoi.w - 5, dragState.initialRoi.x + dx); newRoi.y = Math.min(dragState.initialRoi.y + dragState.initialRoi.h - 5, dragState.initialRoi.y + dy); newRoi.w = Math.max(5, dragState.initialRoi.w - dx); newRoi.h = Math.max(5, dragState.initialRoi.h - dy); }
          updateRoiState(dragState.targetSampleId, dragState.targetRoiType!, newRoi, false);
      }
      if (dragState.mode === 'drawing' && dragState.targetSampleId) {
          const w = pos.x - dragState.startPos.x;
          const h = pos.y - dragState.startPos.y;
          const newRoi: Roi = { imageId: activeImageId!, x: w < 0 ? pos.x : dragState.startPos.x, y: h < 0 ? pos.y : dragState.startPos.y, w: Math.abs(w), h: Math.abs(h) };
          updateRoiState(dragState.targetSampleId, dragState.targetRoiType!, newRoi, false);
      }
  };

  const handleMouseUp = () => {
      if (dragState.mode === 'region_selecting' && dragState.currentRect) {
          const rect = dragState.currentRect;
          if (rect.w > 10 && rect.h > 10) {
              autoDetectBands(rect);
          }
          setDragState({ mode: 'none', startPos: { x: 0, y: 0 } });
          setToolMode('select'); 
          return;
      }
      if (dragState.mode !== 'none') {
          if (dragState.targetSampleId) {
             pushToHistory(samples);
          }
          setDragState({ mode: 'none', startPos: { x:0, y:0 } });
      }
  };

  const updateRoiState = (sampleId: string, type: 'target' | 'ref', newRoi: Roi, commitHistory: boolean) => {
      const newSamples = samples.map(s => {
          if (s.id === sampleId) {
              return { ...s, [type === 'target' ? 'targetRoi' : 'refRoi']: newRoi };
          }
          return s;
      });
      updateSamples(newSamples, commitHistory);
  };

  // --- Analysis Helpers (Same as before) ---
  const recalculateStats = (currentSamples: WbSample[]) => {
    const normalizedResults = currentSamples.map(s => ({
        ...s,
        normalizedRatio: (s.targetDensity && s.refDensity) ? (s.targetDensity / s.refDensity) : 0
    }));
    const controlSamples = normalizedResults.filter(s => s.isControl);
    const controlAvgRatio = controlSamples.length > 0 ? controlSamples.reduce((acc, s) => acc + (s.normalizedRatio || 0), 0) / controlSamples.length : 1;
    const finalResults = normalizedResults.map(s => ({ ...s, relativeExpression: (s.normalizedRatio || 0) / (controlAvgRatio || 1) }));
    updateSamples(finalResults, false);
  };

  const performAnalysis = () => {
    const rawResults = samples.map(s => {
        let targetDensity = 0, refDensity = 0;
        if (s.targetRoi) { const img = imageCacheRef.current.get(s.targetRoi.imageId); if (img) targetDensity = calculateDensityFromImage(img, s.targetRoi); }
        if (s.refRoi) { const img = imageCacheRef.current.get(s.refRoi.imageId); if (img) refDensity = calculateDensityFromImage(img, s.refRoi); }
        return { ...s, targetDensity, refDensity };
    });
    recalculateStats(rawResults);
    setStep(3);
  };

  const handleDensityChange = (id: string, type: 'target' | 'ref', newVal: string) => {
      const val = parseFloat(newVal);
      const numVal = isNaN(val) ? 0 : val;
      const newSamples = samples.map(s => s.id === id ? { ...s, [type === 'target' ? 'targetDensity' : 'refDensity']: numVal } : s);
      recalculateStats(newSamples);
  };

  const handleExportCsv = () => { /* Same as before */ 
    let csvContent = "\uFEFF"; 
    csvContent += "Group,Sample Name,Raw Target Density,Raw Ref Density,Ratio (Target/Ref),Relative Expression (Norm to Control)\n";
    samples.forEach(s => { csvContent += `"${s.group}","${s.name}",${s.targetDensity || 0},${s.refDensity || 0},${(s.normalizedRatio || 0).toFixed(4)},${(s.relativeExpression || 0).toFixed(4)}\n`; });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "Western_Blot_Results.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const groupStats = useMemo(() => {
      const groups: Record<string, { totalExp: number; count: number; values: number[] }> = {};
      samples.forEach(s => {
          if (!groups[s.group]) groups[s.group] = { totalExp: 0, count: 0, values: [] };
          const val = s.relativeExpression || 0;
          groups[s.group].totalExp += val;
          groups[s.group].count += 1;
          groups[s.group].values.push(val);
      });
      return Object.entries(groups).map(([name, stats]) => {
          const mean = stats.totalExp / stats.count;
          const variance = stats.values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (stats.count > 1 ? stats.count - 1 : 1);
          const sd = Math.sqrt(variance);
          return { name, mean: parseFloat(mean.toFixed(2)), sd: parseFloat(sd.toFixed(2)), error: [parseFloat((mean - sd).toFixed(2)), parseFloat((mean + sd).toFixed(2))] };
      });
  }, [samples]);

  const getImageNameById = (id?: string) => wbImages.find(i => i.id === id)?.name || 'Unknown';

  // --- View ---

  return (
    <div className="w-full animate-fade-in max-w-7xl mx-auto">
      {/* Title */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Activity className="text-emerald-500" />
            Western Blot 灰度分析
        </h2>
        <p className="text-slate-500 mt-1">图像半定量分析工具 (支持多图片、多生物学重复)</p>
      </div>

      {step === 1 && (
        // ... (Step 1 View - Upload - Unchanged) ...
        <div className="space-y-8">
            <div className="bg-white rounded-2xl p-12 border-2 border-dashed border-slate-300 text-center hover:border-emerald-400 transition-colors">
                <div className="bg-emerald-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Upload size={40} className="text-emerald-500" />
                </div>
                <h3 className="text-xl font-medium text-slate-800 mb-2">上传 Western Blot 条带图片</h3>
                <p className="text-slate-500 mb-6 max-w-md mx-auto">请上传所有相关的 Blot 图片。支持 JPG, PNG, TIFF 格式。</p>
                <input type="file" accept="image/jpeg,image/png,image/tiff,.tif,.tiff,.jpg,.jpeg,.png" onChange={handleImageUpload} multiple id="wb-upload" className="hidden" />
                <label htmlFor="wb-upload" className={`px-8 py-3 rounded-lg font-medium cursor-pointer transition-all shadow-lg shadow-emerald-500/20 inline-flex items-center gap-2 ${isProcessing ? 'bg-slate-400 cursor-wait' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}>
                    {isProcessing ? '正在处理...' : <><Plus size={20} /> 添加图片</>}
                </label>
            </div>
            {wbImages.length > 0 && (
                <div className="space-y-4">
                    <h3 className="font-bold text-slate-700">已上传图片 ({wbImages.length})</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {wbImages.map((img) => (
                            <div key={img.id} className="relative group bg-white p-2 rounded-xl shadow-sm border border-slate-200">
                                <div className="aspect-square bg-slate-100 rounded-lg overflow-hidden mb-2 relative"><img src={img.src} alt={img.name} className="w-full h-full object-cover" /></div>
                                <div className="text-xs text-slate-600 truncate px-1" title={img.name}>{img.name}</div>
                                <button onClick={() => removeImage(img.id)} className="absolute -top-2 -right-2 bg-red-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm cursor-pointer z-10"><X size={14} /></button>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end pt-4"><button onClick={() => setStep(2)} className="bg-slate-800 hover:bg-slate-900 text-white px-8 py-3 rounded-lg font-medium shadow-lg transition-all">下一步：框选条带</button></div>
                </div>
            )}
        </div>
      )}

      {step === 2 && (
        <div className="grid lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2 space-y-4">
                {/* Image Toolbar */}
                <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                    <div className="flex gap-2 overflow-x-auto pb-1 max-w-[70%]">
                        {wbImages.map(img => (
                            <button key={img.id} onClick={() => setActiveImageId(img.id)} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all border ${activeImageId === img.id ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                <ImageIcon size={14} /><span className="max-w-[100px] truncate">{img.name}</span>
                            </button>
                        ))}
                        <button onClick={() => setStep(1)} title="Add Image" className="px-2 py-1.5 rounded-md text-slate-400 hover:bg-slate-100"><Plus size={16} /></button>
                    </div>
                    <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                        <button onClick={undo} disabled={historyIndex <= 0} className="p-2 rounded hover:bg-slate-100 disabled:opacity-30"><Undo size={18} /></button>
                        <button onClick={redo} disabled={historyIndex >= history.length - 1} className="p-2 rounded hover:bg-slate-100 disabled:opacity-30"><Redo size={18} /></button>
                    </div>
                </div>

                {/* Automation Toolbar */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-col gap-3">
                     <div className="flex items-center justify-between">
                         <div className="flex items-center gap-4">
                             <div className="flex flex-col gap-1">
                                 <label className="text-xs font-bold text-slate-500 flex items-center gap-1"><Sliders size={12} /> 检测灵敏度</label>
                                 <input type="range" min="1" max="254" value={detectionThreshold} onChange={(e) => setDetectionThreshold(parseInt(e.target.value))} className="w-32 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500" title="Threshold: Lower = Detect only darker bands" />
                             </div>
                             <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
                                 <select value={detectType} onChange={(e) => setDetectType(e.target.value as 'target' | 'ref')} className="text-sm border-slate-300 rounded-md py-1 px-2 shadow-sm">
                                     <option value="target">检测目的蛋白</option>
                                     <option value="ref">检测内参蛋白</option>
                                 </select>
                             </div>
                         </div>
                         
                         <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer select-none bg-white px-2 py-1 rounded border border-slate-200 hover:bg-slate-50">
                             <input type="checkbox" checked={matchExisting} onChange={(e) => setMatchExisting(e.target.checked)} className="rounded text-emerald-600 focus:ring-emerald-500" />
                             按顺序匹配现有样本 (Match Order)
                         </label>
                     </div>

                     <div className="flex items-center gap-2 pt-2 border-t border-slate-200/50">
                         <button onClick={() => { setToolMode(toolMode === 'region_detect' ? 'select' : 'region_detect'); }} className={`text-xs px-3 py-1.5 rounded-md font-medium flex items-center gap-1 border transition-all ${toolMode === 'region_detect' ? 'bg-amber-100 text-amber-700 border-amber-300 shadow-inner' : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'}`} title="框选一个区域，仅检测该区域内的条带">
                            <Crop size={14} /> 框选识别
                        </button>
                        <div className="h-4 w-px bg-slate-300 mx-1"></div>
                        <button onClick={() => autoDetectBands()} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 shadow-sm transition-all active:scale-95" title="自动检测整张图片">
                            <ScanLine size={14} /> 全图识别
                        </button>
                        <button onClick={applyUniformSize} className="text-xs bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-md font-medium flex items-center gap-1 ml-auto" title="将当前图像上的所有选区大小调整为与当前选中选区一致">
                            <Maximize size={12} /> 统一尺寸
                        </button>
                     </div>
                </div>

                <div className="bg-slate-900 rounded-xl overflow-hidden shadow-lg relative min-h-[500px]" ref={containerRef}>
                    <div className="absolute top-4 left-4 z-10 bg-black/70 backdrop-blur text-white text-xs px-3 py-1.5 rounded-full pointer-events-none flex items-center gap-2">
                        {toolMode === 'region_detect' ? <Crop size={12} className="text-amber-400" /> : <MousePointer2 size={12} />}
                        {toolMode === 'region_detect' ? '模式: 区域识别 (请框选包含条带的区域)' : activeAnnotation ? `选中: ${samples.find(s => s.id === activeAnnotation?.sampleId)?.name}` : '模式: 选择/绘制'}
                    </div>
                    <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} className={`block w-full touch-none ${toolMode === 'region_detect' ? 'cursor-crosshair' : 'cursor-default'}`} />
                </div>
                
                <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-lg flex gap-2 items-start">
                     <AlertCircle size={14} className="mt-0.5 shrink-0" />
                     <div>
                        <p className="mb-1"><strong>匹配提示：</strong> 勾选“按顺序匹配”后，先识别“目的蛋白”，再切换为“内参蛋白”并识别，系统会自动将内参与目的蛋白配对（基于位置顺序）。</p>
                        <p><strong>手动分组：</strong> 在右侧列表中勾选两个样本，点击“合并”即可将它们配对。</p>
                     </div>
                </div>
            </div>

            {/* Right: Controls */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6 max-h-[calc(100vh-100px)] overflow-y-auto">
                <div>
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center justify-between">
                        样本列表
                        <button onClick={addSample} className="text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded text-sm font-medium transition-colors flex items-center gap-1">
                            <Plus size={16} /> 添加样本
                        </button>
                    </h3>
                    
                    {/* Batch Actions Bar */}
                    {selectedSampleIds.size > 0 && (
                        <div className="bg-slate-100 rounded-lg p-2 mb-4 flex items-center justify-between animate-fade-in">
                            <span className="text-xs font-bold text-slate-600 pl-2">已选 {selectedSampleIds.size} 项</span>
                            <div className="flex gap-2">
                                {selectedSampleIds.size >= 2 && (
                                    <button onClick={handleMergeSamples} className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1.5 rounded flex items-center gap-1" title="合并选中的样本 (合并 Target 和 Ref)">
                                        <Merge size={12} /> 合并
                                    </button>
                                )}
                                <button onClick={batchSetGroup} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs px-2 py-1.5 rounded flex items-center gap-1">
                                    <BoxSelect size={12} /> 分组
                                </button>
                                <button onClick={handleDeleteSelected} className="bg-red-50 text-red-600 hover:bg-red-100 text-xs px-2 py-1.5 rounded flex items-center gap-1">
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                    )}
                    
                    <div className="space-y-4">
                        {samples.map((sample) => (
                            <div key={sample.id} className={`bg-slate-50 rounded-lg p-3 border transition-all group ${selectedSampleIds.has(sample.id) ? 'border-blue-400 bg-blue-50/30' : 'border-slate-100 hover:border-emerald-200'}`}>
                                <div className="flex flex-col gap-2 mb-3">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => toggleSampleSelection(sample.id)} className={`shrink-0 p-1 rounded hover:bg-slate-200 ${selectedSampleIds.has(sample.id) ? 'text-blue-600' : 'text-slate-300'}`}>
                                            <CheckSquare size={18} className={selectedSampleIds.has(sample.id) ? "fill-current" : ""} />
                                        </button>

                                        <div className="flex-1">
                                            <input type="text" value={sample.name} onChange={(e) => updateSampleField(sample.id, 'name', e.target.value)} className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-emerald-500 outline-none text-sm font-bold text-slate-800 w-full" placeholder="Sample Name" />
                                            <input type="text" value={sample.group} onChange={(e) => updateSampleField(sample.id, 'group', e.target.value)} className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-purple-500 outline-none text-xs text-purple-600 w-full mt-1" placeholder="Group Name" />
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => duplicateSample(sample)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded" title="复制样本"><Copy size={14} /></button>
                                            <button onClick={() => removeSample(sample.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded" title="删除"><Trash2 size={14} /></button>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 text-xs pl-8">
                                        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer select-none">
                                            <input type="checkbox" checked={sample.isControl} onChange={(e) => updateSampleField(sample.id, 'isControl', e.target.checked)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                                            设为对照组 (Control)
                                        </label>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2 pl-8">
                                    <button onClick={() => setActiveAnnotation({ sampleId: sample.id, type: 'target' })} className={`px-2 py-2 rounded text-xs font-medium flex flex-col items-center justify-center gap-1 border transition-all relative overflow-hidden min-h-[48px] ${sample.targetRoi ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'} ${activeAnnotation?.sampleId === sample.id && activeAnnotation.type === 'target' ? 'ring-2 ring-blue-500 ring-offset-1 shadow-inner' : ''}`}>
                                        <div className="flex items-center gap-1">{sample.targetRoi ? <Check size={12} /> : <Maximize size={12} />}<span>目的蛋白</span></div>
                                        {sample.targetRoi && <span className="text-[10px] opacity-70 bg-blue-100 px-1.5 rounded-full truncate max-w-full">{getImageNameById(sample.targetRoi.imageId)}</span>}
                                    </button>
                                    <button onClick={() => setActiveAnnotation({ sampleId: sample.id, type: 'ref' })} className={`px-2 py-2 rounded text-xs font-medium flex flex-col items-center justify-center gap-1 border transition-all relative overflow-hidden min-h-[48px] ${sample.refRoi ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-300'} ${activeAnnotation?.sampleId === sample.id && activeAnnotation.type === 'ref' ? 'ring-2 ring-emerald-500 ring-offset-1 shadow-inner' : ''}`}>
                                        <div className="flex items-center gap-1">{sample.refRoi ? <Check size={12} /> : <Maximize size={12} />}<span>内参蛋白</span></div>
                                        {sample.refRoi && <span className="text-[10px] opacity-70 bg-emerald-100 px-1.5 rounded-full truncate max-w-full">{getImageNameById(sample.refRoi.imageId)}</span>}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                    <button onClick={performAnalysis} disabled={samples.some(s => !s.targetRoi || !s.refRoi)} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-3 rounded-lg font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2">
                        <BarChart3 size={20} /> 开始分析
                    </button>
                    {samples.some(s => !s.targetRoi || !s.refRoi) && <p className="text-xs text-center text-slate-400 mt-2">请标记所有样本的条带区域</p>}
                </div>
            </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-8">
            <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                 <h3 className="text-lg font-bold text-slate-800">分析结果</h3>
                 <div className="flex gap-2">
                     <button onClick={handleExportCsv} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-2 text-sm font-medium shadow-md shadow-emerald-500/20 transition-all active:scale-95"><Download size={16} /> 导出 CSV</button>
                     <button onClick={() => setStep(2)} className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-medium transition-colors">调整选区</button>
                     <button onClick={() => { setStep(1); setSamples([{ id: '1', name: 'Sample 1', group: 'Control', isControl: true }]); setWbImages([]); setActiveImageId(null); setHistory([]); }} className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium flex items-center gap-2"><RotateCcw size={16} /> 重新开始</button>
                 </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h4 className="font-bold text-slate-700 mb-6 pl-2 border-l-4 border-emerald-500">分组相对表达量 (Mean ± SD)</h4>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={groupStats} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                <Bar dataKey="mean" fill="#10b981" radius={[6, 6, 0, 0]} name="Relative Expression">
                                    <ErrorBar dataKey="error" width={4} strokeWidth={2} stroke="#064e3b" />
                                    {groupStats.map((entry, index) => <Cell key={`cell-${index}`} fill={['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'][index % 4]} />)}
                                </Bar>
                             </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 overflow-hidden">
                    <h4 className="font-bold text-slate-700 mb-6 pl-2 border-l-4 border-blue-500">详细数据 (可编辑)</h4>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-medium">
                                <tr>
                                    <th className="px-3 py-2 rounded-l-lg">分组 / 样本</th>
                                    <th className="px-3 py-2 text-right w-24">Raw (Target)</th>
                                    <th className="px-3 py-2 text-right w-24">Raw (Ref)</th>
                                    <th className="px-3 py-2 text-right rounded-r-lg">Rel. Exp.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {samples.map(s => (
                                    <tr key={s.id} className="hover:bg-slate-50">
                                        <td className="px-3 py-3 font-medium text-slate-700">
                                            <div className="text-xs text-slate-400">{s.group}</div>
                                            {s.name} {s.isControl && <span className="text-[10px] bg-emerald-100 text-emerald-600 px-1 rounded ml-1">Ctrl</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <input type="number" value={Math.round(s.targetDensity || 0)} onChange={(e) => handleDensityChange(s.id, 'target', e.target.value)} className="w-20 text-right px-2 py-1 border border-slate-200 rounded text-slate-600 font-mono focus:ring-2 focus:ring-emerald-500 outline-none text-xs" />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <input type="number" value={Math.round(s.refDensity || 0)} onChange={(e) => handleDensityChange(s.id, 'ref', e.target.value)} className="w-20 text-right px-2 py-1 border border-slate-200 rounded text-slate-600 font-mono focus:ring-2 focus:ring-emerald-500 outline-none text-xs" />
                                        </td>
                                        <td className="px-3 py-3 text-right font-bold text-emerald-600 font-mono">{(s.relativeExpression || 0).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-start gap-3 text-sm text-amber-800">
                <AlertCircle className="shrink-0 mt-0.5 text-amber-500" size={18} />
                <p><strong>注意：</strong> 本工具计算各分组内样本的平均相对表达量和标准差(SD)。请确保每个生物学重复被分配到正确的分组名称下。</p>
            </div>
        </div>
      )}
    </div>
  );
};