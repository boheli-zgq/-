import React, { useState, useEffect, useMemo } from 'react';
import { Pipette, Calculator, Info, AlertCircle, Table2, CheckCircle2, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react';
import { ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Scatter, Legend } from 'recharts';

// --- Types ---

interface StandardPoint {
  id: string;
  conc: number;
  od: number;
}

interface StandardGroup {
  id: string;
  conc: number;
  ods: number[]; // Raw ODs
  correctedMeanOD: number; // After blank subtraction
  meanRawOD: number;
  cv: number; // Coefficient of Variation %
  isBlank: boolean;
}

interface Sample {
  id: string;
  name: string;
  od: number;
  dilution: number;
  conc?: number;
}

type RegressionModel = 'linear' | 'quadratic' | 'power' | '4pl';

interface RegressionResult {
  r2: number;
  equationStr: string;
  fn: (x: number) => number; // Calculate Conc (y) from OD (x)
  predict: (x: number) => number; // Calculate Conc (y) from OD (x) for charting
}

// --- Math Helpers ---

const calcMean = (arr: number[]) => arr.length > 0 ? arr.reduce((a,b)=>a+b, 0) / arr.length : 0;
const calcStdev = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const mean = calcMean(arr);
    return Math.sqrt(arr.reduce((a,b)=>a+Math.pow(b-mean, 2), 0) / (arr.length - 1));
};

// NOTE: All regressions now fit Conc = f(OD).
// x = OD, y = Conc

// Linear: y = mx + b
const fitLinear = (points: StandardPoint[]): RegressionResult | null => {
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  points.forEach(p => { 
      const x = p.od; 
      const y = p.conc; 
      sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; 
  });
  
  const denom = (n * sumX2 - sumX * sumX);
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  
  // R2
  const meanY = sumY / n;
  const ssTot = points.reduce((a, b) => a + Math.pow(b.conc - meanY, 2), 0);
  const ssRes = points.reduce((a, b) => a + Math.pow(b.conc - (slope * b.od + intercept), 2), 0);
  const r2 = ssTot !== 0 ? (1 - (ssRes / ssTot)) : 0;

  return {
    r2,
    equationStr: `Conc = ${slope.toFixed(4)} * OD + ${intercept.toFixed(4)}`,
    fn: (x) => slope * x + intercept,
    predict: (x) => slope * x + intercept
  };
};

// Quadratic: y = ax^2 + bx + c
const fitQuadratic = (points: StandardPoint[]): RegressionResult | null => {
  const n = points.length;
  if (n < 3) return null;

  let sX = 0, sX2 = 0, sX3 = 0, sX4 = 0, sY = 0, sXY = 0, sX2Y = 0;
  points.forEach(p => {
    const x = p.od; const y = p.conc; // Swapped
    sX += x; sX2 += x*x; sX3 += x*x*x; sX4 += x*x*x*x;
    sY += y; sXY += x*y; sX2Y += x*x*y;
  });

  // Solve 3x3 Linear System
  const det3x3 = (m: number[][]) => {
      return m[0][0]*(m[1][1]*m[2][2] - m[1][2]*m[2][1]) -
             m[0][1]*(m[1][0]*m[2][2] - m[1][2]*m[2][0]) +
             m[0][2]*(m[1][0]*m[2][1] - m[1][1]*m[2][0]);
  };

  const D = det3x3([[n, sX, sX2], [sX, sX2, sX3], [sX2, sX3, sX4]]);
  const Dc = det3x3([[sY, sX, sX2], [sXY, sX2, sX3], [sX2Y, sX3, sX4]]);
  const Db = det3x3([[n, sY, sX2], [sX, sXY, sX3], [sX2, sX2Y, sX4]]);
  const Da = det3x3([[n, sX, sY], [sX, sX2, sXY], [sX2, sX3, sX2Y]]);

  if (D === 0) return null;

  const c = Dc / D;
  const b = Db / D;
  const a = Da / D;

  // R2
  const meanY = sY / n;
  const ssTot = points.reduce((acc, p) => acc + Math.pow(p.conc - meanY, 2), 0);
  const ssRes = points.reduce((acc, p) => acc + Math.pow(p.conc - (a*p.od*p.od + b*p.od + c), 2), 0);
  const r2 = ssTot !== 0 ? (1 - (ssRes / ssTot)) : 0;

  return {
    r2,
    equationStr: `Conc = ${a.toFixed(5)} * OD² + ${b.toFixed(4)} * OD + ${c.toFixed(4)}`,
    fn: (x) => a * x * x + b * x + c,
    predict: (x) => a * x * x + b * x + c
  };
};

