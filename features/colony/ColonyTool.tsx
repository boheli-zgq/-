import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Disc, Upload, Trash2, Sliders, Play, RefreshCw, Eye, Download, Info, 
  BarChart3, Move, Plus, RotateCcw, Check, CircleDot, Grid3x3, Layers, ListFilter
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ErrorBar, Cell } from 'recharts';
import { processImageFile } from '../../services/imageUtils';

// --- Types ---

export type WellLayoutMode = 'triplicate_h' | 'triplicate_v' | 'single' | 'six_well' | 'custom';

export interface WellROI {
  id: string;
  name: string; // e.g. "Rep 1", "Rep 2", "Rep 3"
  xRatio: number; // 0.0 - 1.0 (relative to image width)
  yRatio: number; // 0.0 - 1.0 (relative to image height)
  radiusRatio: number; // relative to Math.min(width, height)
}

export interface DetectedColony {
  x: number;
  y: number;
  area: number; // pixel count
  radius: number; // approx
  wellId?: string;
}

export interface WellResult {
  wellId: string;
  wellName: string;
  count: number;
  areaPct: number;
  colonies: DetectedColony[];
}

export interface ColonyImage {
  id: string;
  name: string;
  group: string;
  src: string;
  
  // Results
  processed: boolean;
  totalCount: number | null;
  meanCount: number | null;
  sdCount: number | null;
  wellResults: WellResult[];
  colonies: DetectedColony[];
  
  width: number;
  height: number;
}

export interface ProcessSettings {
  threshold: number; // 0-255 (Darker < Threshold = Colony)
  minSize: number; // Min pixels to be a colony
  maxSize: number; // Max pixels
  circularMask: boolean; // Whether to mask the edges of the wells
  invertColors: boolean; // false: dark colonies on bright bg; true: bright colonies
}

// --- Preset Generator ---

const generateDefaultROIs = (mode: WellLayoutMode): WellROI[] => {
  switch (mode) {
    case 'triplicate_h':
      // 1x3 horizontal triplicates
      return [
        { id: 'well-1', name: 'Rep 1', xRatio: 0.20, yRatio: 0.50, radiusRatio: 0.14 },
        { id: 'well-2', name: 'Rep 2', xRatio: 0.50, yRatio: 0.50, radiusRatio: 0.14 },
        { id: 'well-3', name: 'Rep 3', xRatio: 0.80, yRatio: 0.50, radiusRatio: 0.14 }
      ];
    case 'triplicate_v':
      // 3x1 vertical triplicates
      return [
        { id: 'well-1', name: 'Rep 1', xRatio: 0.50, yRatio: 0.20, radiusRatio: 0.14 },
        { id: 'well-2', name: 'Rep 2', xRatio: 0.50, yRatio: 0.50, radiusRatio: 0.14 },
        { id: 'well-3', name: 'Rep 3', xRatio: 0.50, yRatio: 0.80, radiusRatio: 0.14 }
      ];
    case 'six_well':
      // 2 rows x 3 cols 6-well plate
      return [
        { id: 'well-1', name: 'Well 1', xRatio: 0.22, yRatio: 0.32, radiusRatio: 0.13 },
        { id: 'well-2', name: 'Well 2', xRatio: 0.50, yRatio: 0.32, radiusRatio: 0.13 },
        { id: 'well-3', name: 'Well 3', xRatio: 0.78, yRatio: 0.32, radiusRatio: 0.13 },
        { id: 'well-4', name: 'Well 4', xRatio: 0.22, yRatio: 0.68, radiusRatio: 0.13 },
        { id: 'well-5', name: 'Well 5', xRatio: 0.50, yRatio: 0.68, radiusRatio: 0.13 },
        { id: 'well-6', name: 'Well 6', xRatio: 0.78, yRatio: 0.68, radiusRatio: 0.13 }
      ];
    case 'single':
      return [
        { id: 'well-1', name: '单孔/单皿', xRatio: 0.50, yRatio: 0.50, radiusRatio: 0.46 }
      ];
    case 'custom':
    default:
      return [
        { id: 'well-1', name: 'Rep 1', xRatio: 0.22, yRatio: 0.50, radiusRatio: 0.14 },
        { id: 'well-2', name: 'Rep 2', xRatio: 0.50, yRatio: 0.50, radiusRatio: 0.14 },
        { id: 'well-3', name: 'Rep 3', xRatio: 0.78, yRatio: 0.50, radiusRatio: 0.14 }
      ];
  }
};

// --- Detection Logic with Multi-Well Support ---

