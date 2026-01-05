import React, { useMemo } from 'react';
import { AnalysisOutput, QpcrConfig } from '../../types';
import { generateCsv } from '../../services/qpcrService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ErrorBar, Cell } from 'recharts';
import { Download, ArrowLeft, RotateCcw } from 'lucide-react';

interface Props {
  config: QpcrConfig;
  results: AnalysisOutput;
  onReset: () => void;
  onBack: () => void;
}

export const QpcrResults: React.FC<Props> = ({ config, results, onReset, onBack }) => {
  
  const handleExport = () => {
    const csvContent = generateCsv(results);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `qPCR_Results_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Prepare chart data: Flatten structure for Recharts
  // Needs to look like: [{ name: 'GroupA', gene1: 1.2, gene1_err: 0.1, gene2: ... }]
  const chartData = useMemo(() => {
    return config.groups.map(group => {
      const entry: any = { name: group };
      config.targetGenes.forEach(gene => {
        const res = results.groupResults.find(r => r.group === group && r.targetGene === gene);
        if (res) {
          entry[gene] = parseFloat(res.avgFoldChange.toFixed(3));
          entry[`${gene}_error`] = [
            parseFloat((res.avgFoldChange - res.sem).toFixed(3)),
            parseFloat((res.avgFoldChange + res.sem).toFixed(3))
          ];
        }
      });
      return entry;
    });
  }, [config, results]);

  const colors = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Actions */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm font-medium">
            <ArrowLeft size={16} /> 修改数据
        </button>
        <div className="flex gap-3">
             <button
                onClick={onReset}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
            >
                <RotateCcw size={16} /> 新的分析
            </button>
            <button
                onClick={handleExport}
                className="px-4 py-2 bg-science-600 hover:bg-science-700 text-white rounded-lg flex items-center gap-2 text-sm font-medium shadow-md shadow-science-500/20 transition-all active:scale-95"
            >
                <Download size={16} /> 导出结果 (CSV)
            </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Chart Section */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-6 pl-2 border-l-4 border-science-500">相对表达量 (Relative Expression)</h3>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} label={{ value: 'Fold Change (2^-ΔΔCt)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8' } }} />
                <Tooltip 
                    cursor={{ fill: '#f1f5f9' }}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                
                {config.targetGenes.map((gene, index) => (
                  <Bar key={gene} dataKey={gene} name={gene} fill={colors[index % colors.length]} radius={[4, 4, 0, 0]}>
                    <ErrorBar dataKey={`${gene}_error`} width={4} strokeWidth={2} stroke="#334155" />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-center text-xs text-slate-400 mt-4">Error Bars represent Standard Error of Mean (SEM)</p>
        </div>

        {/* Summary Table Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 overflow-hidden">
             <h3 className="text-lg font-bold text-slate-800 mb-4 pl-2 border-l-4 border-purple-500">数据摘要</h3>
             <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500">
                        <tr>
                            <th className="px-3 py-2 rounded-l-lg">分组</th>
                            <th className="px-3 py-2">基因</th>
                            <th className="px-3 py-2 text-right rounded-r-lg">Mean ± SEM</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {results.groupResults.map((res, idx) => (
                            <tr key={`${res.group}-${res.targetGene}`} className="hover:bg-slate-50">
                                <td className="px-3 py-3 font-medium text-slate-700">{res.group}</td>
                                <td className="px-3 py-3 text-slate-600">{res.targetGene}</td>
                                <td className="px-3 py-3 text-right font-mono text-science-600">
                                    {res.avgFoldChange.toFixed(2)} <span className="text-slate-400 text-xs">± {res.sem.toFixed(2)}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
             </div>
        </div>
      </div>
      
      {/* Detailed Data Expandable (Optional, kept simple for now) */}
    </div>
  );
};