// Power (Log-Log): y = A * x^B  => Conc = A * OD^B
const fitPower = (points: StandardPoint[]): RegressionResult | null => {
  // Filter out zeros
  const validPoints = points.filter(p => p.conc > 0 && p.od > 0);
  if (validPoints.length < 2) return null;

  const n = validPoints.length;
  let sumLnX = 0, sumLnY = 0, sumLnXLnY = 0, sumLnX2 = 0;
  
  validPoints.forEach(p => {
    const lx = Math.log(p.od);   // X = OD
    const ly = Math.log(p.conc); // Y = Conc
    sumLnX += lx;
    sumLnY += ly;
    sumLnXLnY += lx * ly;
    sumLnX2 += lx * lx;
  });

  const denom = (n * sumLnX2 - sumLnX * sumLnX);
  if (denom === 0) return null;

  const B = (n * sumLnXLnY - sumLnX * sumLnY) / denom;
  const lnA = (sumLnY - B * sumLnX) / n;
  const A = Math.exp(lnA);

  // R2 calculation on original scale (Y=Conc)
  const meanY = points.reduce((a, b) => a + b.conc, 0) / points.length;
  const ssTot = points.reduce((a, b) => a + Math.pow(b.conc - meanY, 2), 0);
  const ssRes = points.reduce((a, b) => a + Math.pow(b.conc - (A * Math.pow(b.od, B)), 2), 0);
  const r2 = ssTot !== 0 ? (1 - (ssRes / ssTot)) : 0;

  return {
    r2,
    equationStr: `Conc = ${A.toFixed(4)} * OD^${B.toFixed(4)}`,
    fn: (x) => A * Math.pow(x, B),
    predict: (x) => A * Math.pow(x, B)
  };
};