const processColonyImageWithWells = (
  img: HTMLImageElement,
  settings: ProcessSettings,
  wells: WellROI[]
): {
  wellResults: WellResult[];
  allColonies: DetectedColony[];
  totalCount: number;
  meanCount: number;
  sdCount: number;
} => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { wellResults: [], allColonies: [], totalCount: 0, meanCount: 0, sdCount: 0 };
  }

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const minDim = Math.min(width, height);

  // Convert wells to pixel coordinates
  const pixelWells = wells.map(w => ({
    ...w,
    cx: w.xRatio * width,
    cy: w.yRatio * height,
    r: w.radiusRatio * minDim,
    rSq: Math.pow(w.radiusRatio * minDim, 2)
  }));

  const binary = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Check which well this pixel falls into
      let insideWellIdx = -1;
      for (let wi = 0; wi < pixelWells.length; wi++) {
        const pw = pixelWells[wi];
        const distSq = (x - pw.cx) ** 2 + (y - pw.cy) ** 2;
        if (distSq <= pw.rSq) {
          insideWellIdx = wi;
          break;
        }
      }

      if (insideWellIdx === -1 && settings.circularMask) {
        continue;
      }

      // Grayscale conversion
      const px = idx * 4;
      const gray = 0.299 * data[px] + 0.587 * data[px + 1] + 0.114 * data[px + 2];

      // Thresholding
      const isColony = settings.invertColors 
        ? gray > settings.threshold 
        : gray < settings.threshold;

      if (isColony) {
        binary[idx] = 1;
      }
    }
  }

  // Blob Detection (BFS)
  const visited = new Uint8Array(width * height);
  const allColonies: DetectedColony[] = [];
  const wellColoniesMap: Record<string, DetectedColony[]> = {};
  wells.forEach(w => {
    wellColoniesMap[w.id] = [];
  });

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

          const neighbors = [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1]
          ];
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
          const colonyX = minX + (maxX - minX) / 2;
          const colonyY = minY + (maxY - minY) / 2;
          const radius = Math.sqrt(pixelCount / Math.PI);

          // Find which well this colony falls into based on its center
          let targetWell: (typeof pixelWells)[0] | null = null;
          for (let wi = 0; wi < pixelWells.length; wi++) {
            const pw = pixelWells[wi];
            const distSq = (colonyX - pw.cx) ** 2 + (colonyY - pw.cy) ** 2;
            if (distSq <= pw.rSq) {
              targetWell = pw;
              break;
            }
          }

          if (targetWell || !settings.circularMask) {
            const colony: DetectedColony = {
              x: colonyX,
              y: colonyY,
              area: pixelCount,
              radius: Math.max(2, radius),
              wellId: targetWell ? targetWell.id : undefined
            };
            allColonies.push(colony);
            if (targetWell && wellColoniesMap[targetWell.id]) {
              wellColoniesMap[targetWell.id].push(colony);
            }
          }
        }
      }
    }
  }

  // Compute stats per well
  const wellResults: WellResult[] = pixelWells.map(pw => {
    const coloniesInWell = wellColoniesMap[pw.id] || [];
    const wellArea = Math.PI * pw.rSq;
    const totalColonyArea = coloniesInWell.reduce((sum, c) => sum + c.area, 0);
    const areaPct = wellArea > 0 ? Math.min(100, (totalColonyArea / wellArea) * 100) : 0;

    return {
      wellId: pw.id,
      wellName: pw.name,
      count: coloniesInWell.length,
      areaPct: parseFloat(areaPct.toFixed(2)),
      colonies: coloniesInWell
    };
  });

  const totalCount = allColonies.length;
  const counts = wellResults.map(w => w.count);
  const meanCount = counts.length > 0 
    ? counts.reduce((a, b) => a + b, 0) / counts.length 
    : 0;
  const variance = counts.length > 1
    ? counts.reduce((sum, c) => sum + Math.pow(c - meanCount, 2), 0) / (counts.length - 1)
    : 0;
  const sdCount = Math.sqrt(variance);

  return {
    wellResults,
    allColonies,
    totalCount,
    meanCount: parseFloat(meanCount.toFixed(1)),
    sdCount: parseFloat(sdCount.toFixed(1))
  };
};

