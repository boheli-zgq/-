import React from 'react';
import { Activity, Dna, FlaskConical, Calculator } from 'lucide-react';

interface DashboardProps {
  onSelectTool: (toolId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onSelectTool }) => {
  const tools = [
    {
      id: 'qpcr',
      title: 'qPCR 相对定量分析',
      desc: '基于 2^-ΔΔCt 方法，自动生成柱状图与统计结果。支持从 Excel/Word 直接复制数据。',
      icon: <Dna size={32} className="text-science-600" />,
      color: 'border-science-200 hover:border-science-500',
      active: true
    },
    {
      id: 'molarity',
      title: '摩尔浓度计算器',
      desc: '快速计算溶液配制所需的质量或体积。支持常用试剂预设与稀释计算。',
      icon: <FlaskConical size={32} className="text-purple-500" />,
      color: 'border-purple-200 hover:border-purple-500',
      active: true
    },
    {
      id: 'western',
      title: 'Western Blot 灰度分析',
      desc: '上传条带图片，自动分析相对灰度值并进行归一化处理。',
      icon: <Activity size={32} className="text-emerald-500" />,
      color: 'border-emerald-200 hover:border-emerald-500',
      active: false
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center max-w-2xl mx-auto space-y-4">
        <h2 className="text-3xl font-bold text-slate-800">选择您的实验工具</h2>
        <p className="text-slate-500">高效、精准、可视化的数据分析体验，助力科研发现。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool) => (
          <div
            key={tool.id}
            onClick={() => tool.active && onSelectTool(tool.id)}
            className={`
              relative bg-white rounded-2xl p-6 border-2 transition-all duration-300 shadow-sm
              ${tool.active 
                ? `${tool.color} cursor-pointer hover:shadow-lg hover:-translate-y-1` 
                : 'border-slate-100 opacity-60 cursor-not-allowed grayscale-[0.5]'}
            `}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-slate-50 rounded-xl">
                {tool.icon}
              </div>
              {!tool.active && (
                <span className="px-2 py-1 bg-slate-100 text-slate-400 text-xs font-medium rounded-full">
                  开发中
                </span>
              )}
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">{tool.title}</h3>
            <p className="text-slate-500 text-sm leading-relaxed">{tool.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};