// 4PL: y = d + (a - d) / (1 + (x / c)^b)
// Here y = Conc, x = OD
const fit4PL = (points: StandardPoint[]): RegressionResult | null => {
    if (points.length < 4) return null;

    // x=OD, y=Conc
    
    // Fixed Asymptotes Estimates (Min Conc and Max Conc)
    // We assume data covers the range reasonably well
    const minConc = Math.min(...points.map(p => p.conc));
    const maxConc = Math.max(...points.map(p => p.conc));
    
    // Slightly expand range to avoid Log(0)
    const fixedA = minConc * 0.95; // Min asymptote (Conc at low OD)
    const fixedD = maxConc * 1.05; // Max asymptote (Conc at high OD)

    // Linearization
    // y = d + (a-d)/(1+(x/c)^b)
    // (a-d)/(y-d) - 1 = (x/c)^b
    // ln( (a-d)/(y-d) - 1 ) = b*ln(x) - b*ln(c)
    // Y' = slope * X' + intercept
    // Y' = ln term
    // X' = ln(x) = ln(OD)
    // slope = b
    // intercept = -b*ln(c)

    const linearData = points.map(p => {
        const y = p.conc;
        const x = p.od;
        
        const numerator = fixedA - fixedD;
        const denominator = y - fixedD;
        if (denominator === 0) return null;
        
        const term = (numerator / denominator) - 1;
        if (term <= 0 || x <= 0) return null;

        return { Xp: Math.log(x), Yp: Math.log(term) };
    }).filter(p => p !== null) as {Xp: number, Yp: number}[];

    if (linearData.length < 2) return null;

    // Fit line
    let sLx = 0, sLy = 0, sLxLy = 0, sLx2 = 0;
    const count = linearData.length;
    linearData.forEach(p => { sLx += p.Xp; sLy += p.Yp; sLxLy += p.Xp*p.Yp; sLx2 += p.Xp*p.Xp; });
    
    const denom = (count * sLx2 - sLx * sLx);
    if (denom === 0) return null;

    const slope = (count * sLxLy - sLx * sLy) / denom; // b
    const intercept = (sLy - slope * sLx) / count; // -b*ln(c)
    
    const finalB = slope;
    const finalC = Math.exp(intercept / -finalB);

    // Calculate R2 (Y=Conc)
    const meanY = points.reduce((acc, p) => acc + p.conc, 0) / points.length;
    const ssTot = points.reduce((acc, p) => acc + Math.pow(p.conc - meanY, 2), 0);
    const ssRes = points.reduce((acc, p) => {
        const yPred = fixedD + (fixedA - fixedD) / (1 + Math.pow(p.od / finalC, finalB));
        return acc + Math.pow(p.conc - yPred, 2);
    }, 0);
    const r2 = ssTot !== 0 ? (1 - (ssRes / ssTot)) : 0;

    return {
        r2,
        equationStr: `4PL (EC50=${finalC.toFixed(2)}, Slope=${finalB.toFixed(2)})`,
        fn: (x) => fixedD + (fixedA - fixedD) / (1 + Math.pow(x / finalC, finalB)),
        predict: (x) => fixedD + (fixedA - fixedD) / (1 + Math.pow(x / finalC, finalB))
    };
};


