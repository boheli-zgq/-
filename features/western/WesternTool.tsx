import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Upload, Plus, Trash2, Maximize, Check, BarChart3, AlertCircle, RotateCcw, Activity, Image as ImageIcon, X, Download, Undo, Redo, Copy, Move, GripHorizontal } from 'lucide-react';
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

// History Snapshot
type HistoryState = WbSample[];

interface DragState {
  mode: 'none' | 'drawing' | 'moving' | 'resizing';
  startPos: { x: number; y: number };
  // For moving/resizing
  targetSampleId?: string;
  targetRoiType?: 'target' | 'ref';
  initialRoi?: Roi;
  handle?: 'nw' | 'ne' | 'sw' | 'se';
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
        const density = 255 - gray;
        totalDensity += density;
      }
      return totalDensity;
  } catch (e) {
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
  
  // Samples State with History
  const [samples, setSamples] = useState<WbSample[]>([
    { id: '1', name: 'Sample 1', group: 'Control', isControl: true },
    { id: '2', name: 'Sample 2', group: 'Control', isControl: true },
    { id: '3', name: 'Sample 3', group: 'Treated', isControl: false },
    { id: '4', name: 'Sample 4', group: 'Treated', isControl: false },
  ]);
  
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
    // Limit history size to 50
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
  
  const processFile = async (file: File): Promise<WbImage | null> => {
    // Robust check for TIFF
    const isTiff = file.type === 'image/tiff' || 
                   file.type === 'image/x-tiff' ||
                   file.name.toLowerCase().endsWith('.tif') || 
                   file.name.toLowerCase().endsWith('.tiff');
    
    // For standard images, use Blob URL to save memory and improve performance
    if (!isTiff) {
        return {
            id: Math.random().toString(36).substr(2, 9),
            name: file.name,
            src: URL.createObjectURL(file)
        };
    }

    if (isTiff) {
        try {
            // Explicitly grab window.UTIF
            const utifLib = (window as any).UTIF;
            
            if (!utifLib) {
                console.error("UTIF library not found on window object.");
                alert("TIFF processing library not loaded. Please refresh the page.");
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
                    // Correctly populate ImageData from UTIF's Uint8Array
                    const imageData = ctx.createImageData(page.width, page.height);
                    imageData.data.set(rgba);
                    ctx.putImageData(imageData, 0, 0);
                    
                    // Convert to Blob URL
                    return new Promise((resolve) => {
                        canvas.toBlob((blob) => {
                            if (blob) {
                                resolve({
                                    id: Math.random().toString(36).substr(2, 9),
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
            console.error("TIFF Processing Error:", err);
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

    // Process sequentially to prevent UI freezing / memory issues
    for (let i = 0; i < files.length; i++) {
        try {
            const img = await processFile(files[i]);
            if (img) newImages.push(img);
        } catch (err) {
            console.error(`Failed to process file ${files[i].name}`, err);
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
    // Reset input so same files can be selected again if needed
    e.target.value = '';
  };

  const removeImage = (id: string) => {
      // Revoke URL to free memory
      const imgToRemove = wbImages.find(img => img.id === id);
      if (imgToRemove && imgToRemove.src.startsWith('blob:')) {
          URL.revokeObjectURL(imgToRemove.src);
      }

      setWbImages(prev => prev.filter(img => img.id !== id));
      // Remove ROIs associated with this image
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
  };

  const updateSampleField = (id: string, field: keyof WbSample, value: any) => {
    const newSamples = samples.map(s => s.id === id ? { ...s, [field]: value } : s);
    // If updating group, we might want to check control status, but keeping it simple for now
    if (field === 'isControl' && value === true) {
        // Ensure only samples in this group are control? Or logic depends on analysis method.
        // For ΔΔCt style relative quant, we usually pick one control group.
        // Here we just mark individual samples. Let's enforce single control GROUP logic in stats later.
    }
    updateSamples(newSamples);
  };

  // --- Step 2: Canvas & Annotation ---

  useEffect(() => {
      wbImages.forEach(imgData => {
          if (!imageCacheRef.current.has(imgData.id)) {
              const img = new Image();
              img.src = imgData.src;
              // Add simple error handling for image loading
              img.onerror = () => console.error(`Failed to load image: ${imgData.name}`);
              imageCacheRef.current.set(imgData.id, img);
          }
      });
  }, [wbImages]);

  // Set default active image
  useEffect(() => {
      if (step === 2 && !activeImageId && wbImages.length > 0) {
          setActiveImageId(wbImages[0].id);
      }
  }, [step, wbImages, activeImageId]);

  // Canvas Drawing
  const draw = useCallback(() => {
    if (step !== 2 || !activeImageId || !canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = imageCacheRef.current.get(activeImageId);

    if (!ctx || !img || !img.complete || img.naturalWidth === 0) return;

    // Set canvas dimensions to match image
    canvas.width = img.width;
    canvas.height = img.height;
    
    // Clear and draw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // Draw ROIs
    samples.forEach(sample => {
        if (sample.targetRoi && sample.targetRoi.imageId === activeImageId) {
            drawRoiOnCanvas(ctx, sample.targetRoi, '#3b82f6', `T-${sample.name}`);
        }
        if (sample.refRoi && sample.refRoi.imageId === activeImageId) {
            drawRoiOnCanvas(ctx, sample.refRoi, '#10b981', `R-${sample.name}`);
        }
    });

    // Draw dragging rect (for new creation)
    if (dragState.mode === 'drawing' && dragState.initialRoi) { // Using initialRoi to store temp drawing state for simplicity
       const color = activeAnnotation?.type === 'target' ? '#3b82f6' : '#10b981';
       // We need to calculate current rect from startPos and current mouse pos, 
       // but strictly speaking inside draw() we should rely on state. 
       // For 'drawing', we usually update a separate 'currentRect' state or utilize dragState payload.
       // Let's use the helper drawing logic which uses the 'samples' state for 'moving/resizing' 
       // but for 'drawing' we need a transient visual.
    }

    // Draw handles for hovered/active ROI
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
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '33'; // 20% opacity
    
    ctx.beginPath();
    ctx.rect(roi.x, roi.y, roi.w, roi.h);
    ctx.stroke();
    ctx.fill();

    // Label
    const fontSize = Math.max(14, Math.round(ctx.canvas.width / 60));
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillStyle = color;
    ctx.fillText(label, roi.x, roi.y - 5);
  };

  const drawHandles = (ctx: CanvasRenderingContext2D, roi: Roi, color: string) => {
      const handleSize = Math.max(8, roi.w / 10);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;

      const handles = [
          { x: roi.x, y: roi.y }, // NW
          { x: roi.x + roi.w, y: roi.y }, // NE
          { x: roi.x + roi.w, y: roi.y + roi.h }, // SE
          { x: roi.x, y: roi.y + roi.h }, // SW
      ];

      handles.forEach(h => {
          ctx.beginPath();
          ctx.rect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize);
          ctx.fill();
          ctx.stroke();
      });
  };

  // --- Interaction Logic ---

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

  // Hit test for existing ROIs
  const hitTest = (x: number, y: number) => {
      if (!activeImageId) return null;
      
      // Check handles first (if we have a hovered/active one would be better, but let's check all relevant)
      // For simplicity, checking bodies then handles logic implies we need to know which one is "active" for handles.
      // We will assume "Hovered" shows handles.

      // Reverse order to check top-most first
      for (let i = samples.length - 1; i >= 0; i--) {
          const s = samples[i];
          const rois: { r?: Roi, type: 'target' | 'ref' }[] = [
              { r: s.refRoi, type: 'ref' },
              { r: s.targetRoi, type: 'target' }
          ];

          for (const item of rois) {
              if (item.r && item.r.imageId === activeImageId) {
                  const r = item.r;
                  const handleSize = Math.max(20, r.w / 5); // Larger hit area for handles
                  
                  // Check Handles (NW, NE, SE, SW)
                  const handles = [
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

                  // Check Body
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
      const hit = hitTest(pos.x, pos.y);

      if (hit) {
          // Clicked existing ROI
          // Set as active annotation so sidebar highlights it
          setActiveAnnotation({ sampleId: hit.sampleId, type: hit.type as any });
          
          const s = samples.find(sa => sa.id === hit.sampleId);
          const roi = hit.type === 'target' ? s?.targetRoi : s?.refRoi;

          if (roi) {
              setDragState({
                  mode: hit.handle === 'center' ? 'moving' : 'resizing',
                  startPos: pos,
                  targetSampleId: hit.sampleId,
                  targetRoiType: hit.type as any,
                  initialRoi: { ...roi },
                  handle: hit.handle as any
              });
          }
      } else {
          // Clicked empty space
          if (activeAnnotation) {
             // Create new ROI for active annotation
             setDragState({
                 mode: 'drawing',
                 startPos: pos,
                 targetSampleId: activeAnnotation.sampleId,
                 targetRoiType: activeAnnotation.type,
                 initialRoi: { imageId: activeImageId!, x: pos.x, y: pos.y, w: 0, h: 0 }
             });
          }
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);

      // Cursor & Hover logic
      if (dragState.mode === 'none') {
          const hit = hitTest(pos.x, pos.y);
          if (hit) {
              setHoveredRoi({ sampleId: hit.sampleId, type: hit.type as any, handle: hit.handle });
              if (hit.handle === 'center') canvasRef.current!.style.cursor = 'move';
              else if (hit.handle === 'nw' || hit.handle === 'se') canvasRef.current!.style.cursor = 'nwse-resize';
              else if (hit.handle === 'ne' || hit.handle === 'sw') canvasRef.current!.style.cursor = 'nesw-resize';
          } else {
              setHoveredRoi(null);
              canvasRef.current!.style.cursor = activeAnnotation ? 'crosshair' : 'default';
          }
          return;
      }

      // Dragging logic
      if (dragState.mode === 'moving' && dragState.initialRoi && dragState.targetSampleId) {
          const dx = pos.x - dragState.startPos.x;
          const dy = pos.y - dragState.startPos.y;
          
          const newRoi = {
              ...dragState.initialRoi,
              x: dragState.initialRoi.x + dx,
              y: dragState.initialRoi.y + dy
          };

          // Update strictly locally (no history push yet) to perform fast
          updateRoiState(dragState.targetSampleId, dragState.targetRoiType!, newRoi, false);
      }

      if (dragState.mode === 'resizing' && dragState.initialRoi && dragState.targetSampleId && dragState.handle) {
          const dx = pos.x - dragState.startPos.x;
          const dy = pos.y - dragState.startPos.y;
          let newRoi = { ...dragState.initialRoi };

          if (dragState.handle === 'se') {
              newRoi.w = Math.max(5, dragState.initialRoi.w + dx);
              newRoi.h = Math.max(5, dragState.initialRoi.h + dy);
          } else if (dragState.handle === 'sw') {
              newRoi.x = Math.min(dragState.initialRoi.x + dragState.initialRoi.w - 5, dragState.initialRoi.x + dx);
              newRoi.w = Math.max(5, dragState.initialRoi.w - dx);
              newRoi.h = Math.max(5, dragState.initialRoi.h + dy);
          } else if (dragState.handle === 'ne') {
              newRoi.y = Math.min(dragState.initialRoi.y + dragState.initialRoi.h - 5, dragState.initialRoi.y + dy);
              newRoi.w = Math.max(5, dragState.initialRoi.w + dx);
              newRoi.h = Math.max(5, dragState.initialRoi.h - dy);
          } else if (dragState.handle === 'nw') {
               newRoi.x = Math.min(dragState.initialRoi.x + dragState.initialRoi.w - 5, dragState.initialRoi.x + dx);
               newRoi.y = Math.min(dragState.initialRoi.y + dragState.initialRoi.h - 5, dragState.initialRoi.y + dy);
               newRoi.w = Math.max(5, dragState.initialRoi.w - dx);
               newRoi.h = Math.max(5, dragState.initialRoi.h - dy);
          }

          updateRoiState(dragState.targetSampleId, dragState.targetRoiType!, newRoi, false);
      }

      if (dragState.mode === 'drawing' && dragState.targetSampleId) {
          const w = pos.x - dragState.startPos.x;
          const h = pos.y - dragState.startPos.y;
          
          const newRoi: Roi = {
              imageId: activeImageId!,
              x: w < 0 ? pos.x : dragState.startPos.x,
              y: h < 0 ? pos.y : dragState.startPos.y,
              w: Math.abs(w),
              h: Math.abs(h)
          };
          
          // Live update for drawing
          updateRoiState(dragState.targetSampleId, dragState.targetRoiType!, newRoi, false);
      }
  };

  const handleMouseUp = () => {
      if (dragState.mode !== 'none') {
          // Commit history on mouse up
          if (dragState.targetSampleId) {
             // We get the *latest* samples from state (which was updated with 'false' history flag)
             // and push it to history now.
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


  // --- Step 3: Analysis ---

  const recalculateStats = (currentSamples: WbSample[]) => {
    const normalizedResults = currentSamples.map(s => ({
        ...s,
        normalizedRatio: (s.targetDensity && s.refDensity) ? (s.targetDensity / s.refDensity) : 0
    }));

    // Find control group average ratio
    const controlSamples = normalizedResults.filter(s => s.isControl);
    // If no explicit control group, use the first sample as ref? Or assume first group.
    // Let's use average of all samples marked isControl.
    const controlAvgRatio = controlSamples.length > 0 
        ? controlSamples.reduce((acc, s) => acc + (s.normalizedRatio || 0), 0) / controlSamples.length
        : 1;

    const finalResults = normalizedResults.map(s => ({
        ...s,
        relativeExpression: (s.normalizedRatio || 0) / (controlAvgRatio || 1)
    }));

    updateSamples(finalResults, false);
  };

  const performAnalysis = () => {
    // 1. Calculate Raw Densities using cached images
    const rawResults = samples.map(s => {
        let targetDensity = 0;
        let refDensity = 0;

        if (s.targetRoi) {
            const img = imageCacheRef.current.get(s.targetRoi.imageId);
            if (img) targetDensity = calculateDensityFromImage(img, s.targetRoi);
        }
        
        if (s.refRoi) {
            const img = imageCacheRef.current.get(s.refRoi.imageId);
            if (img) refDensity = calculateDensityFromImage(img, s.refRoi);
        }

        return { ...s, targetDensity, refDensity };
    });

    recalculateStats(rawResults);
    setStep(3);
  };

  const handleDensityChange = (id: string, type: 'target' | 'ref', newVal: string) => {
      const val = parseFloat(newVal);
      const numVal = isNaN(val) ? 0 : val;
      const newSamples = samples.map(s => {
          if (s.id === id) {
              return { ...s, [type === 'target' ? 'targetDensity' : 'refDensity']: numVal };
          }
          return s;
      });
      recalculateStats(newSamples);
  };

  const handleExportCsv = () => {
    let csvContent = "\uFEFF"; 
    csvContent += "Group,Sample Name,Raw Target Density,Raw Ref Density,Ratio (Target/Ref),Relative Expression (Norm to Control)\n";
    samples.forEach(s => {
        csvContent += `"${s.group}","${s.name}",${s.targetDensity || 0},${s.refDensity || 0},${(s.normalizedRatio || 0).toFixed(4)},${(s.relativeExpression || 0).toFixed(4)}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "Western_Blot_Results.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Render Helpers ---

  // Group stats for chart
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
          // Calculate SD
          const variance = stats.values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (stats.count > 1 ? stats.count - 1 : 1);
          const sd = Math.sqrt(variance);
          
          return {
              name,
              mean: parseFloat(mean.toFixed(2)),
              sd: parseFloat(sd.toFixed(2)),
              error: [parseFloat((mean - sd).toFixed(2)), parseFloat((mean + sd).toFixed(2))]
          };
      });
  }, [samples]);

  const getImageNameById = (id?: string) => {
      if (!id) return '';
      return wbImages.find(i => i.id === id)?.name || 'Unknown';
  };

  // --- View ---

  return (
    <div className="w-full animate-fade-in max-w-7xl mx-auto">
      
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Activity className="text-emerald-500" />
            Western Blot 灰度分析
        </h2>
        <p className="text-slate-500 mt-1">图像半定量分析工具 (支持多图片、多生物学重复)</p>
      </div>

      {step === 1 && (
        <div className="space-y-8">
            <div className="bg-white rounded-2xl p-12 border-2 border-dashed border-slate-300 text-center hover:border-emerald-400 transition-colors">
                <div className="bg-emerald-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Upload size={40} className="text-emerald-500" />
                </div>
                <h3 className="text-xl font-medium text-slate-800 mb-2">上传 Western Blot 条带图片</h3>
                <p className="text-slate-500 mb-6 max-w-md mx-auto">
                    请上传所有相关的 Blot 图片。支持 JPG, PNG, TIFF 格式。
                </p>
                <input 
                    type="file" 
                    accept="image/jpeg,image/png,image/tiff,.tif,.tiff,.jpg,.jpeg,.png" 
                    onChange={handleImageUpload} 
                    multiple
                    id="wb-upload" 
                    className="hidden"
                />
                <label 
                    htmlFor="wb-upload"
                    className={`
                        px-8 py-3 rounded-lg font-medium cursor-pointer transition-all shadow-lg shadow-emerald-500/20 inline-flex items-center gap-2
                        ${isProcessing ? 'bg-slate-400 cursor-wait' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}
                    `}
                >
                    {isProcessing ? '正在处理...' : <><Plus size={20} /> 添加图片</>}
                </label>
            </div>

            {wbImages.length > 0 && (
                <div className="space-y-4">
                    <h3 className="font-bold text-slate-700">已上传图片 ({wbImages.length})</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {wbImages.map((img) => (
                            <div key={img.id} className="relative group bg-white p-2 rounded-xl shadow-sm border border-slate-200">
                                <div className="aspect-square bg-slate-100 rounded-lg overflow-hidden mb-2 relative">
                                    <img src={img.src} alt={img.name} className="w-full h-full object-cover" />
                                </div>
                                <div className="text-xs text-slate-600 truncate px-1" title={img.name}>{img.name}</div>
                                <button 
                                    onClick={() => removeImage(img.id)}
                                    className="absolute -top-2 -right-2 bg-red-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm cursor-pointer z-10"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end pt-4">
                         <button 
                            onClick={() => setStep(2)}
                            className="bg-slate-800 hover:bg-slate-900 text-white px-8 py-3 rounded-lg font-medium shadow-lg transition-all"
                        >
                            下一步：框选条带
                        </button>
                    </div>
                </div>
            )}
        </div>
      )}

      {step === 2 && (
        <div className="grid lg:grid-cols-3 gap-8 items-start">
            {/* Left: Canvas Area */}
            <div className="lg:col-span-2 space-y-4">
                {/* Toolbar */}
                <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                    <div className="flex gap-2 overflow-x-auto pb-1 max-w-[70%]">
                        {wbImages.map(img => (
                            <button
                                key={img.id}
                                onClick={() => setActiveImageId(img.id)}
                                className={`
                                    flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all border
                                    ${activeImageId === img.id 
                                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700' 
                                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}
                                `}
                            >
                                <ImageIcon size={14} />
                                <span className="max-w-[100px] truncate">{img.name}</span>
                            </button>
                        ))}
                        <button onClick={() => setStep(1)} title="Add Image" className="px-2 py-1.5 rounded-md text-slate-400 hover:bg-slate-100"><Plus size={16} /></button>
                    </div>
                    
                    <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                        <button 
                            onClick={undo} 
                            disabled={historyIndex <= 0}
                            className="p-2 rounded hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="撤销 (Ctrl+Z)"
                        >
                            <Undo size={18} />
                        </button>
                        <button 
                            onClick={redo} 
                            disabled={historyIndex >= history.length - 1}
                            className="p-2 rounded hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="重做 (Ctrl+Shift+Z)"
                        >
                            <Redo size={18} />
                        </button>
                    </div>
                </div>

                <div className="bg-slate-900 rounded-xl overflow-hidden shadow-lg relative min-h-[500px]" ref={containerRef}>
                    <div className="absolute top-4 left-4 z-10 bg-black/70 backdrop-blur text-white text-xs px-3 py-1.5 rounded-full pointer-events-none flex items-center gap-2">
                         {dragState.mode === 'moving' ? <Move size={12} /> : 
                          dragState.mode === 'resizing' ? <Maximize size={12} /> : 
                          <Activity size={12} />}
                        {activeAnnotation 
                            ? `模式: ${dragState.mode === 'none' ? '准备绘制' : dragState.mode} - ${samples.find(s => s.id === activeAnnotation?.sampleId)?.name}` 
                            : '请选择右侧样本进行框选，拖动框体可移动/调整大小'}
                    </div>
                    
                    <canvas 
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        className="block w-full cursor-crosshair touch-none"
                    />
                </div>
                
                <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-lg flex gap-2 items-start">
                     <AlertCircle size={14} className="mt-0.5 shrink-0" />
                     <p>提示：点击已画好的框可进行<b>移动</b>或拖动四角进行<b>缩放</b>。使用 Ctrl+Z 撤销操作。</p>
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
                    
                    <div className="space-y-4">
                        {samples.map((sample) => (
                            <div key={sample.id} className="bg-slate-50 rounded-lg p-3 border border-slate-100 transition-all hover:border-emerald-200 group">
                                <div className="flex flex-col gap-2 mb-3">
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1">
                                            <input 
                                                type="text" 
                                                value={sample.name} 
                                                onChange={(e) => updateSampleField(sample.id, 'name', e.target.value)}
                                                className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-emerald-500 outline-none text-sm font-bold text-slate-800 w-full"
                                                placeholder="Sample Name"
                                            />
                                            <input 
                                                type="text" 
                                                value={sample.group} 
                                                onChange={(e) => updateSampleField(sample.id, 'group', e.target.value)}
                                                className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-purple-500 outline-none text-xs text-purple-600 w-full mt-1"
                                                placeholder="Group Name (e.g. Treated)"
                                                title="分组名称 (用于统计分析)"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button 
                                                onClick={() => duplicateSample(sample)}
                                                className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded"
                                                title="复制样本"
                                            >
                                                <Copy size={14} />
                                            </button>
                                            <button 
                                                onClick={() => removeSample(sample.id)}
                                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
                                                title="删除"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 text-xs">
                                        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer select-none">
                                            <input 
                                                type="checkbox" 
                                                checked={sample.isControl} 
                                                onChange={(e) => updateSampleField(sample.id, 'isControl', e.target.checked)}
                                                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                            />
                                            设为对照组 (Control)
                                        </label>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2">
                                    <button 
                                        onClick={() => setActiveAnnotation({ sampleId: sample.id, type: 'target' })}
                                        className={`
                                            px-2 py-2 rounded text-xs font-medium flex flex-col items-center justify-center gap-1 border transition-all relative overflow-hidden min-h-[48px]
                                            ${sample.targetRoi ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'}
                                            ${activeAnnotation?.sampleId === sample.id && activeAnnotation.type === 'target' ? 'ring-2 ring-blue-500 ring-offset-1 shadow-inner' : ''}
                                        `}
                                    >
                                        <div className="flex items-center gap-1">
                                            {sample.targetRoi ? <Check size={12} /> : <Maximize size={12} />}
                                            <span>目的蛋白</span>
                                        </div>
                                        {sample.targetRoi && (
                                            <span className="text-[10px] opacity-70 bg-blue-100 px-1.5 rounded-full truncate max-w-full">
                                                {getImageNameById(sample.targetRoi.imageId)}
                                            </span>
                                        )}
                                    </button>
                                    
                                    <button 
                                         onClick={() => setActiveAnnotation({ sampleId: sample.id, type: 'ref' })}
                                         className={`
                                            px-2 py-2 rounded text-xs font-medium flex flex-col items-center justify-center gap-1 border transition-all relative overflow-hidden min-h-[48px]
                                            ${sample.refRoi ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-300'}
                                            ${activeAnnotation?.sampleId === sample.id && activeAnnotation.type === 'ref' ? 'ring-2 ring-emerald-500 ring-offset-1 shadow-inner' : ''}
                                        `}
                                    >
                                        <div className="flex items-center gap-1">
                                            {sample.refRoi ? <Check size={12} /> : <Maximize size={12} />}
                                            <span>内参蛋白</span>
                                        </div>
                                        {sample.refRoi && (
                                            <span className="text-[10px] opacity-70 bg-emerald-100 px-1.5 rounded-full truncate max-w-full">
                                                {getImageNameById(sample.refRoi.imageId)}
                                            </span>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                    <button 
                        onClick={performAnalysis}
                        disabled={samples.some(s => !s.targetRoi || !s.refRoi)}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-3 rounded-lg font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <BarChart3 size={20} />
                        开始分析
                    </button>
                    {samples.some(s => !s.targetRoi || !s.refRoi) && (
                        <p className="text-xs text-center text-slate-400 mt-2">请标记所有样本的条带区域</p>
                    )}
                </div>
            </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-8">
            <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                 <h3 className="text-lg font-bold text-slate-800">分析结果</h3>
                 <div className="flex gap-2">
                     <button
                        onClick={handleExportCsv}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-2 text-sm font-medium shadow-md shadow-emerald-500/20 transition-all active:scale-95"
                    >
                        <Download size={16} /> 导出 CSV
                    </button>
                     <button 
                        onClick={() => setStep(2)} 
                        className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-medium transition-colors"
                     >
                        调整选区
                     </button>
                     <button 
                        onClick={() => { setStep(1); setSamples([{ id: '1', name: 'Sample 1', group: 'Control', isControl: true }]); setWbImages([]); setActiveImageId(null); setHistory([]); }} 
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                     >
                        <RotateCcw size={16} /> 重新开始
                     </button>
                 </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
                {/* Chart */}
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
                                    {groupStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'][index % 4]} />
                                    ))}
                                </Bar>
                             </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Table */}
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
                                            <input 
                                                type="number"
                                                value={Math.round(s.targetDensity || 0)}
                                                onChange={(e) => handleDensityChange(s.id, 'target', e.target.value)}
                                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded text-slate-600 font-mono focus:ring-2 focus:ring-emerald-500 outline-none text-xs"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <input 
                                                type="number"
                                                value={Math.round(s.refDensity || 0)}
                                                onChange={(e) => handleDensityChange(s.id, 'ref', e.target.value)}
                                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded text-slate-600 font-mono focus:ring-2 focus:ring-emerald-500 outline-none text-xs"
                                            />
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
                <p>
                    <strong>注意：</strong> 本工具计算各分组内样本的平均相对表达量和标准差(SD)。请确保每个生物学重复被分配到正确的分组名称下。
                </p>
            </div>
        </div>
      )}
    </div>
  );
};