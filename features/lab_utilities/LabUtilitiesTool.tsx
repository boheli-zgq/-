import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Timer, Hash, RotateCw, ArrowLeftRight, Play, Pause, RotateCcw, Plus, Trash2, Calculator, Settings, ArrowRight, Gauge, Clock, Edit2, Check, Ruler } from 'lucide-react';

// --- Timer Types ---
interface LabTimer {
  id: string;
  name: string;
  duration: number; // in seconds
  timeLeft: number; // in seconds
  isRunning: boolean;
  isFinished: boolean;
  originalDuration: number;
}

// --- Counter Types ---
interface LabCounter {
  id: string;
  name: string;
  count: number;
  color: string;
}

const COUNTER_COLORS = ['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899'];

// --- Helper: Format Time ---
const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return {
      text: `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`,
      h, m, s
  };
};

export const LabUtilitiesTool: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'timer' | 'counter' | 'centrifuge' | 'convert'>('timer');

  // --- Timer State ---
  const [timers, setTimers] = useState<LabTimer[]>([
    { id: '1', name: 'WB 孵育 (1h)', duration: 3600, timeLeft: 3600, isRunning: false, isFinished: false, originalDuration: 3600 },
    { id: '2', name: 'PCR 变性 (5m)', duration: 300, timeLeft: 300, isRunning: false, isFinished: false, originalDuration: 300 },
  ]);
  const [newTimerName, setNewTimerName] = useState('');
  const [newTimerMin, setNewTimerMin] = useState<number | ''>(10);

  // --- Counter State ---
  const [counters, setCounters] = useState<LabCounter[]>([
    { id: '1', name: 'Live Cells', count: 0, color: COUNTER_COLORS[0] },
    { id: '2', name: 'Dead Cells', count: 0, color: COUNTER_COLORS[2] },
  ]);
  const [newCounterName, setNewCounterName] = useState('');

  // --- Centrifuge State ---
  const [rpm, setRpm] = useState<number | ''>(12000);
  const [radius, setRadius] = useState<number | ''>(80); // mm
  const [rcf, setRcf] = useState<number | ''>('');

  // --- Converter State ---
  const [convCategory, setConvCategory] = useState<'temp' | 'mass' | 'vol' | 'conc'>('conc');
  const [convVal, setConvVal] = useState<number | ''>(1);
  const [convFrom, setConvFrom] = useState<string>('M');
  const [convTo, setConvTo] = useState<string>('uM');

  // --- Timer Logic ---
  useEffect(() => {
    const interval = setInterval(() => {
        setTimers(prevTimers => prevTimers.map(t => {
            if (t.isRunning && t.timeLeft > 0) {
                const next = t.timeLeft - 1;
                if (next === 0) {
                    // Play sound or alert?
                    // For now, just mark finished
                    return { ...t, timeLeft: 0, isRunning: false, isFinished: true };
                }
                return { ...t, timeLeft: next };
            }
            return t;
        }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const addTimer = () => {
      const min = Number(newTimerMin) || 0;
      const duration = min * 60;
      if (duration <= 0) return;
      
      const newTimer: LabTimer = {
          id: Date.now().toString(),
          name: newTimerName || `Timer ${timers.length + 1}`,
          duration,
          timeLeft: duration,
          isRunning: false,
          isFinished: false,
          originalDuration: duration
      };
      setTimers([...timers, newTimer]);
      setNewTimerName('');
  };

  const toggleTimer = (id: string) => {
      setTimers(prev => prev.map(t => t.id === id ? { ...t, isRunning: !t.isRunning } : t));
  };

  const resetTimer = (id: string) => {
      setTimers(prev => prev.map(t => t.id === id ? { ...t, timeLeft: t.originalDuration, isRunning: false, isFinished: false } : t));
  };

  const deleteTimer = (id: string) => {
      setTimers(prev => prev.filter(t => t.id !== id));
  };

  // --- Counter Logic ---
  const updateCount = (id: string, delta: number) => {
      setCounters(prev => prev.map(c => c.id === id ? { ...c, count: Math.max(0, c.count + delta) } : c));
  };
  const resetCounter = (id: string) => {
      setCounters(prev => prev.map(c => c.id === id ? { ...c, count: 0 } : c));
  };
  const addCounter = () => {
      setCounters(prev => [...prev, { 
          id: Date.now().toString(), 
          name: newCounterName || `Counter ${prev.length + 1}`, 
          count: 0, 
          color: COUNTER_COLORS[prev.length % COUNTER_COLORS.length] 
      }]);
      setNewCounterName('');
  };
  const deleteCounter = (id: string) => setCounters(prev => prev.filter(c => c.id !== id));

  // --- Centrifuge Logic ---
  // RCF = 1.118 * 10^-5 * r * (rpm)^2
  // r in cm? usually formula uses cm. Let's check inputs.
  // Standard: RCF = 1.118 * 10^-5 * r_cm * rpm^2
  // User input radius is usually mm in lab specs? Let's assume mm and convert to cm.
  // r_cm = r_mm / 10.
  
  const calcRcf = (r_mm: number, rpm_val: number) => {
      const r_cm = r_mm / 10;
      return 1.118e-5 * r_cm * Math.pow(rpm_val, 2);
  };

  const calcRpm = (r_mm: number, rcf_val: number) => {
      const r_cm = r_mm / 10;
      return Math.sqrt(rcf_val / (1.118e-5 * r_cm));
  };

  // Sync state
  useEffect(() => {
      if (rpm && radius) {
          const val = calcRcf(Number(radius), Number(rpm));
          setRcf(Math.round(val));
      }
  }, [rpm, radius]);

  const handleRcfChange = (val: string) => {
      const newRcf = parseFloat(val);
      setRcf(val === '' ? '' : newRcf);
      if (val !== '' && radius) {
          const newRpm = calcRpm(Number(radius), newRcf);
          setRpm(Math.round(newRpm)); // Don't trigger the useEffect loop if we control flow carefully, but simplest is separate handlers or refs.
          // Actually, the useEffect above will overwrite this if we are not careful.
          // Better: Separate calc functions, no useEffect syncing for bi-directional.
      }
  };
  
  // Re-write Centrifuge Inputs to be non-effect driven for bi-direction
  const onRpmInput = (val: string) => {
      const v = parseFloat(val);
      setRpm(val === '' ? '' : v);
      if (val !== '' && radius) {
          setRcf(Math.round(calcRcf(Number(radius), v)));
      }
  };

  const onRcfInput = (val: string) => {
      const v = parseFloat(val);
      setRcf(val === '' ? '' : v);
      if (val !== '' && radius) {
          setRpm(Math.round(calcRpm(Number(radius), v)));
      }
  };

  const onRadiusInput = (val: string) => {
      const v = parseFloat(val);
      setRadius(val === '' ? '' : v);
      // If we have RPM, update RCF. Preference to keep RPM steady?
      if (val !== '' && rpm) {
          setRcf(Math.round(calcRcf(v, Number(rpm))));
      }
  };

  // --- Converter Logic ---
  const CONV_UNITS = {
      temp: [{u:'C', n:'°C'}, {u:'F', n:'°F'}, {u:'K', n:'K'}],
      mass: [{u:'g', n:'g', f:1}, {u:'mg', n:'mg', f:1e-3}, {u:'ug', n:'µg', f:1e-6}, {u:'ng', n:'ng', f:1e-9}, {u:'kg', n:'kg', f:1000}],
      vol: [{u:'L', n:'L', f:1}, {u:'mL', n:'mL', f:1e-3}, {u:'uL', n:'µL', f:1e-6}, {u:'nL', n:'nL', f:1e-9}],
      conc: [{u:'M', n:'M', f:1}, {u:'mM', n:'mM', f:1e-3}, {u:'uM', n:'µM', f:1e-6}, {u:'nM', n:'nM', f:1e-9}]
  };

  const convert = (val: number, from: string, to: string, cat: string) => {
      if (cat === 'temp') {
          let c = val;
          if (from === 'F') c = (val - 32) * 5/9;
          if (from === 'K') c = val - 273.15;
          if (to === 'C') return c;
          if (to === 'F') return c * 9/5 + 32;
          if (to === 'K') return c + 273.15;
          return c;
      }
      // Linear
      const units = CONV_UNITS[cat as 'mass' | 'vol' | 'conc'];
      const fromFactor = units.find(u => u.u === from)?.f || 1;
      const toFactor = units.find(u => u.u === to)?.f || 1;
      // val * from = base. base / to = result
      return (val * fromFactor) / toFactor;
  };

  const conversionResult = useMemo(() => {
      if (convVal === '') return '---';
      const res = convert(Number(convVal), convFrom, convTo, convCategory);
      // scientific notation for extreme values
      if (res > 10000 || (res < 0.001 && res > 0)) return res.toExponential(4);
      return Number.isInteger(res) ? res : res.toFixed(4).replace(/\.?0+$/, '');
  }, [convVal, convFrom, convTo, convCategory]);


  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
           <div className="bg-teal-100 p-3 rounded-2xl text-teal-600">
                <Settings size={32} />
           </div>
           <div>
               <h2 className="text-2xl font-bold text-slate-800">实验室小工具</h2>
               <p className="text-slate-500">计时、计数、计算、换算，一站式解决</p>
           </div>
       </div>

       <div className="grid lg:grid-cols-12 gap-6 min-h-[600px]">
          
          {/* LEFT: Navigation */}
          <div className="lg:col-span-3 flex flex-col gap-2">
              <button onClick={() => setActiveTab('timer')} className={`text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center justify-between ${activeTab === 'timer' ? 'bg-teal-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-teal-50'}`}>
                <span className="flex items-center gap-2"><Timer size={18} /> 多通道计时器</span>
                {activeTab === 'timer' && <ArrowRight size={16} />}
              </button>
              <button onClick={() => setActiveTab('counter')} className={`text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center justify-between ${activeTab === 'counter' ? 'bg-teal-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-teal-50'}`}>
                <span className="flex items-center gap-2"><Hash size={18} /> 手动计数器</span>
                {activeTab === 'counter' && <ArrowRight size={16} />}
              </button>
              <button onClick={() => setActiveTab('centrifuge')} className={`text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center justify-between ${activeTab === 'centrifuge' ? 'bg-teal-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-teal-50'}`}>
                <span className="flex items-center gap-2"><RotateCw size={18} /> 离心机转速换算</span>
                {activeTab === 'centrifuge' && <ArrowRight size={16} />}
              </button>
              <button onClick={() => setActiveTab('convert')} className={`text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center justify-between ${activeTab === 'convert' ? 'bg-teal-600 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-teal-50'}`}>
                <span className="flex items-center gap-2"><ArrowLeftRight size={18} /> 单位换算</span>
                {activeTab === 'convert' && <ArrowRight size={16} />}
              </button>
          </div>

          {/* RIGHT: Content */}
          <div className="lg:col-span-9 bg-white rounded-xl shadow-sm border border-slate-200 p-6 min-h-[500px]">
              
              {/* --- TIMER TAB --- */}
              {activeTab === 'timer' && (
                  <div className="space-y-6">
                      <div className="flex flex-wrap gap-4 items-end border-b border-slate-100 pb-6">
                          <div className="flex-1 min-w-[200px]">
                              <label className="block text-xs font-bold text-slate-500 mb-1">任务名称</label>
                              <input type="text" value={newTimerName} onChange={e => setNewTimerName(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="例如: 抗体孵育" />
                          </div>
                          <div className="w-24">
                              <label className="block text-xs font-bold text-slate-500 mb-1">时长 (分钟)</label>
                              <input type="number" value={newTimerMin} onChange={e => setNewTimerMin(parseFloat(e.target.value) || '')} className="w-full px-3 py-2 border rounded-lg text-sm" />
                          </div>
                          <button onClick={addTimer} className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-teal-700 flex items-center gap-1">
                              <Plus size={16} /> 添加
                          </button>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                          {timers.map(t => (
                              <div key={t.id} className={`relative p-4 rounded-xl border-2 transition-all ${t.isFinished ? 'border-red-400 bg-red-50' : t.isRunning ? 'border-teal-400 bg-teal-50' : 'border-slate-100 bg-slate-50'}`}>
                                  <div className="flex justify-between items-start mb-2">
                                      <h3 className="font-bold text-slate-700">{t.name}</h3>
                                      <button onClick={() => deleteTimer(t.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                                  </div>
                                  <div className={`text-4xl font-mono font-bold mb-4 tracking-wider ${t.isFinished ? 'text-red-600 animate-pulse' : 'text-slate-800'}`}>
                                      {formatTime(t.timeLeft).text}
                                  </div>
                                  <div className="flex gap-2">
                                      {t.isFinished ? (
                                          <button onClick={() => resetTimer(t.id)} className="flex-1 bg-slate-800 text-white py-2 rounded-lg font-medium hover:bg-slate-900">确认 / 重置</button>
                                      ) : (
                                          <>
                                              <button onClick={() => toggleTimer(t.id)} className={`flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-2 ${t.isRunning ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-teal-600 text-white hover:bg-teal-700'}`}>
                                                  {t.isRunning ? <><Pause size={16}/> 暂停</> : <><Play size={16}/> 开始</>}
                                              </button>
                                              <button onClick={() => resetTimer(t.id)} className="px-3 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300"><RotateCcw size={16} /></button>
                                          </>
                                      )}
                                  </div>
                                  {/* Progress Bar */}
                                  <div className="absolute bottom-0 left-0 h-1 bg-teal-600 transition-all duration-1000 ease-linear rounded-b-xl opacity-20" style={{ width: `${(t.timeLeft / t.originalDuration) * 100}%` }}></div>
                              </div>
                          ))}
                      </div>
                  </div>
              )}

              {/* --- COUNTER TAB --- */}
              {activeTab === 'counter' && (
                  <div className="space-y-6">
                      <div className="flex gap-2 mb-6">
                          <input type="text" value={newCounterName} onChange={e => setNewCounterName(e.target.value)} className="px-3 py-2 border rounded-lg text-sm flex-1" placeholder="新计数器名称..." />
                          <button onClick={addCounter} className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-teal-700 flex items-center gap-1"><Plus size={16} /> 添加</button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          {counters.map(c => (
                              <div key={c.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center relative overflow-hidden group">
                                  <div className="absolute top-0 left-0 w-full h-1" style={{backgroundColor: c.color}}></div>
                                  <div className="w-full flex justify-between items-center mb-4">
                                      <h3 className="font-bold text-slate-700 text-sm truncate">{c.name}</h3>
                                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button onClick={() => resetCounter(c.id)} className="text-slate-400 hover:text-slate-600 p-1"><RotateCcw size={12} /></button>
                                          <button onClick={() => deleteCounter(c.id)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={12} /></button>
                                      </div>
                                  </div>
                                  
                                  <div className="text-5xl font-bold text-slate-800 mb-6 font-mono">{c.count}</div>
                                  
                                  <div className="w-full flex gap-2">
                                      <button onClick={() => updateCount(c.id, -1)} className="w-12 py-3 bg-white border border-slate-300 rounded-lg text-slate-500 hover:bg-slate-100 font-bold text-xl shadow-sm">-</button>
                                      <button onClick={() => updateCount(c.id, 1)} className="flex-1 py-3 text-white rounded-lg font-bold text-xl shadow-md active:scale-95 transition-transform" style={{backgroundColor: c.color}}>+</button>
                                  </div>
                              </div>
                          ))}
                      </div>
                      
                      <div className="mt-8 p-4 bg-slate-50 rounded-lg text-xs text-slate-500 text-center">
                          提示：此功能可用于显微镜下多类型细胞计数。支持键盘快捷键开发中...
                      </div>
                  </div>
              )}

              {/* --- CENTRIFUGE TAB --- */}
              {activeTab === 'centrifuge' && (
                  <div className="h-full flex flex-col items-center justify-center space-y-12 py-10">
                      <div className="bg-teal-50 p-6 rounded-full">
                          <Gauge size={64} className="text-teal-600" />
                      </div>
                      
                      <div className="w-full max-w-lg space-y-8">
                          {/* Radius Input */}
                          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                              <div className="bg-slate-100 p-2 rounded-lg"><Ruler size={24} className="text-slate-500" /></div>
                              <div className="flex-1">
                                  <label className="block text-xs font-bold text-slate-500 mb-1">离心半径 (Radius)</label>
                                  <div className="flex items-center gap-2">
                                      <input type="number" value={radius} onChange={e => onRadiusInput(e.target.value)} className="w-full text-lg font-bold text-slate-700 bg-transparent outline-none border-b border-slate-300 focus:border-teal-500 transition-colors" placeholder="0" />
                                      <span className="text-sm font-medium text-slate-400">mm</span>
                                  </div>
                              </div>
                          </div>

                          <div className="flex items-center gap-4">
                              {/* RPM Input */}
                              <div className="flex-1 bg-blue-50 p-5 rounded-2xl border border-blue-100 relative group focus-within:ring-2 ring-blue-400 transition-all">
                                  <label className="block text-xs font-bold text-blue-400 mb-2 uppercase tracking-wider">转速 (Speed)</label>
                                  <input 
                                      type="number" 
                                      value={rpm} 
                                      onChange={e => onRpmInput(e.target.value)} 
                                      className="w-full bg-transparent text-3xl font-bold text-blue-700 outline-none"
                                      placeholder="0"
                                  />
                                  <div className="text-sm text-blue-400 font-medium text-right">RPM</div>
                              </div>

                              <ArrowLeftRight size={24} className="text-slate-300" />

                              {/* RCF Input */}
                              <div className="flex-1 bg-teal-50 p-5 rounded-2xl border border-teal-100 relative group focus-within:ring-2 ring-teal-400 transition-all">
                                  <label className="block text-xs font-bold text-teal-400 mb-2 uppercase tracking-wider">离心力 (Force)</label>
                                  <input 
                                      type="number" 
                                      value={rcf} 
                                      onChange={e => onRcfInput(e.target.value)} 
                                      className="w-full bg-transparent text-3xl font-bold text-teal-700 outline-none"
                                      placeholder="0"
                                  />
                                  <div className="text-sm text-teal-400 font-medium text-right">× g</div>
                              </div>
                          </div>
                      </div>

                      <p className="text-xs text-slate-400">
                          Formula: RCF = 1.118 × 10⁻⁵ × r × rpm² (r in cm)
                      </p>
                  </div>
              )}

              {/* --- CONVERTER TAB --- */}
              {activeTab === 'convert' && (
                  <div className="space-y-8 py-4">
                      {/* Category Select */}
                      <div className="flex justify-center gap-2 flex-wrap">
                          {[
                              {id: 'conc', label: '浓度 (Molarity)'}, 
                              {id: 'mass', label: '质量 (Mass)'}, 
                              {id: 'vol', label: '体积 (Volume)'}, 
                              {id: 'temp', label: '温度 (Temp)'}
                          ].map(c => (
                              <button 
                                key={c.id} 
                                onClick={() => { setConvCategory(c.id as any); setConvFrom(CONV_UNITS[c.id as 'conc'][0].u); setConvTo(CONV_UNITS[c.id as 'conc'][1].u); }}
                                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${convCategory === c.id ? 'bg-slate-800 text-white shadow-lg' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                              >
                                  {c.label}
                              </button>
                          ))}
                      </div>

                      <div className="bg-slate-50 rounded-2xl p-6 md:p-8 w-full max-w-3xl mx-auto border border-slate-200 flex flex-col md:flex-row items-center gap-6 md:gap-8">
                          
                          {/* Left Side */}
                          <div className="w-full md:flex-1 space-y-2">
                              <label className="block text-xs font-bold text-slate-400 uppercase">Input</label>
                              <div className="flex gap-2">
                                  <input 
                                      type="number" 
                                      value={convVal} 
                                      onChange={e => setConvVal(parseFloat(e.target.value) || '')} 
                                      className="flex-1 min-w-0 text-xl md:text-2xl font-bold p-2 bg-white border border-slate-200 rounded-lg outline-none focus:border-teal-500" 
                                  />
                                  <select 
                                      value={convFrom} 
                                      onChange={e => setConvFrom(e.target.value)} 
                                      className="w-24 shrink-0 bg-white border border-slate-200 rounded-lg text-sm font-medium"
                                  >
                                      {CONV_UNITS[convCategory].map(u => <option key={u.u} value={u.u}>{u.n}</option>)}
                                  </select>
                              </div>
                          </div>

                          <div className="text-slate-300 rotate-90 md:rotate-0 shrink-0">
                              <ArrowRight size={24} className="md:w-8 md:h-8" />
                          </div>

                          {/* Right Side */}
                          <div className="w-full md:flex-1 space-y-2">
                              <label className="block text-xs font-bold text-slate-400 uppercase">Result</label>
                              <div className="flex gap-2">
                                  <div className="flex-1 min-w-0 text-xl md:text-2xl font-bold p-2 bg-teal-50 border border-teal-100 rounded-lg text-teal-800 overflow-hidden text-ellipsis whitespace-nowrap">
                                      {conversionResult}
                                  </div>
                                  <select 
                                      value={convTo} 
                                      onChange={e => setConvTo(e.target.value)} 
                                      className="w-24 shrink-0 bg-white border border-slate-200 rounded-lg text-sm font-medium"
                                  >
                                      {CONV_UNITS[convCategory].map(u => <option key={u.u} value={u.u}>{u.n}</option>)}
                                  </select>
                              </div>
                          </div>

                      </div>
                  </div>
              )}

          </div>
       </div>
    </div>
  );
};