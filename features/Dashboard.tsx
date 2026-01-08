import React, { useState } from 'react';
import { Activity, Dna, FlaskConical, Calculator, Grid3x3, Pipette, Target, Ruler, Aperture, CircleDot, Disc, Biohazard, Quote, Palette, ScanFace, Table2, PawPrint, Layers, Timer, MessageCircle, X, Heart, Network } from 'lucide-react';

interface DashboardProps {
  onSelectTool: (toolId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onSelectTool }) => {
  const [showFeedback, setShowFeedback] = useState(false);

  // ==========================================
  // 👇 在这里修改您的座右铭
  // ==========================================
  const MOTTO = "小小怪下士，你要知道人生的容错率超乎你的想象。";

  const tools = [
    {
      id: 'lab_utils',
      title: '实验室小工具',
      desc: '多通道计时器、多组计数器、离心机转速(RPM/RCF)换算及常用单位换算助手。',
      icon: <Timer size={32} className="text-teal-600" />,
      color: 'border-teal-200 hover:border-teal-500',
      active: true
    },
    {
      id: 'qpcr',
      title: 'qPCR 相对定量分析',
      desc: '基于 2^-ΔΔCt 方法，自动生成柱状图与统计结果。支持从 Excel/Word 直接复制数据。',
      icon: <Dna size={32} className="text-science-600" />,
      color: 'border-science-200 hover:border-science-500',
      active: true
    },
    {
      id: 'qpcr_layout',
      title: 'qPCR 加样排布设计',
      desc: '可视化设计 96/384 孔板加样布局。自动排列样本与基因，支持导出加样表。',
      icon: <Table2 size={32} className="text-blue-500" />,
      color: 'border-blue-200 hover:border-blue-500',
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
      id: 'western_design',
      title: 'Western Blot 实验设计',
      desc: '内参/标签查询、凝胶浓度计算与电泳条带模拟。可视化辅助 Marker 选择与上样设计。',
      icon: <Layers size={32} className="text-indigo-600" />,
      color: 'border-indigo-200 hover:border-indigo-500',
      active: true
    },
    {
      id: 'animal_design',
      title: '动物实验设计',
      desc: '包含给药方案计算器、随机分组助手等工具。快速计算给药体积与配液方案。',
      icon: <PawPrint size={32} className="text-amber-700" />,
      color: 'border-amber-200 hover:border-amber-500',
      active: true
    },
    {
      id: 'ihc',
      title: '免疫组化 (IHC) 分析',
      desc: '基于颜色解卷积算法(H&E DAB)，自动计算阳性面积占比、平均光密度及 H-Score。',
      icon: <Palette size={32} className="text-amber-600" />,
      color: 'border-amber-200 hover:border-amber-500',
      active: true
    },
    {
      id: 'angiogenesis',
      title: '血管生成 (Tube Formation)',
      desc: '自动识别血管网络，骨架化计算总管长、节点数 (Junctions) 及成环数 (Meshes)。',
      icon: <Network size={32} className="text-red-500" />,
      color: 'border-red-200 hover:border-red-500',
      active: true
    },
    {
      id: 'colony',
      title: '克隆形成定量分析',
      desc: '自动识别培养皿中的细胞克隆团。支持圆形掩膜去除边缘干扰，批量统计克隆数量。',
      icon: <Disc size={32} className="text-fuchsia-500" />,
      color: 'border-fuchsia-200 hover:border-fuchsia-500',
      active: true
    },
    {
      id: 'transfection',
      title: '病毒转染计算器',
      desc: '根据 MOI 和病毒滴度，计算所需的病毒体积。包含微量体积稀释建议与毒性预警。',
      icon: <Biohazard size={32} className="text-violet-600" />,
      color: 'border-violet-200 hover:border-violet-500',
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
      id: 'if_analysis',
      title: '免疫荧光定量分析',
      desc: '支持多通道荧光图片分析，计算平均荧光强度(MFI)、阳性面积占比及积分光密度。',
      icon: <Aperture size={32} className="text-rose-500" />,
      color: 'border-rose-200 hover:border-rose-500',
      active: true
    },
    {
      id: 'edu',
      title: 'EdU 细胞增殖分析',
      desc: '自动识别 DAPI（总细胞）与 EdU（阳性细胞），计算细胞增殖率与细胞计数。',
      icon: <CircleDot size={32} className="text-lime-500" />,
      color: 'border-lime-200 hover:border-lime-500',
      active: true
    },
    {
      id: 'transwell',
      title: 'Transwell 细胞计数',
      desc: '智能识别染色细胞，自动计算迁移/侵袭细胞数量，支持批量处理与结果导出。',
      icon: <Target size={32} className="text-indigo-500" />,
      color: 'border-indigo-200 hover:border-indigo-500',
      active: true
    },
    {
      id: 'scratch',
      title: '细胞划痕愈合分析',
      desc: '自动识别划痕边缘，计算划痕面积、愈合百分比及迁移速度。',
      icon: <Ruler size={32} className="text-cyan-500" />,
      color: 'border-cyan-200 hover:border-cyan-500',
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
      id: 'cell_plating',
      title: '细胞铺板计算器',
      desc: '根据细胞计数结果，快速计算不同规格培养板（6孔、24孔、96孔等）的铺板体积与密度。',
      icon: <Grid3x3 size={32} className="text-pink-500" />,
      color: 'border-pink-200 hover:border-pink-500',
      active: true
    },
    {
      id: 'feedback',
      title: '意见反馈',
      desc: '与开发者交流，提交 Bug 或新功能建议。点击查看联系方式。',
      icon: <MessageCircle size={32} className="text-rose-500" />,
      color: 'border-rose-200 hover:border-rose-500',
      active: true,
      action: () => setShowFeedback(true)
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <div className="text-center max-w-4xl mx-auto mb-16 pt-8">
        <h2 className="text-4xl font-extrabold text-slate-800 tracking-tight mb-10">
            欢迎来到科研的世界
        </h2>
        
        {/* Motto Section */}
        <div className="relative inline-block px-12 py-8 bg-white rounded-2xl shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] border border-slate-100 transition-transform duration-500 hover:scale-[1.02] cursor-default group">
            <div className="absolute top-4 left-4 text-science-100 group-hover:text-science-200 transition-colors duration-500">
                <Quote size={32} className="transform -scale-x-100" fill="currentColor" />
            </div>
            <p className="text-slate-700 text-xl md:text-2xl font-serif italic tracking-wide leading-relaxed relative z-10 px-4">
                {MOTTO}
            </p>
            <div className="absolute bottom-4 right-4 text-science-100 group-hover:text-science-200 transition-colors duration-500">
                <Quote size={32} fill="currentColor" />
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool) => (
          <div
            key={tool.id}
            onClick={() => {
                if (tool.action) {
                    tool.action();
                } else if (tool.active) {
                    onSelectTool(tool.id);
                }
            }}
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

      {/* Feedback Modal */}
      {showFeedback && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) setShowFeedback(false); }}>
            <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-8 relative border border-slate-100 text-center transform transition-all scale-100">
                <button 
                    onClick={() => setShowFeedback(false)} 
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-full hover:bg-slate-50"
                >
                    <X size={20} />
                </button>
                
                <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6 ring-4 ring-rose-50/50">
                    <Heart size={32} className="text-rose-500 fill-rose-500" />
                </div>
                
                <h3 className="text-xl font-bold text-slate-800 mb-3">意见反馈</h3>
                
                <div className="text-slate-600 leading-relaxed mb-8">
                    <p className="mb-4">感谢您使用 SciTools Hub！<br/>如果您有任何建议、Bug 反馈或新功能需求。</p>
                    <div className="bg-rose-50 border border-rose-100 rounded-xl p-4">
                        <p className="text-sm text-slate-500 mb-1">您可以在小红书搜索</p>
                        <p className="text-lg font-bold text-rose-600">@薄荷狸</p>
                        <p className="text-xs text-rose-400 mt-0.5">ID: 276397762</p>
                        <p className="text-sm text-slate-500 mt-2">与我直接交流</p>
                    </div>
                </div>

                <button 
                    onClick={() => setShowFeedback(false)} 
                    className="w-full bg-slate-800 text-white px-6 py-3 rounded-xl font-medium hover:bg-slate-900 transition-colors shadow-lg shadow-slate-200"
                >
                    我知道了
                </button>
            </div>
        </div>
      )}
    </div>
  );
};