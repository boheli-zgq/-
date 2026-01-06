import React from 'react';
import { Activity, Dna, FlaskConical, Calculator, Grid3x3, Pipette, Target, Ruler } from 'lucide-react';

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
      desc: '上传条带图片，手动框选目标蛋白与内参蛋白，自动计算相对灰度值并归一化。',
      icon: <Activity size={32} className="text-emerald-500" />,
      color: 'border-emerald-200 hover:border-emerald-500',
      active: true
    },
    {
      id: 'bca',
      title: 'ELISA和BCA 蛋白定量分析',
      desc: '输入标准品与样品的 OD 值，自动拟合标准曲线（线性/多项式），计算样品蛋白浓度。',
      icon: <Pipette size={32} className="text-orange-500" />,
      color: 'border-orange-200 hover:border-orange-500',
      active: true
    },
    {
      id: 'transwell',
      title: 'Transwell 细胞计数',
      desc: '智能识别染色细胞，自动计算迁移/侵袭细胞数量，支持批量处理与结果导出。',
      icon: <Target size={32} className="text-indigo-500" />,
      color: 'border-indigo-200 hover:border-indigo-500',
      active: false
    },
    {
      id: 'scratch',
      title: '细胞划痕愈合分析',
      desc: '自动识别划痕边缘，计算划痕面积、愈合百分比及迁移速度。',
      icon: <Ruler size={32} className="text-cyan-500" />,
      color: 'border-cyan-200 hover:border-cyan-500',
      active: false
    },
    {
      id: 'cell_plating',
      title: '细胞铺板计算器',
      desc: '根据细胞计数结果，快速计算不同规格培养板（6孔、24孔、96孔等）的铺板体积与密度。',
      icon: <Grid3x3 size={32} className="text-pink-500" />,
      color: 'border-pink-200 hover:border-pink-500',
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
                : 'border-slate-100 opacity-70 cursor-not-allowed grayscale-[0.1]'}
            `}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-slate-50 rounded-xl">
                {tool.icon}
              </div>
              {!tool.active && (
                <span className="px-2 py-1 bg-slate-100 text-slate-400 text-xs font-medium rounded-full border border-slate-200">
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