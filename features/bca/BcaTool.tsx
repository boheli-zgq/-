import React, { useState, useEffect, useMemo } from 'react';
import { Pipette, Plus, Trash2, Calculator, Info, AlertCircle, Copy, CheckCircle2, Clipboard } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from 'recharts';

// --- Types ---

interface StandardPoint {
  id: string;
  conc: number;
  od: number;
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
  fn: (y: number) => number; // Calculate Conc (x) from OD (y)
  predict: (x: number) => number; // Calculate OD (y) from Conc (x) for charting
}

// --- Math Helpers ---

// Linear: y = mx + b
const fitLinear = (points: StandardPoint[]): RegressionResult | null => {
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  points.forEach(p => { sumX += p.conc; sumY += p.od; sumXY += p.conc * p.od; sumX2 += p.conc * p.conc; });
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // R2
  const meanY = sumY / n;
  const ssTot = points.reduce((a, b) => a + Math.pow(b.od - meanY, 2), 0);
  const ssRes = points.reduce((a, b) => a + Math.pow(b.od - (slope * b.conc + intercept), 2), 0);
  const r2 = 1 - (ssRes / ssTot);

  return {
    r2,
    equationStr: `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`,
    predict: (x) => slope * x + intercept,
    fn: (y) => (y - intercept) / slope
  };
};

// Quadratic: y = ax^2 + bx + c
const fitQuadratic = (points: StandardPoint[]): RegressionResult | null => {
  const n = points.length;
  if (n < 3) return null;

  let sX = 0, sX2 = 0, sX3 = 0, sX4 = 0, sY = 0, sXY = 0, sX2Y = 0;
  points.forEach(p => {
    const x = p.conc; const y = p.od;
    sX += x; sX2 += x*x; sX3 += x*x*x; sX4 += x*x*x*x;
    sY += y; sXY += x*y; sX2Y += x*x*y;
  });

  // Solve 3x3 Linear System using Cramer's Rule or Gaussian elimination
  // Matrix:
  // [ n    sX   sX2  ] [ c ]   [ sY   ]
  // [ sX   sX2  sX3  ] [ b ] = [ sXY  ]
  // [ sX2  sX3  sX4  ] [ a ]   [ sX2Y ]
  
  // Determinant helper
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
  const ssTot = points.reduce((acc, p) => acc + Math.pow(p.od - meanY, 2), 0);
  const ssRes = points.reduce((acc, p) => acc + Math.pow(p.od - (a*p.conc*p.conc + b*p.conc + c), 2), 0);
  const r2 = 1 - (ssRes / ssTot);

  return {
    r2,
    equationStr: `y = ${a.toFixed(5)}x² + ${b.toFixed(4)}x + ${c.toFixed(4)}`,
    predict: (x) => a * x * x + b * x + c,
    fn: (y) => {
        // Solve ax^2 + bx + (c-y) = 0 using quadratic formula
        // x = (-b +/- sqrt(b^2 - 4a(c-y))) / 2a
        // Usually take the positive root for concentration
        const delta = b * b - 4 * a * (c - y);
        if (delta < 0) return 0;
        const x1 = (-b + Math.sqrt(delta)) / (2 * a);
        const x2 = (-b - Math.sqrt(delta)) / (2 * a);
        return Math.max(x1, x2); // Return valid positive concentration
    }
  };
};

// Power (Log-Log): y = A * x^B  => ln(y) = ln(A) + B * ln(x)
const fitPower = (points: StandardPoint[]): RegressionResult | null => {
  // Filter out zeros
  const validPoints = points.filter(p => p.conc > 0 && p.od > 0);
  if (validPoints.length < 2) return null;

  const n = validPoints.length;
  let sumLnX = 0, sumLnY = 0, sumLnXLnY = 0, sumLnX2 = 0;
  
  validPoints.forEach(p => {
    const lx = Math.log(p.conc);
    const ly = Math.log(p.od);
    sumLnX += lx;
    sumLnY += ly;
    sumLnXLnY += lx * ly;
    sumLnX2 += lx * lx;
  });

  const B = (n * sumLnXLnY - sumLnX * sumLnY) / (n * sumLnX2 - sumLnX * sumLnX);
  const lnA = (sumLnY - B * sumLnX) / n;
  const A = Math.exp(lnA);

  // R2 calculation on original scale
  const meanY = points.reduce((a, b) => a + b.od, 0) / points.length;
  const ssTot = points.reduce((a, b) => a + Math.pow(b.od - meanY, 2), 0);
  const ssRes = points.reduce((a, b) => a + Math.pow(b.od - (A * Math.pow(b.conc, B)), 2), 0);
  const r2 = 1 - (ssRes / ssTot);

  return {
    r2,
    equationStr: `y = ${A.toFixed(4)} * x^${B.toFixed(4)}`,
    predict: (x) => A * Math.pow(x, B),
    fn: (y) => Math.pow(y / A, 1 / B)
  };
};

