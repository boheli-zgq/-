
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Activity, Upload, Settings, RefreshCw, AlertCircle, FileText, Download, Play, TrendingUp, Clock } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, AreaChart, Area } from 'recharts';

// --- Types ---

interface EEGDataPoint {
  time: number;
  amplitude: number;
}

interface WindowResult {
  second: number;
  power: number;
  isSuppression: boolean;
}

interface TrendPoint {
  timeStart: number; // seconds
  timeEnd: number;
  label: string; // e.g. "0-2 min"
  bsr: number; // percentage 0-100
}

interface AnalysisResult {
  globalMeanPower: number;
  globalBsr: number; // 0-100
  totalSeconds: number;
  suppressionSeconds: number;
  windows: WindowResult[];
  trendData: TrendPoint[];
}

// --- Constants ---

const EPOCH_OPTIONS = [
    { value: 0, label: '全局 (Whole Recording)' },
    { value: 30, label: '30 秒 (30s Epochs)' },
    { value: 60, label: '1 分钟 (1 min Epochs)' },
    { value: 120, label: '2 分钟 (2 min Epochs)' },
    { value: 300, label: '5 分钟 (5 min Epochs)' },
];

// --- Helper: Downsample for Charting (Performance) ---
const downsampleData = (data: EEGDataPoint[], targetCount: number = 3000): EEGDataPoint[] => {
    if (data.length <= targetCount) return data;
    
    const sampled: EEGDataPoint[] = [];
    const step = Math.ceil(data.length / targetCount);
    
    for (let i = 0; i < data.length; i += step) {
        const chunk = data.slice(i, i + step);
        if (chunk.length === 0) break;
        
        let min = chunk[0], max = chunk[0];
        for (const p of chunk) {
            if (p.amplitude < min.amplitude) min = p;
            if (p.amplitude > max.amplitude) max = p;
        }
        if (min.time < max.time) {
            sampled.push(min, max);
        } else {
            sampled.push(max, min);
        }
    }
    return sampled.sort((a, b) => a.time - b.time);
};