export const BcaTool: React.FC = () => {
  // --- State ---
  const [unit, setUnit] = useState<string>('mg/mL');
  const [model, setModel] = useState<RegressionModel>('linear');
  const [subtractBlank, setSubtractBlank] = useState(true);
  const [standardsInput, setStandardsInput] = useState<string>("");
  const [showCurveDetails, setShowCurveDetails] = useState(true);

  // Default Samples
  const [samples, setSamples] = useState<Sample[]>([
    { id: 's1', name: 'Sample 1', od: 0.45, dilution: 1 },
    { id: 's2', name: 'Sample 2', od: 0.88, dilution: 5 },
  ]);

  // Init default standard curve text (With Multi-Replicates)
  useEffect(() => {
      const defaultText = 
`0\t0.05\t0.06
0.125\t0.15\t0.14
0.25\t0.28\t0.29
0.5\t0.55\t0.53
1.0\t1.05\t1.02
2.0\t1.95\t1.98`;
      setStandardsInput(defaultText);
  }, []);

  // --- Logic ---
  
  // 1. Parse Standards from Text Area (Support Replicates)
  const { allPoints, groupedPoints } = useMemo(() => {
      const all: StandardPoint[] = [];
      const grouped: StandardGroup[] = [];

      const lines = standardsInput.trim().split('\n');
      
      lines.forEach((line, idx) => {
          // Split by any common delimiter
          const parts = line.trim().split(/[\t, ]+/);
          if (parts.length < 2) return; // Need at least Conc + 1 OD

          const conc = parseFloat(parts[0]);
          if (isNaN(conc)) return;

          const ods: number[] = [];
          for(let i=1; i<parts.length; i++) {
              const val = parseFloat(parts[i]);
              if (!isNaN(val)) {
                  ods.push(val);
                  all.push({ id: `std-${idx}-${i}`, conc, od: val });
              }
          }

          if (ods.length > 0) {
              const meanRawOD = calcMean(ods);
              const sd = calcStdev(ods);
              const cv = meanRawOD > 0 ? (sd / meanRawOD) * 100 : 0;
              
              grouped.push({ 
                  id: `group-${idx}`,
                  conc, 
                  ods, 
                  meanRawOD, 
                  correctedMeanOD: meanRawOD, // will update later
                  cv,
                  isBlank: conc === 0 
              });
          }
      });

      return { allPoints: all, groupedPoints: grouped };
  }, [standardsInput]);

  // 2. Process Standards (Blank Correction)
  const { processedPoints, finalGroups, blankOD } = useMemo(() => {
    let blank = 0;
    
    if (subtractBlank && groupedPoints.length > 0) {
        // Find the group with Conc === 0, or the lowest conc
        const zeroGroup = groupedPoints.find(g => g.conc === 0) || groupedPoints[0];
        blank = zeroGroup.meanRawOD;
    }

    // Correct individual points (for regression)
    const processed = allPoints.map(p => ({
        ...p,
        od: Math.max(0, p.od - (subtractBlank ? blank : 0))
    }));

    // Correct Groups (for display)
    const finalG = groupedPoints.map(g => ({
        ...g,
        correctedMeanOD: Math.max(0, g.meanRawOD - (subtractBlank ? blank : 0))
    }));

    return { processedPoints: processed, finalGroups: finalG, blankOD: blank };
  }, [allPoints, groupedPoints, subtractBlank]);

  // 3. Perform Regression (Using ALL replicate points for best fit)
  const regression = useMemo(() => {
    if (processedPoints.length < 2) return null;
    
    // x = OD, y = Conc
    if (model === 'linear') return fitLinear(processedPoints);
    if (model === 'quadratic') return fitQuadratic(processedPoints);
    if (model === 'power') return fitPower(processedPoints);
    if (model === '4pl') return fit4PL(processedPoints);
    return null;
  }, [processedPoints, model]);

  // 4. Process Samples
  const computedSamples = useMemo(() => {
    if (!regression) return samples;
    
    return samples.map(s => {
      const correctedOD = Math.max(0.0001, s.od - (subtractBlank ? blankOD : 0));
      
      // Calculate Conc directly from OD
      const rawConc = regression.fn(correctedOD);
      
      // Ensure concentration isn't negative
      const validConc = rawConc < 0 || isNaN(rawConc) ? 0 : rawConc;
      return {
        ...s,
        conc: validConc * s.dilution
      };
    });
  }, [samples, regression, subtractBlank, blankOD]);

  // --- Handlers ---
  
  const updateSample = (id: string, field: keyof Sample, val: string) => {
    const num = val === '' ? 0 : parseFloat(val);
    if (field === 'name') {
       setSamples(prev => prev.map(s => s.id === id ? { ...s, name: val } : s));
    } else {
       setSamples(prev => prev.map(s => s.id === id ? { ...s, [field]: isNaN(num) ? 0 : num } : s));
    }
  };

  const addSample = () => {
    setSamples(prev => [...prev, { id: Date.now().toString(), name: `Sample ${prev.length + 1}`, od: 0, dilution: 1 }]);
  };

  const removeSample = (id: string) => {
     setSamples(prev => prev.filter(s => s.id !== id));
  };

  const handlePasteSamples = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const rows = text.trim().split(/\r\n|\n|\r/);
    
    const newSamples: Sample[] = rows.map((row, idx) => {
        const cols = row.split(/\t|,/).map(c => c.trim());
        let name = `Batch ${idx + 1}`;
        let od = 0;
        let dilution = 1;

        if (cols.length === 1) {
            od = parseFloat(cols[0]) || 0;
        } else if (cols.length === 2) {
            if (!isNaN(parseFloat(cols[0]))) {
                od = parseFloat(cols[0]);
                dilution = parseFloat(cols[1]) || 1;
            } else {
                name = cols[0];
                od = parseFloat(cols[1]) || 0;
            }
        } else if (cols.length >= 3) {
            name = cols[0];
            od = parseFloat(cols[1]) || 0;
            dilution = parseFloat(cols[2]) || 1;
        }

        return {
            id: Date.now().toString() + idx,
            name,
            od,
            dilution
        };
    });

    if (newSamples.length > 0) {
        if (confirm(`检测到 ${newSamples.length} 条数据，是否覆盖现有样品列表？(取消则追加)`)) {
            setSamples(newSamples);
        } else {
            setSamples(prev => [...prev, ...newSamples]);
        }
    }
  };

  // --- Chart Data ---
  const chartData = useMemo(() => {
    if (!regression || processedPoints.length === 0) return { points: processedPoints, line: [] };
    
    const maxOD = Math.max(...processedPoints.map(s => s.od));
    const minOD = Math.min(...processedPoints.map(s => s.od));
    
    // Generate smooth curve points (X = OD, Y = Conc)
    const lineData = [];
    const steps = 50;
    
    // Extend slightly
    const start = Math.max(0, minOD);
    const end = maxOD * 1.1;
    const stepSize = (end - start) / steps;

    for(let i=0; i<=steps; i++) {
        const x = start + i * stepSize; // x is OD
        lineData.push({ od: x, trend: regression.predict(x) }); // trend is Conc
    }
    
    return { points: processedPoints, line: lineData };
  }, [processedPoints, regression]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-orange-100 p-3 rounded-2xl text-orange-600">
                <Pipette size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">ELISA & BCA 蛋白定量分析</h2>
               <p className="text-slate-500">支持多复孔录入、自动计算变异系数 (CV%) 及多种拟合模型</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6">
           {/* LEFT: Configuration & Standards (4 cols) */}
           <div className="lg:col-span-4 space-y-6">
               
               {/* 1. Settings */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                   <div className="flex items-center justify-between mb-4">
                       <h3 className="font-bold text-slate-700 flex items-center gap-2">
                           <Calculator size={18} /> 参数设置
                       </h3>
                   </div>
                   
                   <div className="space-y-4">
                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1">浓度单位</label>
                           <div className="grid grid-cols-2 gap-2">
                               {['mg/mL', 'µg/mL', 'ng/mL', 'pg/mL'].map(u => (
                                   <button 
                                      key={u} 
                                      onClick={() => setUnit(u)}
                                      className={`text-xs py-1.5 px-2 rounded border transition-colors ${unit === u ? 'bg-orange-100 border-orange-300 text-orange-700 font-bold' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                   >
                                       {u}
                                   </button>
                               ))}
                           </div>
                       </div>

                       <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1">拟合模型 (Conc = f(OD))</label>
                           <select 
                                value={model}
                                onChange={(e) => setModel(e.target.value as any)}
                                className="w-full text-sm border-slate-300 rounded-md py-1.5 focus:border-orange-500 focus:ring-orange-500"
                           >
                               <option value="linear">Linear (Linear Regression)</option>
                               <option value="quadratic">Quadratic (Polynomial 2nd)</option>
                               <option value="power">Power (Allometric)</option>
                               <option value="4pl">4PL (4-Parameter Logistic)</option>
                           </select>
                       </div>

                       <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                           <span className="text-xs text-slate-600">扣除空白 (Blank Correction)</span>
                           <input type="checkbox" checked={subtractBlank} onChange={e => setSubtractBlank(e.target.checked)} className="rounded text-orange-600 focus:ring-orange-500" />
                       </div>
                       
                       {regression && (
                           <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1">
                               <div className="text-xs text-blue-500 font-bold uppercase tracking-wide">拟合结果 (R² = {regression.r2.toFixed(4)})</div>
                               <div className="font-mono text-[10px] text-blue-600 break-all">
                                   {regression.equationStr}
                               </div>
                           </div>
                       )}
                   </div>
               </div>

               {/* 2. Standards Input */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col h-[400px]">
                   <div className="flex items-center justify-between mb-2">
                       <h3 className="font-bold text-slate-700">标准品录入</h3>
                       <div className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">支持复孔</div>
                   </div>
                   <div className="text-xs text-slate-500 mb-2 p-2 bg-slate-50 rounded border border-slate-100">
                       格式：第一列浓度，后续列为OD复孔 (空格或Tab分隔)
                   </div>
                   <textarea
                       className="flex-1 w-full p-3 text-sm font-mono border border-slate-200 rounded-lg focus:border-orange-500 focus:ring-2 focus:ring-orange-200 outline-none resize-none bg-slate-50 whitespace-pre"
                       placeholder={`0\t0.05\t0.06\n0.125\t0.15\t0.14\n...`}
                       value={standardsInput}
                       onChange={(e) => setStandardsInput(e.target.value)}
                   />
               </div>
           </div>

           {/* MIDDLE/RIGHT: Chart & Samples (8 cols) */}
           <div className="lg:col-span-8 space-y-6">
               
               {/* 1. Chart & Stats */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                   <div className="flex items-center justify-between mb-4">
                       <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                           <Table2 size={16}/> 标准曲线 & 统计 (Standard Curve Statistics)
                       </h4>
                       <button onClick={() => setShowCurveDetails(!showCurveDetails)} className="text-slate-400 hover:text-slate-600">
                           {showCurveDetails ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                       </button>
                   </div>
                   
                   <div className={`grid md:grid-cols-2 gap-6 transition-all ${showCurveDetails ? 'opacity-100' : 'hidden opacity-0 h-0'}`}>
                        {/* Chart */}
                        <div className="h-[280px] w-full border border-slate-100 rounded-lg p-2 bg-slate-50">
                           <ResponsiveContainer width="100%" height="100%">
                               <ComposedChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                                   <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                   <XAxis 
                                        dataKey="od" 
                                        type="number" 
                                        name="OD" 
                                        label={{ value: 'OD (Absorbance)', position: 'bottom', offset: 0, style: { fill: '#64748b', fontSize: 12 } }}
                                        domain={['auto', 'auto']}
                                   />
                                   <YAxis 
                                        type="number" 
                                        name="Concentration" 
                                        label={{ value: `Conc (${unit})`, angle: -90, position: 'insideLeft', style: { fill: '#64748b', fontSize: 12 } }}
                                   />
                                   <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 8 }} />
                                   <Legend wrapperStyle={{ fontSize: 12 }} />
                                   
                                   {/* Regression Line */}
                                   <Line 
                                        data={chartData.line} 
                                        dataKey="trend" 
                                        stroke="#f97316" 
                                        strokeWidth={2} 
                                        dot={false} 
                                        name="Fit Curve" 
                                        isAnimationActive={false}
                                   />
                                   
                                   {/* Replicate Points */}
                                   <Scatter 
                                        data={chartData.points} 
                                        dataKey="conc" 
                                        fill="#3b82f6" 
                                        name="Standard Points" 
                                        shape="circle"
                                   />
                               </ComposedChart>
                           </ResponsiveContainer>
                       </div>

                       {/* Stats Table */}
                       <div className="overflow-y-auto max-h-[280px]">
                           <table className="w-full text-xs text-left">
                               <thead className="bg-slate-100 text-slate-500 font-medium sticky top-0">
                                   <tr>
                                       <th className="px-2 py-2">Conc</th>
                                       <th className="px-2 py-2">Raw ODs</th>
                                       <th className="px-2 py-2">Mean OD</th>
                                       <th className="px-2 py-2 text-right">CV%</th>
                                   </tr>
                               </thead>
                               <tbody className="divide-y divide-slate-100">
                                   {finalGroups.map((g) => (
                                       <tr key={g.id} className="hover:bg-slate-50">
                                           <td className="px-2 py-2 font-bold text-slate-700">{g.conc}</td>
                                           <td className="px-2 py-2 text-slate-500 font-mono">
                                               {g.ods.map(o => o.toFixed(3)).join(', ')}
                                           </td>
                                           <td className="px-2 py-2 text-blue-600 font-medium">
                                               {g.meanRawOD.toFixed(3)}
                                           </td>
                                           <td className={`px-2 py-2 text-right font-medium ${g.cv > 15 ? 'text-red-500' : 'text-emerald-600'}`}>
                                               {g.cv.toFixed(1)}%
                                               {g.cv > 15 && <AlertCircle size={10} className="inline ml-1" />}
                                           </td>
                                       </tr>
                                   ))}
                               </tbody>
                           </table>
                           {finalGroups.length === 0 && (
                               <div className="p-4 text-center text-slate-400">请输入标准品数据</div>
                           )}
                           <div className="text-[10px] text-slate-400 p-2 border-t border-slate-100 mt-2">
                               * CV > 15% 建议检查复孔操作误差
                           </div>
                       </div>
                   </div>
               </div>

               {/* 2. Sample Calculation */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                   <div className="flex justify-between items-center mb-4">
                       <h3 className="font-bold text-slate-700 flex items-center gap-2">
                           <Pipette size={18} className="text-blue-500" /> 样品计算
                       </h3>
                       <div className="flex gap-2">
                           <button onClick={addSample} className="bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded text-xs font-bold transition-colors">添加样品</button>
                           <button className="bg-slate-100 text-slate-600 hover:bg-slate-200 px-3 py-1.5 rounded text-xs transition-colors relative">
                               粘贴数据 (Excel)
                               <input 
                                   type="text" 
                                   className="absolute inset-0 opacity-0 cursor-pointer" 
                                   onPaste={handlePasteSamples}
                               />
                           </button>
                       </div>
                   </div>

                   <div className="overflow-x-auto rounded-lg border border-slate-200">
                       <table className="w-full text-sm text-left">
                           <thead className="bg-slate-100 text-slate-500 font-medium">
                               <tr>
                                   <th className="px-4 py-3 w-40">Sample Name</th>
                                   <th className="px-4 py-3 w-24">OD Value</th>
                                   <th className="px-4 py-3 w-24">Dilution</th>
                                   <th className="px-4 py-3 text-right">Conc ({unit})</th>
                                   <th className="px-4 py-3 w-12"></th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                               {computedSamples.map((sample) => (
                                   <tr key={sample.id} className="hover:bg-slate-50">
                                       <td className="px-4 py-2">
                                           <input 
                                               type="text" 
                                               value={sample.name} 
                                               onChange={(e) => updateSample(sample.id, 'name', e.target.value)}
                                               className="w-full bg-transparent outline-none border-b border-transparent focus:border-orange-300 text-slate-700 font-medium"
                                           />
                                       </td>
                                       <td className="px-4 py-2">
                                           <input 
                                               type="number" 
                                               value={sample.od} 
                                               onChange={(e) => updateSample(sample.id, 'od', e.target.value)}
                                               className="w-full bg-transparent outline-none border-b border-transparent focus:border-orange-300 text-slate-600"
                                           />
                                       </td>
                                       <td className="px-4 py-2">
                                           <input 
                                               type="number" 
                                               value={sample.dilution} 
                                               onChange={(e) => updateSample(sample.id, 'dilution', e.target.value)}
                                               className="w-full bg-transparent outline-none border-b border-transparent focus:border-orange-300 text-slate-600"
                                           />
                                       </td>
                                       <td className="px-4 py-2 text-right font-bold text-orange-600 font-mono bg-orange-50/30">
                                           {sample.conc?.toFixed(4)}
                                       </td>
                                       <td className="px-4 py-2 text-center">
                                           <button onClick={() => removeSample(sample.id)} className="text-slate-300 hover:text-red-500">
                                               <Info size={14} className="sr-only" /> {/* Using Trash Icon usually */}
                                               ×
                                           </button>
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                       {computedSamples.length === 0 && (
                           <div className="p-8 text-center text-slate-400">暂无样品数据</div>
                       )}
                   </div>
               </div>

           </div>
       </div>
    </div>
  );
};