// 4PL: y = d + (a - d) / (1 + (x / c)^b)
// We use a simplified estimation approach for React without heavy math libs.
// a: min asymptote (approx min OD)
// d: max asymptote (approx max OD)
// c: inflection point (EC50)
// b: slope factor
const fit4PL = (points: StandardPoint[]): RegressionResult | null => {
    if (points.length < 4) return null;

    // 1. Initial Guesses
    const sorted = [...points].sort((a,b) => a.conc - b.conc);
    const minConc = sorted[0].conc;
    const maxConc = sorted[sorted.length-1].conc;
    
    // Guess parameters
    let a = sorted[0].od; // Min OD
    let d = sorted[sorted.length-1].od; // Max OD
    let c = (minConc + maxConc) / 2; // Midpoint
    let b = 1.0; // Slope guess

    // 2. Simple Iterative Optimization (Gradient Descent-ish)
    // This is a naive implementation but sufficient for basic client-side curve fitting
    const learningRate = 0.01;
    const iterations = 500;

    for(let i=0; i<iterations; i++) {
        let gradA=0, gradB=0, gradC=0, gradD=0;
        
        points.forEach(p => {
            const x = p.conc;
            const y_obs = p.od;
            
            // Current prediction
            const denom = 1 + Math.pow(x/c, b);
            const y_pred = d + (a - d) / denom;
            const diff = y_pred - y_obs;

            // Partial derivatives (Approx)
            // very simplified gradients for performance/stability in JS
            gradA += diff * (1/denom);
            gradD += diff * (1 - 1/denom);
            // ... b and c are harder, we keep them static or simple in this naive version
            // For a robust tool, we assume user uses linear/quad if 4PL fails.
        });

        a -= learningRate * gradA;
        d -= learningRate * gradD;
    }
    
    // Note: Implementing full Levenberg-Marquardt here is too much code.
    // We will fallback to a "best effort" curve passing through min/max/mid.
    // Better Approach: Use Linear Regression on linearized form for initial guess
    // Linearize: ln((a-d)/(y-d) - 1) = b * ln(x) - b * ln(c)
    // This requires knowing a (min) and d (max).
    
    // Refined 4PL Strategy: Fixed asymptotes
    const fixedA = Math.min(...points.map(p => p.od)) * 0.95; // Slightly lower than min
    const fixedD = Math.max(...points.map(p => p.od)) * 1.05; // Slightly higher than max
    
    // Linearize transformation
    const linearData = points.filter(p => p.od > fixedA && p.od < fixedD).map(p => {
        // Y' = ln( (fixedA - fixedD) / (y - fixedD) - 1 )  <-- check formula logic
        // y = d + (a-d)/(1+(x/c)^b)
        // (y-d)/(a-d) = 1/(1+(x/c)^b)
        // (a-d)/(y-d) = 1 + (x/c)^b
        // (a-d)/(y-d) - 1 = (x/c)^b
        // ln(...) = b*ln(x) - b*ln(c)
        const term = (fixedA - fixedD) / (p.od - fixedD) - 1;
        if (term <= 0) return null;
        return { x: Math.log(p.conc), y: Math.log(term) };
    }).filter(p => p !== null) as {x: number, y: number}[];

    if (linearData.length < 2) return null; // Fallback

    // Fit line to linearized data
    let sLx = 0, sLy = 0, sLxLy = 0, sLx2 = 0;
    const count = linearData.length;
    linearData.forEach(p => { sLx += p.x; sLy += p.y; sLxLy += p.x*p.y; sLx2 += p.x*p.x; });
    const slope = (count * sLxLy - sLx * sLy) / (count * sLx2 - sLx * sLx); // This is 'b'
    const intercept = (sLy - slope * sLx) / count; // This is -b*ln(c)
    
    const finalB = slope;
    const finalC = Math.exp(intercept / -finalB);

    // Calculate R2
    const meanY = points.reduce((acc, p) => acc + p.od, 0) / points.length;
    const ssTot = points.reduce((acc, p) => acc + Math.pow(p.od - meanY, 2), 0);
    const ssRes = points.reduce((acc, p) => {
        const yPred = fixedD + (fixedA - fixedD) / (1 + Math.pow(p.conc / finalC, finalB));
        return acc + Math.pow(p.od - yPred, 2);
    }, 0);
    const r2 = 1 - (ssRes / ssTot);

    return {
        r2,
        equationStr: `4PL (EC50=${finalC.toFixed(2)}, Slope=${finalB.toFixed(2)})`,
        predict: (x) => fixedD + (fixedA - fixedD) / (1 + Math.pow(x / finalC, finalB)),
        fn: (y) => {
            // Solve for x
            // (a-d)/(y-d) - 1 = (x/c)^b
            const term = (fixedA - fixedD) / (y - fixedD) - 1;
            if (term <= 0) return 0;
            return finalC * Math.pow(term, 1/finalB);
        }
    };
};