export const BsrTool: React.FC = () => {
  const [rawData, setRawData] = useState<EEGDataPoint[]>([]);
  const [fileName, setFileName] = useState<string>('');
  
  // Parameters
  const [thresholdRatio, setThresholdRatio] = useState<number>(0.5); // Default 50%
  const [epochDuration, setEpochDuration] = useState<number>(60); // Default 1 min
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Core Algorithm ---
  const analyzeSignal = useCallback(() => {
      if (rawData.length === 0) return;
      setIsProcessing(true);

      // Allow UI to render loading state
      setTimeout(() => {
          // 1. Calculate Global Mean Power (Mean of Squares)
          let sumSquares = 0;
          const n = rawData.length;
          
          // Group data into 1-second buckets
          const buckets: Record<number, number[]> = {};
          let maxTime = 0;

          for (let i = 0; i < n; i++) {
              const val = rawData[i].amplitude;
              const t = rawData[i].time;
              sumSquares += val * val;
              
              const sec = Math.floor(t);
              if (!buckets[sec]) buckets[sec] = [];
              buckets[sec].push(val);
              
              if (t > maxTime) maxTime = t;
          }

          const globalMeanPower = sumSquares / n;
          const powerThreshold = globalMeanPower * thresholdRatio;

          // 2. Window Analysis (1-second non-overlapping)
          const totalSeconds = Math.floor(maxTime) + 1;
          let globalSuppressionCount = 0;
          const windowResults: WindowResult[] = [];

          for (let s = 0; s < totalSeconds; s++) {
              const amps = buckets[s] || [];
              let wPower = 0;
              
              if (amps.length > 0) {
                  const wSumSq = amps.reduce((acc, val) => acc + val * val, 0);
                  wPower = wSumSq / amps.length;
              }

              // Determine State: Window Power < Ratio * Global Power
              const isSuppression = wPower < powerThreshold;
              if (isSuppression) globalSuppressionCount++;

              windowResults.push({
                  second: s,
                  power: wPower,
                  isSuppression
              });
          }

          // 3. Epoch/Trend Calculation
          const trendData: TrendPoint[] = [];
          
          if (epochDuration === 0) {
              // Global only
              trendData.push({
                  timeStart: 0,
                  timeEnd: totalSeconds,
                  label: "Global",
                  bsr: (globalSuppressionCount / totalSeconds) * 100
              });
          } else {
              // Sliding Epochs (Non-overlapping)
              for (let t = 0; t < totalSeconds; t += epochDuration) {
                  const end = Math.min(t + epochDuration, totalSeconds);
                  const duration = end - t;
                  if (duration === 0) break;

                  // Count suppression seconds in this slice
                  let localSuppression = 0;
                  for (let i = t; i < end; i++) {
                      if (windowResults[i]?.isSuppression) localSuppression++;
                  }

                  trendData.push({
                      timeStart: t,
                      timeEnd: end,
                      label: `${(t/60).toFixed(1)}-${(end/60).toFixed(1)}m`,
                      bsr: (localSuppression / duration) * 100
                  });
              }
          }

          setResult({
              globalMeanPower,
              globalBsr: (globalSuppressionCount / totalSeconds) * 100,
              totalSeconds,
              suppressionSeconds: globalSuppressionCount,
              windows: windowResults,
              trendData
          });

          setIsProcessing(false);
      }, 100);
  }, [rawData, thresholdRatio, epochDuration]);

  // --- File Handling ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setFileName(file.name);
      setIsProcessing(true);
      setResult(null);

      const reader = new FileReader();
      reader.onload = (event) => {
          const text = event.target?.result as string;
          const lines = text.trim().split(/[\r\n]+/);
          
          // Basic CSV Parsing
          const separator = lines[0].includes(',') ? ',' : '\t';
          let startRow = 0;
          if (/[a-zA-Z]/.test(lines[0])) startRow = 1;

          const parsedData: EEGDataPoint[] = [];
          
          for (let i = startRow; i < lines.length; i++) {
              const cols = lines[i].split(separator);
              if (cols.length >= 2) {
                  const t = parseFloat(cols[0]);
                  const v = parseFloat(cols[1]); 
                  if (!isNaN(t) && !isNaN(v)) {
                      parsedData.push({ time: t, amplitude: v });
                  }
              }
          }

          if (parsedData.length > 0) {
              parsedData.sort((a, b) => a.time - b.time);
              setRawData(parsedData);
          } else {
              alert("无法解析数据，请确保格式为：时间, 幅值 (CSV)");
          }
          setIsProcessing(false);
      };
      reader.readAsText(file);
  };

  // --- Export Data ---
  const handleExportCsv = () => {
      if (!result) return;
      let csv = "\uFEFF"; // BOM for Excel

      // 1. Summary
      csv += "SUMMARY STATISTICS\n";
      csv += `File Name,${fileName}\n`;
      csv += `Global BSR (%),${result.globalBsr.toFixed(2)}\n`;
      csv += `Total Duration (s),${result.totalSeconds}\n`;
      csv += `Suppression Duration (s),${result.suppressionSeconds}\n`;
      csv += `Global Mean Power,${result.globalMeanPower.toFixed(4)}\n`;
      csv += `Threshold Ratio,${thresholdRatio} (Threshold: ${(result.globalMeanPower * thresholdRatio).toFixed(4)})\n`;
      csv += `Epoch Duration,${epochDuration === 0 ? 'Global' : epochDuration + 's'}\n\n`;

      // 2. Trend Data
      if (result.trendData.length > 0) {
          csv += "BSR TREND ANALYSIS\n";
          csv += "Time Range,Time Start (s),Time End (s),BSR (%)\n";
          result.trendData.forEach(t => {
              csv += `"${t.label}",${t.timeStart},${t.timeEnd},${t.bsr.toFixed(2)}\n`;
          });
          csv += "\n";
      }

      // 3. Detailed Data
      csv += "SECOND-BY-SECOND DETAILS\n";
      csv += "Time (s),Window Power,Status\n";
      result.windows.forEach(w => {
          csv += `${w.second},${w.power.toFixed(4)},${w.isSuppression ? 'Suppression' : 'Burst'}\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `BSR_Analysis_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  // --- Visualization Data ---
  const chartData = useMemo(() => {
      return downsampleData(rawData, 2000);
  }, [rawData]);

  const suppressionRegions = useMemo(() => {
      if (!result) return [];
      const regions: {x1: number, x2: number}[] = [];
      let currentStart: number | null = null;

      result.windows.forEach((w, idx) => {
          if (w.isSuppression) {
              if (currentStart === null) currentStart = w.second;
          } else {
              if (currentStart !== null) {
                  regions.push({ x1: currentStart, x2: idx });
                  currentStart = null;
              }
          }
      });
      if (currentStart !== null) {
          regions.push({ x1: currentStart, x2: result.windows.length });
      }
      return regions;
  }, [result]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
       {/* Header */}
       <div className="flex items-center gap-4 mb-2">
           <div className="bg-purple-100 p-3 rounded-2xl text-purple-600">
                <Activity size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">爆发抑制比分析 (BSR)</h2>
               <p className="text-slate-500">EEG 脑电信号自动化分析工具，识别爆发抑制模式与趋势</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px] items-start">
           
           {/* LEFT: Controls */}
           <div className="lg:col-span-4 flex flex-col gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                        <Settings size={18} /> 数据与参数
                    </h3>
                    
                    <div className="space-y-6">
                        {/* Upload */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-2">上传 EEG 数据 (CSV/Excel)</label>
                            <input 
                                type="file" 
                                accept=".csv,.txt"
                                ref={fileInputRef}
                                onChange={handleFileUpload}
                                className="hidden" 
                            />
                            <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full border-2 border-dashed border-purple-200 bg-purple-50 hover:bg-purple-100 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors"
                            >
                                <Upload className="text-purple-400 mb-2" size={24} />
                                <span className="text-sm font-medium text-purple-700">
                                    {fileName || "点击上传数据文件"}
                                </span>
                                <span className="text-xs text-purple-400 mt-1">格式: Time(s), Voltage(uV)</span>
                            </div>
                        </div>

                        {/* Epoch Selector */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-2 flex items-center gap-1">
                                <Clock size={12} /> 计算分段 (Epoch Interval)
                            </label>
                            <select 
                                value={epochDuration}
                                onChange={(e) => setEpochDuration(parseInt(e.target.value))}
                                className="w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-slate-50"
                            >
                                {EPOCH_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-slate-400 mt-1">
                                设定趋势图的时间分辨率。例如选择"1分钟"，则计算每分钟内的平均 BSR。
                            </p>
                        </div>

                        {/* Threshold Slider */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-slate-500">抑制判别阈值 (Ratio)</label>
                                <span className="text-xs font-mono bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                    {(thresholdRatio * 100).toFixed(0)}% of Mean Power
                                </span>
                            </div>
                            <input 
                                type="range" 
                                min="0.1" 
                                max="0.9" 
                                step="0.05"
                                value={thresholdRatio}
                                onChange={(e) => setThresholdRatio(parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                            />
                            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                                如果某秒的平均功率低于全局平均功率的 {(thresholdRatio * 100).toFixed(0)}%，则判定为抑制波。
                            </p>
                        </div>

                        <button 
                            onClick={analyzeSignal}
                            disabled={rawData.length === 0 || isProcessing}
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all active:scale-95"
                        >
                            {isProcessing ? <RefreshCw className="animate-spin" size={18} /> : <Play size={18} />}
                            开始分析
                        </button>
                    </div>
                </div>

                {/* Global Result Card */}
                {result && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-fade-in-up">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                <FileText size={18} /> 全局统计
                            </h3>
                            <button 
                                onClick={handleExportCsv}
                                className="text-xs bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                            >
                                <Download size={14} /> 导出数据
                            </button>
                        </div>
                        
                        <div className="text-center py-6 bg-slate-50 rounded-xl border border-slate-100 mb-4">
                            <div className="text-sm text-slate-500 font-medium uppercase tracking-wider mb-1">Global BSR</div>
                            <div className="text-5xl font-extrabold text-purple-600 tracking-tight">
                                {result.globalBsr.toFixed(1)}<span className="text-2xl ml-1">%</span>
                            </div>
                        </div>

                        <div className="space-y-3 text-sm">
                            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                                <span className="text-slate-500">总时长</span>
                                <span className="font-mono font-medium text-slate-700">{result.totalSeconds} s</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-500">抑制波时长</span>
                                <span className="font-mono font-medium text-slate-700">{result.suppressionSeconds} s</span>
                            </div>
                        </div>
                    </div>
                )}
           </div>

           {/* RIGHT: Visualization */}
           <div className="lg:col-span-8 flex flex-col gap-6">
               
               {/* 1. Waveform Chart */}
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col">
                   <div className="flex justify-between items-center mb-6">
                       <h3 className="font-bold text-slate-800">EEG 原始波形与抑制识别</h3>
                       {result && (
                           <div className="flex items-center gap-2 text-xs">
                               <div className="flex items-center gap-1">
                                   <div className="w-3 h-3 bg-slate-200/50 border border-slate-300"></div>
                                   <span className="text-slate-500">抑制期</span>
                               </div>
                               <div className="flex items-center gap-1 ml-2">
                                   <div className="w-3 h-1 bg-purple-500"></div>
                                   <span className="text-slate-500">信号</span>
                               </div>
                           </div>
                       )}
                   </div>

                   <div className="w-full h-[300px] bg-slate-50 rounded-xl border border-slate-100 p-2 relative">
                       {rawData.length > 0 ? (
                           <ResponsiveContainer width="100%" height="100%">
                               <LineChart data={chartData}>
                                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                   <XAxis 
                                        dataKey="time" 
                                        type="number" 
                                        domain={['dataMin', 'dataMax']} 
                                        tickFormatter={(t) => (t/60).toFixed(1)}
                                        label={{ value: 'Time (min)', position: 'insideBottomRight', offset: -5, fontSize: 12, fill: '#94a3b8' }}
                                        tick={{ fontSize: 10, fill: '#64748b' }}
                                   />
                                   <YAxis 
                                        label={{ value: 'uV', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 12 } }}
                                        tick={{ fontSize: 10, fill: '#64748b' }}
                                        domain={['auto', 'auto']}
                                   />
                                   <Tooltip 
                                        labelFormatter={(t) => `Time: ${Number(t).toFixed(1)}s`}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                   />
                                   
                                   {/* Highlight Suppression Regions */}
                                   {suppressionRegions.map((region, idx) => (
                                       <ReferenceArea 
                                           key={idx} 
                                           x1={region.x1} 
                                           x2={region.x2} 
                                           fill="#64748b" 
                                           fillOpacity={0.15} 
                                       />
                                   ))}

                                   <Line 
                                        type="monotone" 
                                        dataKey="amplitude" 
                                        stroke="#9333ea" 
                                        strokeWidth={1} 
                                        dot={false} 
                                        isAnimationActive={false} 
                                   />
                               </LineChart>
                           </ResponsiveContainer>
                       ) : (
                           <div className="flex flex-col items-center justify-center h-full text-slate-400">
                               <Activity size={48} className="mb-4 opacity-20" />
                               <p>请上传数据以预览波形</p>
                           </div>
                       )}
                   </div>
               </div>

               {/* 2. BSR Trend Chart (Only if analysis done and epoch > 0) */}
               {result && epochDuration > 0 && result.trendData.length > 0 && (
                   <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-fade-in-up">
                        <div className="flex justify-between items-center mb-6">
                           <h3 className="font-bold text-slate-800 flex items-center gap-2">
                               <TrendingUp size={20} className="text-purple-600"/>
                               BSR 动态趋势图
                           </h3>
                           <span className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded border border-purple-100">
                               每 {epochDuration >= 60 ? `${epochDuration/60} 分钟` : `${epochDuration} 秒`} 一个点
                           </span>
                       </div>

                       <div className="w-full h-[250px]">
                           <ResponsiveContainer width="100%" height="100%">
                               <AreaChart data={result.trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                   <defs>
                                       <linearGradient id="colorBsr" x1="0" y1="0" x2="0" y2="1">
                                           <stop offset="5%" stopColor="#9333ea" stopOpacity={0.2}/>
                                           <stop offset="95%" stopColor="#9333ea" stopOpacity={0}/>
                                       </linearGradient>
                                   </defs>
                                   <XAxis 
                                       dataKey="timeStart" 
                                       tickFormatter={(t) => (t/60).toFixed(1)}
                                       label={{ value: 'Time (min)', position: 'insideBottomRight', offset: -5, fontSize: 12, fill: '#94a3b8' }}
                                       tick={{ fontSize: 10, fill: '#64748b' }}
                                   />
                                   <YAxis 
                                       domain={[0, 100]}
                                       label={{ value: 'BSR %', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 12 } }}
                                       tick={{ fontSize: 10, fill: '#64748b' }}
                                   />
                                   <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                   <Tooltip 
                                       labelFormatter={(t) => `Time: ${(Number(t)/60).toFixed(1)} min`}
                                       formatter={(val: number) => [val.toFixed(1) + '%', 'BSR']}
                                       contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                   />
                                   <Area 
                                       type="monotone" 
                                       dataKey="bsr" 
                                       stroke="#9333ea" 
                                       strokeWidth={2}
                                       fillOpacity={1} 
                                       fill="url(#colorBsr)" 
                                   />
                               </AreaChart>
                           </ResponsiveContainer>
                       </div>
                   </div>
               )}

               {result && (
                   <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex gap-3 items-start">
                       <AlertCircle size={16} className="text-blue-500 mt-0.5 shrink-0" />
                       <div className="text-xs text-blue-700 leading-relaxed">
                           <strong>算法说明：</strong> 系统将信号划分为 1秒 的非重叠窗口。
                           若窗口平均功率低于全局平均功率的 {(thresholdRatio*100).toFixed(0)}%，标记为抑制。
                           {epochDuration > 0 && ` 趋势图展示了每 ${epochDuration >= 60 ? epochDuration/60 + ' 分钟' : epochDuration + ' 秒'} 内抑制波所占的时间百分比。`}
                       </div>
                   </div>
               )}
           </div>

       </div>
    </div>
  );
};