export const ColonyTool: React.FC = () => {
  const [images, setImages] = useState<ColonyImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Settings
  const [settings, setSettings] = useState<ProcessSettings>({
    threshold: 160,
    minSize: 20,
    maxSize: 10000,
    circularMask: true,
    invertColors: false
  });

  // Well Layout & ROIs
  const [layoutMode, setLayoutMode] = useState<WellLayoutMode>('triplicate_h');
  const [wells, setWells] = useState<WellROI[]>(() => generateDefaultROIs('triplicate_h'));
  const [selectedWellId, setSelectedWellId] = useState<string | null>(null);

  // Quick adjust sliders
  const [globalRadius, setGlobalRadius] = useState<number>(0.14);
  const [spacingRatio, setSpacingRatio] = useState<number>(0.30); // Distance between adjacent wells
  const [activeTab, setActiveTab] = useState<'params' | 'wells'>('wells');
  const [statsView, setStatsView] = useState<'summary' | 'details'>('summary');

  // Canvas Refs & Dragging
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingWellId, setDraggingWellId] = useState<string | null>(null);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    initialXRatio: number;
    initialYRatio: number;
  } | null>(null);

  // When layoutMode changes, reset wells
  const handleLayoutModeChange = (mode: WellLayoutMode) => {
    setLayoutMode(mode);
    const newWells = generateDefaultROIs(mode);
    setWells(newWells);
    if (mode === 'single') {
      setGlobalRadius(0.46);
    } else if (mode === 'six_well') {
      setGlobalRadius(0.13);
    } else {
      setGlobalRadius(0.14);
    }
  };

  // Adjust all wells' radius
  const handleGlobalRadiusChange = (newRadius: number) => {
    setGlobalRadius(newRadius);
    setWells(prev => prev.map(w => ({ ...w, radiusRatio: newRadius })));
  };

  // Adjust spacing for triplicate modes
  const handleSpacingChange = (newSpacing: number) => {
    setSpacingRatio(newSpacing);
    if (layoutMode === 'triplicate_h') {
      setWells(prev => {
        if (prev.length < 3) return prev;
        const midX = prev[1]?.xRatio || 0.50;
        return [
          { ...prev[0], xRatio: Math.max(0.08, midX - newSpacing) },
          { ...prev[1] },
          { ...prev[2], xRatio: Math.min(0.92, midX + newSpacing) }
        ];
      });
    } else if (layoutMode === 'triplicate_v') {
      setWells(prev => {
        if (prev.length < 3) return prev;
        const midY = prev[1]?.yRatio || 0.50;
        return [
          { ...prev[0], yRatio: Math.max(0.08, midY - newSpacing) },
          { ...prev[1] },
          { ...prev[2], yRatio: Math.min(0.92, midY + newSpacing) }
        ];
      });
    }
  };

  // Shift all wells by delta
  const handleShiftAll = (dx: number, dy: number) => {
    setWells(prev => prev.map(w => ({
      ...w,
      xRatio: Math.max(0.05, Math.min(0.95, w.xRatio + dx)),
      yRatio: Math.max(0.05, Math.min(0.95, w.yRatio + dy))
    })));
  };

  // Add custom well
  const handleAddWell = () => {
    const newId = `well-${Date.now()}`;
    const newName = `Rep ${wells.length + 1}`;
    setWells(prev => [
      ...prev,
      { id: newId, name: newName, xRatio: 0.5, yRatio: 0.5, radiusRatio: globalRadius }
    ]);
    setSelectedWellId(newId);
  };

  // Remove selected well
  const handleRemoveWell = (id: string) => {
    if (wells.length <= 1) return;
    setWells(prev => prev.filter(w => w.id !== id));
    if (selectedWellId === id) setSelectedWellId(null);
  };

  // Upload handler
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);

    const newImages: ColonyImage[] = [];
    for (let i = 0; i < files.length; i++) {
      const src = await processImageFile(files[i]);
      if (src) {
        newImages.push({
          id: Date.now() + i + Math.random().toString(),
          name: files[i].name,
          group: 'Group 1',
          src: src,
          totalCount: null,
          meanCount: null,
          sdCount: null,
          wellResults: [],
          colonies: [],
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
    setImages(prev => prev.filter(img => img.id !== id));
    if (activeImageId === id) setActiveImageId(null);
  };

  const updateImageGroup = (id: string, group: string) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, group } : img));
  };

  // Single active image analysis
  const analyzeActiveImage = useCallback(() => {
    if (!activeImageId) return;
    const imgData = images.find(i => i.id === activeImageId);
    if (!imgData) return;

    setIsProcessing(true);
    setTimeout(() => {
      const img = new Image();
      img.src = imgData.src;
      img.onload = () => {
        const result = processColonyImageWithWells(img, settings, wells);
        setImages(prev => prev.map(item => 
          item.id === activeImageId 
            ? { 
                ...item, 
                processed: true,
                totalCount: result.totalCount,
                meanCount: result.meanCount,
                sdCount: result.sdCount,
                wellResults: result.wellResults,
                colonies: result.allColonies,
                width: img.width,
                height: img.height
              }
            : item
        ));
        setIsProcessing(false);
      };
    }, 50);
  }, [activeImageId, images, settings, wells]);

  // Batch analyze all images
  const analyzeAll = () => {
    if (images.length === 0) return;
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
        const result = processColonyImageWithWells(img, settings, wells);
        setImages(prev => prev.map(item => 
          item.id === imgData.id 
            ? { 
                ...item, 
                processed: true, 
                totalCount: result.totalCount,
                meanCount: result.meanCount,
                sdCount: result.sdCount,
                wellResults: result.wellResults,
                colonies: result.allColonies,
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

  // Canvas Coordinate Converter
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  // Mouse Dragging on Canvas to move wells
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    const canvas = canvasRef.current;
    if (!coords || !canvas) return;

    const minDim = Math.min(canvas.width, canvas.height);

    // Find if clicked near any well
    for (let i = wells.length - 1; i >= 0; i--) {
      const w = wells[i];
      const cx = w.xRatio * canvas.width;
      const cy = w.yRatio * canvas.height;
      const r = w.radiusRatio * minDim;
      const dist = Math.hypot(coords.x - cx, coords.y - cy);

      if (dist <= r + 10) {
        setDraggingWellId(w.id);
        setSelectedWellId(w.id);
        dragStartRef.current = {
          startX: coords.x,
          startY: coords.y,
          initialXRatio: w.xRatio,
          initialYRatio: w.yRatio
        };
        return;
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const coords = getCanvasCoords(e);
    if (!coords) return;

    if (draggingWellId && dragStartRef.current) {
      const dx = coords.x - dragStartRef.current.startX;
      const dy = coords.y - dragStartRef.current.startY;
      const newXRatio = Math.max(0.05, Math.min(0.95, dragStartRef.current.initialXRatio + dx / canvas.width));
      const newYRatio = Math.max(0.05, Math.min(0.95, dragStartRef.current.initialYRatio + dy / canvas.height));

      setWells(prev => prev.map(w => 
        w.id === draggingWellId 
          ? { ...w, xRatio: newXRatio, yRatio: newYRatio }
          : w
      ));
    } else {
      // Hover detection to update cursor
      const minDim = Math.min(canvas.width, canvas.height);
      let isOverWell = false;
      for (const w of wells) {
        const cx = w.xRatio * canvas.width;
        const cy = w.yRatio * canvas.height;
        const r = w.radiusRatio * minDim;
        if (Math.hypot(coords.x - cx, coords.y - cy) <= r + 8) {
          isOverWell = true;
          break;
        }
      }
      canvas.style.cursor = isOverWell ? 'grab' : 'crosshair';
    }
  };

  const handleMouseUp = () => {
    if (draggingWellId) {
      setDraggingWellId(null);
      dragStartRef.current = null;
    }
  };

  // Canvas Rendering
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

      const minDim = Math.min(canvas.width, canvas.height);

      // Draw Well Masks & Outlines
      wells.forEach((w) => {
        const cx = w.xRatio * canvas.width;
        const cy = w.yRatio * canvas.height;
        const r = w.radiusRatio * minDim;
        const isSelected = selectedWellId === w.id;

        // Mask outer region shading if enabled
        if (settings.circularMask) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? '#f59e0b' : '#a855f7';
          ctx.lineWidth = isSelected ? 3.5 : 2;
          ctx.setLineDash(isSelected ? [6, 3] : []);
          ctx.stroke();
          ctx.restore();
        }

        // Center crosshair / grab handle
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#f59e0b' : '#a855f7';
        ctx.fill();

        // Well Label Badge
        const wellRes = imgData.wellResults.find(r => r.wellId === w.id);
        const countText = wellRes ? `${w.name}: ${wellRes.count}个` : w.name;
        
        ctx.save();
        ctx.font = 'bold 13px sans-serif';
        const textWidth = ctx.measureText(countText).width;
        const badgeY = Math.max(22, cy - r - 10);
        
        ctx.fillStyle = isSelected ? 'rgba(245, 158, 11, 0.9)' : 'rgba(15, 23, 42, 0.75)';
        ctx.beginPath();
        ctx.roundRect(cx - textWidth / 2 - 8, badgeY - 14, textWidth + 16, 22, 6);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(countText, cx, badgeY - 3);
        ctx.restore();
      });

      // Draw Detected Colonies
      if (imgData.processed && imgData.colonies) {
        imgData.colonies.forEach(c => {
          ctx.beginPath();
          ctx.arc(c.x, c.y, c.radius + 2, 0, Math.PI * 2);
          ctx.strokeStyle = '#ec4899'; // Pink
          ctx.lineWidth = 2;
          ctx.fillStyle = 'rgba(236, 72, 153, 0.25)';
          ctx.fill();
          ctx.stroke();
        });
      }
    };
  }, [activeImageId, images, wells, selectedWellId, settings.circularMask]);

  // Statistics Calculation (by Group)
  const groupStats = useMemo(() => {
    const groups: Record<string, { total: number; values: number[]; wellCounts: number }> = {};

    images.filter(i => i.processed).forEach(img => {
      const gName = img.group || 'Group 1';
      if (!groups[gName]) {
        groups[gName] = { total: 0, values: [], wellCounts: 0 };
      }

      // If image has multiple wells (triplicates), add each well's count as an observation
      if (img.wellResults && img.wellResults.length > 0) {
        img.wellResults.forEach(w => {
          groups[gName].values.push(w.count);
          groups[gName].total += w.count;
          groups[gName].wellCounts += 1;
        });
      } else if (img.totalCount !== null) {
        groups[gName].values.push(img.totalCount);
        groups[gName].total += img.totalCount;
        groups[gName].wellCounts += 1;
      }
    });

    return Object.entries(groups).map(([name, stats]) => {
      const n = stats.values.length;
      const mean = n > 0 ? stats.total / n : 0;
      const variance = n > 1 
        ? stats.values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1) 
        : 0;
      const sd = Math.sqrt(variance);
      const cv = mean > 0 ? (sd / mean) * 100 : 0;

      return {
        name,
        n,
        mean: parseFloat(mean.toFixed(1)),
        sd: parseFloat(sd.toFixed(1)),
        cv: parseFloat(cv.toFixed(1)),
        error: [
          parseFloat(Math.max(0, mean - sd).toFixed(1)),
          parseFloat((mean + sd).toFixed(1))
        ]
      };
    });
  }, [images]);

  // CSV Export
  const handleExportCsv = () => {
    let csv = "\uFEFF分组 (Group),图片名称 (Image),孔位/重复 (Well/Rep),克隆计数 (Colony Count),覆盖面积比 (Area %),组均值 (Group Mean),组标准差 (Group SD)\n";

    images.forEach(img => {
      const gStat = groupStats.find(g => g.name === img.group);
      const meanStr = gStat ? gStat.mean.toString() : '';
      const sdStr = gStat ? gStat.sd.toString() : '';

      if (img.wellResults && img.wellResults.length > 0) {
        img.wellResults.forEach(w => {
          csv += `"${img.group}","${img.name}","${w.wellName}",${w.count},"${w.areaPct}%",${meanStr},${sdStr}\n`;
        });
      } else {
        csv += `"${img.group}","${img.name}","全部",${img.totalCount || 0},"-",${meanStr},${sdStr}\n`;
      }
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Colony_Formation_Triplicates_Results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeImgData = images.find(i => i.id === activeImageId);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Title Header */}
      <div className="flex items-center gap-4 mb-2">
        <div className="bg-fuchsia-100 p-3 rounded-2xl text-fuchsia-600">
          <Disc size={32} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">克隆形成定量分析</h2>
          <p className="text-slate-500">支持单孔与多孔/三重复（1×3水平、3×1垂直、6孔板）独立识别计数与统计</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 min-h-[620px]">
        {/* LEFT: Upload & Image List */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <input 
              type="file" 
              accept="image/*,.tif,.tiff" 
              onChange={handleUpload} 
              multiple 
              id="colony-upload" 
              className="hidden" 
            />
            <label 
              htmlFor="colony-upload" 
              className="w-full bg-fuchsia-50 hover:bg-fuchsia-100 text-fuchsia-700 border border-dashed border-fuchsia-200 rounded-lg py-3 flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors"
            >
              <Upload size={18} /> 上传克隆图片 (单孔或三重复)
            </label>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col h-[520px]">
            <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="font-bold text-slate-700 text-sm">图片列表 ({images.length})</span>
              <button 
                onClick={() => setImages([])} 
                className="text-slate-400 hover:text-red-500 transition-colors"
                title="清空列表"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {images.map(img => (
                <div 
                  key={img.id} 
                  onClick={() => setActiveImageId(img.id)}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                    activeImageId === img.id 
                      ? 'bg-fuchsia-50 border-fuchsia-400 ring-1 ring-fuchsia-400' 
                      : 'bg-white border-slate-200 hover:border-fuchsia-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 bg-slate-100 rounded-md overflow-hidden shrink-0 relative border border-slate-200">
                      <img src={img.src} alt="" className="w-full h-full object-cover" />
                      {img.processed && <div className="absolute inset-0 bg-fuchsia-500/10" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-700 truncate mb-1" title={img.name}>
                        {img.name}
                      </div>
                      <input 
                        value={img.group}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateImageGroup(img.id, e.target.value)}
                        className="w-full text-[11px] px-1.5 py-0.5 border border-slate-200 rounded bg-slate-50 mb-1 focus:bg-white focus:border-fuchsia-400 outline-none"
                        placeholder="分组名称 (如 Control)"
                      />

                      {/* Well Results Badges */}
                      {img.processed ? (
                        <div className="space-y-1">
                          {img.wellResults && img.wellResults.length > 1 ? (
                            <>
                              <div className="text-[10px] text-fuchsia-700 font-bold flex items-center justify-between">
                                <span>均值: {img.meanCount} ± {img.sdCount}</span>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); removeImage(img.id); }} 
                                  className="text-slate-300 hover:text-red-400"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {img.wellResults.map((w) => (
                                  <span 
                                    key={w.wellId} 
                                    className="text-[9px] bg-fuchsia-100/70 text-fuchsia-800 px-1 py-0.5 rounded font-mono"
                                  >
                                    {w.wellName}: {w.count}
                                  </span>
                                ))}
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-fuchsia-600">
                                {img.totalCount} colonies
                              </span>
                              <button 
                                onClick={(e) => { e.stopPropagation(); removeImage(img.id); }} 
                                className="text-slate-300 hover:text-red-400"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>待分析</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeImage(img.id); }} 
                            className="text-slate-300 hover:text-red-400"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
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
                  className="w-full bg-fuchsia-600 hover:bg-fuchsia-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:bg-slate-300 transition-colors shadow-sm shadow-fuchsia-200"
                >
                  {isProcessing ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />} 
                  批量分析所有图片
                </button>
              </div>
            )}
          </div>
        </div>

        {/* CENTER: Settings, Well Layout & Interactive Canvas */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3.5 space-y-3">
            {/* Top Toolbar: Mode Switch & Tabs */}
            <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
                <button
                  onClick={() => handleLayoutModeChange('triplicate_h')}
                  className={`text-xs px-2.5 py-1 rounded font-medium transition-all ${
                    layoutMode === 'triplicate_h' ? 'bg-white text-fuchsia-700 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="图片中包含一排3个孔"
                >
                  水平三重复 (1×3)
                </button>
                <button
                  onClick={() => handleLayoutModeChange('triplicate_v')}
                  className={`text-xs px-2.5 py-1 rounded font-medium transition-all ${
                    layoutMode === 'triplicate_v' ? 'bg-white text-fuchsia-700 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="图片中包含一列3个孔"
                >
                  垂直三重复 (3×1)
                </button>
                <button
                  onClick={() => handleLayoutModeChange('single')}
                  className={`text-xs px-2.5 py-1 rounded font-medium transition-all ${
                    layoutMode === 'single' ? 'bg-white text-fuchsia-700 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="单张图片为单个培养皿或单孔"
                >
                  单孔/单皿
                </button>
                <button
                  onClick={() => handleLayoutModeChange('six_well')}
                  className={`text-xs px-2.5 py-1 rounded font-medium transition-all ${
                    layoutMode === 'six_well' ? 'bg-white text-fuchsia-700 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="整块6孔板"
                >
                  六孔板 (2×3)
                </button>
                <button
                  onClick={() => handleLayoutModeChange('custom')}
                  className={`text-xs px-2.5 py-1 rounded font-medium transition-all ${
                    layoutMode === 'custom' ? 'bg-white text-fuchsia-700 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="自定义孔位置与数量"
                >
                  自定义
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('wells')}
                  className={`text-xs px-2 py-1 rounded font-medium flex items-center gap-1 ${
                    activeTab === 'wells' ? 'bg-fuchsia-100 text-fuchsia-800' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <CircleDot size={13} /> 孔位调节
                </button>
                <button
                  onClick={() => setActiveTab('params')}
                  className={`text-xs px-2 py-1 rounded font-medium flex items-center gap-1 ${
                    activeTab === 'params' ? 'bg-fuchsia-100 text-fuchsia-800' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Sliders size={13} /> 识别参数
                </button>
              </div>
            </div>

            {/* Sub Controls: Well Layout Tuning */}
            {activeTab === 'wells' && (
              <div className="space-y-2.5 text-xs text-slate-600 bg-slate-50/70 p-2.5 rounded-lg border border-slate-200/80">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                  {/* Well Radius Slider */}
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-slate-500 font-medium">孔半径:</span>
                    <input 
                      type="range" 
                      min="0.05" 
                      max="0.48" 
                      step="0.005"
                      value={globalRadius}
                      onChange={e => handleGlobalRadiusChange(parseFloat(e.target.value))}
                      className="flex-1 h-1.5 accent-fuchsia-600"
                    />
                    <span className="font-mono text-[11px] text-slate-500 w-8 text-right">
                      {Math.round(globalRadius * 100)}%
                    </span>
                  </div>

                  {/* Spacing Slider (for multi-well) */}
                  {layoutMode.startsWith('triplicate') && (
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-slate-500 font-medium">孔间距:</span>
                      <input 
                        type="range" 
                        min="0.15" 
                        max="0.45" 
                        step="0.01"
                        value={spacingRatio}
                        onChange={e => handleSpacingChange(parseFloat(e.target.value))}
                        className="flex-1 h-1.5 accent-fuchsia-600"
                      />
                      <span className="font-mono text-[11px] text-slate-500 w-8 text-right">
                        {Math.round(spacingRatio * 100)}%
                      </span>
                    </div>
                  )}

                  {/* Shift Buttons */}
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 font-medium mr-1">微移:</span>
                    <button 
                      onClick={() => handleShiftAll(-0.015, 0)} 
                      className="px-1.5 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-100 font-mono text-[11px]" 
                      title="左移"
                    >
                      ←
                    </button>
                    <button 
                      onClick={() => handleShiftAll(0.015, 0)} 
                      className="px-1.5 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-100 font-mono text-[11px]" 
                      title="右移"
                    >
                      →
                    </button>
                    <button 
                      onClick={() => handleShiftAll(0, -0.015)} 
                      className="px-1.5 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-100 font-mono text-[11px]" 
                      title="上移"
                    >
                      ↑
                    </button>
                    <button 
                      onClick={() => handleShiftAll(0, 0.015)} 
                      className="px-1.5 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-100 font-mono text-[11px]" 
                      title="下移"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleLayoutModeChange(layoutMode)}
                      className="ml-auto px-2 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-100 text-[11px] text-slate-600 flex items-center gap-1"
                      title="重置到预设居中位置"
                    >
                      <RotateCcw size={11} /> 复位
                    </button>
                  </div>
                </div>

                {/* Additional custom wells management */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">当前共有 <strong className="text-fuchsia-600">{wells.length}</strong> 个孔选区</span>
                    {layoutMode === 'custom' && (
                      <button
                        onClick={handleAddWell}
                        className="text-[11px] text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 px-2 py-0.5 rounded hover:bg-fuchsia-100 flex items-center gap-1 font-medium"
                      >
                        <Plus size={12} /> 添加孔
                      </button>
                    )}
                    {layoutMode === 'custom' && selectedWellId && (
                      <button
                        onClick={() => handleRemoveWell(selectedWellId)}
                        className="text-[11px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded hover:bg-red-100 flex items-center gap-1"
                      >
                        <Trash2 size={12} /> 删除选定孔
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Move size={12} /> 提示：可在画布上直接按住圆圈拖拽微调位置
                  </div>
                </div>
              </div>
            )}

            {/* Sub Controls: Detection Parameters */}
            {activeTab === 'params' && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50/70 p-2.5 rounded-lg border border-slate-200/80 text-xs">
                {/* Threshold */}
                <div>
                  <div className="flex justify-between text-slate-500 mb-1">
                    <span>颜色深度阈值</span>
                    <span className="font-mono font-bold text-fuchsia-600">{settings.threshold}</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="254" 
                    value={settings.threshold} 
                    onChange={e => setSettings(s => ({ ...s, threshold: parseInt(e.target.value) }))}
                    className="w-full h-1.5 accent-fuchsia-600" 
                  />
                </div>

                {/* Min Size */}
                <div>
                  <label className="block text-slate-500 mb-1">最小尺寸 (像素)</label>
                  <input 
                    type="number" 
                    value={settings.minSize} 
                    onChange={e => setSettings(s => ({ ...s, minSize: Math.max(1, parseInt(e.target.value) || 1) }))}
                    className="w-full border border-slate-200 rounded px-2 py-1 bg-white outline-none focus:border-fuchsia-400"
                  />
                </div>

                {/* Max Size */}
                <div>
                  <label className="block text-slate-500 mb-1">最大尺寸 (像素)</label>
                  <input 
                    type="number" 
                    value={settings.maxSize} 
                    onChange={e => setSettings(s => ({ ...s, maxSize: parseInt(e.target.value) || 10000 }))}
                    className="w-full border border-slate-200 rounded px-2 py-1 bg-white outline-none focus:border-fuchsia-400"
                  />
                </div>

                {/* Mask & Invert */}
                <div className="flex flex-col justify-center gap-1.5">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={settings.circularMask} 
                      onChange={e => setSettings(s => ({ ...s, circularMask: e.target.checked }))}
                      className="rounded text-fuchsia-600 focus:ring-fuchsia-500"
                    />
                    <span className="text-slate-600">孔内限制 (掩膜过滤)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={settings.invertColors} 
                      onChange={e => setSettings(s => ({ ...s, invertColors: e.target.checked }))}
                      className="rounded text-fuchsia-600 focus:ring-fuchsia-500"
                    />
                    <span className="text-slate-600">深色背景亮斑 (反转)</span>
                  </label>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-between items-center pt-1">
              <div className="text-xs text-slate-500">
                {activeImgData?.processed ? (
                  <span className="text-emerald-600 font-medium flex items-center gap-1">
                    <Check size={14} /> 已完成分析 (共 {activeImgData.totalCount} 个克隆)
                  </span>
                ) : (
                  <span>调整孔位与参数后点击重新识别</span>
                )}
              </div>
              <button 
                onClick={analyzeActiveImage} 
                disabled={!activeImageId || isProcessing} 
                className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:bg-slate-300 shadow-sm shadow-fuchsia-200 flex items-center gap-1.5"
              >
                {isProcessing ? <RefreshCw className="animate-spin" size={14} /> : <Play size={14} />} 
                重新识别当前图片
              </button>
            </div>
          </div>

          {/* Interactive Canvas View */}
          <div 
            className="bg-slate-900 rounded-xl flex-1 overflow-hidden relative flex items-center justify-center border border-slate-800 min-h-[460px]" 
            ref={containerRef}
          >
            {!activeImageId ? (
              <div className="text-slate-500 flex flex-col items-center p-6 text-center">
                <Eye size={48} className="mb-2 opacity-50" />
                <p className="font-medium text-slate-400">选择或上传一张图片进行分析</p>
                <p className="text-xs text-slate-600 mt-1">支持结晶紫染色、亚甲蓝染色等克隆形成照片</p>
              </div>
            ) : (
              <>
                <div className="absolute top-3 left-3 z-10 bg-black/70 text-white text-xs px-2.5 py-1.5 rounded-md backdrop-blur-sm pointer-events-none flex items-center gap-2">
                  <span className="font-medium">{activeImgData?.name}</span>
                  <span className="text-fuchsia-400 font-bold">[{layoutMode === 'triplicate_h' ? '水平三重复' : layoutMode === 'triplicate_v' ? '垂直三重复' : layoutMode === 'six_well' ? '六孔板' : layoutMode === 'single' ? '单孔' : '自定义'}]</span>
                </div>

                <canvas 
                  ref={canvasRef} 
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  className="max-w-full max-h-full object-contain cursor-crosshair select-none" 
                />
              </>
            )}

            {isProcessing && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20">
                <div className="bg-white/95 text-slate-800 font-medium px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 text-sm">
                  <RefreshCw className="animate-spin text-fuchsia-600" size={20} /> 
                  正在识别克隆团...
                </div>
              </div>
            )}
          </div>

          {/* Prompt Banner */}
          <div className="bg-blue-50 text-blue-900 text-xs p-3 rounded-xl flex gap-2.5 items-start border border-blue-100">
            <Info size={16} className="mt-0.5 text-blue-600 shrink-0" />
            <div className="space-y-1">
              <p>
                <strong>三重复多孔操作指南：</strong>
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-blue-800">
                <li>
                  <strong>选区对齐：</strong> 可以在上方选择【水平三重复】或【垂直三重复】模式，然后在画布上<strong>直接用鼠标拖拽紫色圆圈</strong>对齐照片里的各个孔。
                </li>
                <li>
                  <strong>独立统计：</strong> 系统会独立计算 Rep 1、Rep 2、Rep 3 的克隆数，并在右侧直接计算<strong>三重复均值 (Mean) 与标准差 (SD)</strong>。
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* RIGHT: Stats & Charts */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <BarChart3 size={18} className="text-fuchsia-600" /> 统计结果
              </h3>
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs">
                <button
                  onClick={() => setStatsView('summary')}
                  className={`px-2 py-1 rounded transition-colors ${
                    statsView === 'summary' ? 'bg-white text-fuchsia-700 font-bold shadow-xs' : 'text-slate-500'
                  }`}
                >
                  按组汇总
                </button>
                <button
                  onClick={() => setStatsView('details')}
                  className={`px-2 py-1 rounded transition-colors ${
                    statsView === 'details' ? 'bg-white text-fuchsia-700 font-bold shadow-xs' : 'text-slate-500'
                  }`}
                >
                  各孔明细
                </button>
              </div>
            </div>

            {/* Bar Chart with Error Bars (Group Mean ± SD) */}
            {groupStats.length > 0 ? (
              <div className="h-[210px] w-full shrink-0 mb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={groupStats} margin={{ top: 15, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip 
                      cursor={{ fill: '#fdf4ff' }} 
                      contentStyle={{ borderRadius: 8, fontSize: 12, borderColor: '#f0abfc' }}
                      formatter={(val: any, name: any, item: any) => {
                        return [`${val} ± ${item.payload.sd} (n=${item.payload.n})`, '克隆均值'];
                      }}
                    />
                    <Bar dataKey="mean" fill="#d946ef" radius={[4, 4, 0, 0]}>
                      <ErrorBar dataKey="error" width={4} strokeWidth={2} stroke="#a21caf" />
                      {groupStats.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={['#d946ef', '#8b5cf6', '#0ea5e9', '#f59e0b', '#10b981'][index % 5]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-sm py-12">
                <BarChart3 size={40} className="mb-2 opacity-20" />
                <p>暂无统计数据</p>
                <p className="text-xs text-slate-400 mt-1">上传图片并点击“识别”后显示</p>
              </div>
            )}

            {/* Table: Summary vs Details */}
            <div className="flex-1 overflow-y-auto border-t border-slate-100 pt-2 text-xs">
              {statsView === 'summary' ? (
                <table className="w-full text-left">
                  <thead className="text-slate-500 bg-slate-50/50">
                    <tr>
                      <th className="py-2 px-1">分组 (Group)</th>
                      <th className="py-2 text-center">样本数(n)</th>
                      <th className="py-2 text-right pr-1">Mean ± SD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groupStats.map(g => (
                      <tr key={g.name} className="hover:bg-slate-50/60">
                        <td className="py-2 px-1 font-semibold text-slate-700">{g.name}</td>
                        <td className="py-2 text-center text-slate-500 font-mono">{g.n}</td>
                        <td className="py-2 text-right pr-1 text-fuchsia-600 font-mono font-bold">
                          {g.mean} <span className="text-slate-400 text-[10px] font-normal">± {g.sd}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="space-y-3">
                  {images.filter(i => i.processed).map(img => (
                    <div key={img.id} className="bg-slate-50 rounded-lg p-2 border border-slate-200/80">
                      <div className="font-semibold text-slate-700 truncate mb-1 flex items-center justify-between text-[11px]">
                        <span title={img.name}>{img.name}</span>
                        <span className="text-fuchsia-600 font-mono">{img.meanCount} ± {img.sdCount}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {img.wellResults.map(w => (
                          <div key={w.wellId} className="bg-white p-1 rounded border border-slate-200 text-[10px]">
                            <div className="text-slate-400 truncate">{w.wellName}</div>
                            <div className="font-bold text-slate-800 font-mono">{w.count}个</div>
                            <div className="text-slate-400 text-[9px]">{w.areaPct}%</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CSV Export Button */}
            <button 
              onClick={handleExportCsv} 
              disabled={images.filter(i => i.processed).length === 0}
              className="w-full mt-4 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <Download size={14} /> 导出完整科研数据 CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