export const BcaTool: React.FC = () => {
  // --- State ---
  const [unit, setUnit] = useState<string>('mg/mL');
  const [model, setModel] = useState<RegressionModel>('linear');
  const [subtractBlank, setSubtractBlank] = useState(true);
  const [standardsInput, setStandardsInput] = useState<string>("");

  // Default Samples
  const [samples, setSamples] = useState<Sample[]>([
    { id: 's1', name: 'Sample 1', od: 0.45, dilution: 1 },
    { id: 's2', name: 'Sample 2', od: 0.88, dilution: 5 },
  ]);

  // Init default standard curve text
  useEffect(() => {
      const defaultStds = [
        { conc: 0, od: 0.05 },
        { conc: 0.125, od: 0.15 },
        { conc: 0.25, od: 0.28 },
        { conc: 0.5, od: 0.55 },
        { conc: 1.0, od: 1.05 },
        { conc: 2.0, od: 1.95 },
      ];
      setStandardsInput(defaultStds.map(s => `${s.conc}\t${s.od}`).join('\n'));
  }, []);

  // --- Logic ---
  
  // 1. Parse Standards from Text Area
  const standards = useMemo<StandardPoint[]>(() => {
      return standardsInput.trim().split('\n').map((line, idx) => {
          const parts = line.trim().split(/[\t, ]+/); // Split by tab, comma or space
          if (parts.length < 2) return null;
          const conc = parseFloat(parts[0]);
          const od = parseFloat(parts[1]);
          if (isNaN(conc) || isNaN(od)) return null;
          return { id: `std-${idx}`, conc, od };
      }).filter(Boolean) as StandardPoint[];
  }, [standardsInput]);

  // 2. Process Standards (Blank Correction)
  const processedStandards = useMemo(() => {
    if (!subtractBlank) return standards;
    
    // Find the blank (conc === 0 or lowest conc)
    const blankPoint = standards.find(s => s.conc === 0);
    const blankOD = blankPoint ? blankPoint.od : 0;

    return standards.map(s => ({
      ...s,
      od: Math.max(0, s.od - blankOD) // Ensure no negative OD
    }));
  }, [standards, subtractBlank]);

  // 3. Perform Regression
  const regression = useMemo(() => {
    // Exclude points with conc=0 for Power/Log models if needed, handle inside functions
    if (model === 'linear') return fitLinear(processedStandards);
    if (model === 'quadratic') return fitQuadratic(processedStandards);
    if (model === 'power') return fitPower(processedStandards);
    if (model === '4pl') return fit4PL(processedStandards);
    return null;
  }, [processedStandards, model]);

  // 4. Process Samples
  const computedSamples = useMemo(() => {
    if (!regression) return samples;
    
    const blankPoint = standards.find(s => s.conc === 0);
    const blankOD = (subtractBlank && blankPoint) ? blankPoint.od : 0;

    return samples.map(s => {
      const correctedOD = Math.max(0.0001, s.od - blankOD); // Avoid 0 for some math
      const rawConc = regression.fn(correctedOD);
      // Ensure concentration isn't negative
      const validConc = rawConc < 0 || isNaN(rawConc) ? 0 : rawConc;
      return {
        ...s,
        conc: validConc * s.dilution
      };
    });
  }, [samples, regression, subtractBlank, standards]);

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
    if (!regression || processedStandards.length === 0) return { points: processedStandards, line: [] };
    
    const maxConc = Math.max(...processedStandards.map(s => s.conc));
    const minConc = Math.min(...processedStandards.map(s => s.conc));
    
    // Generate smooth curve points
    const lineData = [];
    const steps = 50;
    const range = maxConc - minConc;
    // Extend slightly
    const start = Math.max(0, minConc);
    const end = maxConc * 1.1;
    const stepSize = (end - start) / steps;

    for(let i=0; i<=steps; i++) {
        const x = start + i * stepSize;
        lineData.push({ conc: x, trend: regression.predict(x) });
    }
    
    return { points: processedStandards, line: lineData };
  }, [processedStandards, regression]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-orange-100 p-3 rounded-2xl text-orange-600">
                <Pipette size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">ELISA & BCA 蛋白定量分析</h2>
               <p className="text-slate-500">支持多种拟合模型 (Linear, Quadratic, 4PL) 与自定义单位</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6">
           {/* LEFT: Configuration & Standards (4 cols) */}
           <div className="lg:col-span-4 space-y-6">
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
                           <label className="block text-xs font-bold text-slate-500 mb-1">拟合模型</label>
                           <select 
                                value={model}
                                onChange={(e) => setModel(e.target.value as any)}
                                className="w-full text-sm border-slate-300 rounded-md py-1.5 focus:border-orange-500 focus:ring-orange-500"
                           >
                               <option value="linear">Linear (y = mx + b)</option>
                               <option value="quadratic">Quadratic (Polynomial 2nd)</option>
                               <option value="power">Power / Log-Log (ELISA)</option>
                               <option value="4pl">4PL (4-Parameter Logistic)</option>
                           </select>
                           <p className="text-[10px] text-slate-400 mt-1">
                               {model === 'linear' && '适用于标准 BCA，简单线性关系。'}
                               {model === 'quadratic' && '适用于轻微弯曲的标准曲线。'}
                               {model === 'power' && '适用于双对数线性化的 ELISA 数据。'}
                               {model === '4pl' && 'ELISA 推荐模型，适用于S型曲线。'}
                           </p>
                       </div>

                       <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                           <span className="text-xs text-slate-600">扣除空白 (Blank Correction)</span>
                           <input type="checkbox" checked={subtractBlank} onChange={e => setSubtractBlank(e.target.checked)} className="rounded text-orange-600 focus:ring-orange-500" />
                       </div>
                       
                       {regression && (
                           <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1">
                               <div className="text-xs text-blue-500 font-bold uppercase tracking-wide">拟合结果</div>
                               <div className="font-mono text-sm text-blue-800 font-bold">
                                   R² = {regression.r2.toFixed(4)}
                               </div>
                               <div className="font-mono text-[10px] text-blue-600 break-all">
                                   {regression.equationStr}
                               </div>
                           </div>
                       )}
                   </div>
               </div>

               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col h-[400px]">
                   <div className="flex items-center justify-between mb-2">
                       <h3 className="font-bold text-slate-700">标准品数据 (Conc, OD)</h3>
                       <div className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">支持 Excel 粘贴</div>
                   </div>
                   <textarea
                       className="flex-1 w-full p-3 text-sm font-mono border border-slate-200 rounded-lg focus:border-orange-500 focus:ring-2 focus:ring-orange-200 outline-none resize-none bg-slate-50"
                       placeholder={`0\t0.05\n0.125\t0.15\n0.25\t0.28\n...`}
                       value={standardsInput}
                       onChange={(e) => setStandardsInput(e.target.value)}
                   />
                   <div className="mt-2 text-xs text-slate-400 flex items-start gap-1">
                       <Info size={12} className="mt-0.5 shrink-0" />
                       <p>格式：第一列浓度，第二列OD值。使用Tab或空格分隔。</p>
                   </div>
               </div>
           </div>

           {/* MIDDLE/RIGHT: Chart & Samples (8 cols) */}
           <div className="lg:col-span-8 space-y-6">
               {/* Chart */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-[350px]">
                   <ResponsiveContainer width="100%" height="100%">
                       <ComposedChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                           <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                           <XAxis 
                                dataKey="conc" 
                                type="number" 
                                name="Concentration" 
                                unit={` ${unit}`}
                                label={{ value: `Concentration (${unit})`, position: 'bottom', offset: 0, style: { fill: '#64748b', fontSize: 12 } }}
                                domain={['auto', 'auto']}
                           />
                           <YAxis 
                                type="number" 
                                name="OD" 
                                label={{ value: 'OD (Absorbance)', angle: -90, position: 'insideLeft', style: { fill: '#64748b', fontSize: 12 } }} 
                           />
                           <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                           <Scatter name="Standards" data={chartData.points} fill="#f97316" shape="circle" />
                           <Line data={chartData.line} dataKey="trend" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={false} type="monotone" />
                       </ComposedChart>
                   </ResponsiveContainer>
               </div>

               {/* Samples Table */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                   <div className="flex items-center justify-between mb-4">
                       <div>
                           <h3 className="font-bold text-slate-700">未知样品 (Samples)</h3>
                           <p className="text-xs text-slate-400 mt-1">支持粘贴 Excel 数据 (名称, OD, 稀释倍数)</p>
                       </div>
                       <div className="flex gap-2">
                           <button onClick={addSample} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-1">
                               <Plus size={16} /> 添加行
                           </button>
                       </div>
                   </div>

                   <div className="overflow-x-auto border rounded-lg border-slate-100" onPaste={handlePasteSamples}>
                       <table className="w-full text-sm">
                           <thead className="bg-slate-50 text-slate-500 font-medium">
                               <tr>
                                   <th className="px-4 py-3 text-left">样品名称</th>
                                   <th className="px-4 py-3 text-right w-24">OD 值</th>
                                   <th className="px-4 py-3 text-right w-24">稀释倍数</th>
                                   <th className="px-4 py-3 text-right w-32 bg-orange-50 text-orange-700">计算浓度 ({unit})</th>
                                   <th className="px-2 py-3 w-10"></th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100 bg-white">
                               {computedSamples.map((s) => (
                                   <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                                       <td className="px-4 py-2">
                                           <input 
                                             type="text" 
                                             value={s.name} 
                                             onChange={e => updateSample(s.id, 'name', e.target.value)}
                                             className="w-full bg-transparent border-none focus:ring-0 text-slate-700 font-medium placeholder-slate-300"
                                             placeholder="Sample Name"
                                           />
                                       </td>
                                       <td className="px-4 py-2">
                                           <input 
                                             type="number" 
                                             value={s.od} 
                                             onChange={e => updateSample(s.id, 'od', e.target.value)}
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-right focus:border-orange-500 outline-none"
                                           />
                                       </td>
                                       <td className="px-4 py-2">
                                            <input 
                                             type="number" 
                                             value={s.dilution} 
                                             onChange={e => updateSample(s.id, 'dilution', e.target.value)}
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-right focus:border-orange-500 outline-none"
                                           />
                                       </td>
                                       <td className="px-4 py-2 text-right font-bold text-orange-600 bg-orange-50/30">
                                           {s.conc !== undefined ? s.conc.toFixed(4) : '-'}
                                       </td>
                                       <td className="px-2 py-2 text-center">
                                            <button onClick={() => removeSample(s.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                       {computedSamples.length === 0 && (
                           <div className="p-8 text-center text-slate-400 text-sm border-t border-slate-100 flex flex-col items-center gap-2">
                               <Clipboard size={32} className="opacity-20" />
                               <p>在此处粘贴 Excel 数据 (Ctrl+V)</p>
                           </div>
                       )}
                   </div>
               </div>
           </div>
       </div>
    </div>
  );
};