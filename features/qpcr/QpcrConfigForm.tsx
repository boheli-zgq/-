import React, { useState } from 'react';
import { QpcrConfig } from '../../types';
import { Settings, Plus, Trash2 } from 'lucide-react';

interface Props {
  initialConfig: QpcrConfig;
  onNext: (config: QpcrConfig) => void;
}

export const QpcrConfigForm: React.FC<Props> = ({ initialConfig, onNext }) => {
  const [config, setConfig] = useState<QpcrConfig>(initialConfig);
  const [newGroup, setNewGroup] = useState('');
  const [newGene, setNewGene] = useState('');

  const addGroup = () => {
    if (newGroup && !config.groups.includes(newGroup)) {
      setConfig(prev => ({ ...prev, groups: [...prev.groups, newGroup] }));
      setNewGroup('');
    }
  };

  const removeGroup = (g: string) => {
    if (config.groups.length <= 1) return; // Prevent deleting last group
    setConfig(prev => ({
      ...prev,
      groups: prev.groups.filter(x => x !== g),
      controlGroup: prev.controlGroup === g ? prev.groups.find(x => x !== g) || '' : prev.controlGroup
    }));
  };

  const addGene = () => {
    if (newGene && !config.targetGenes.includes(newGene)) {
      setConfig(prev => ({ ...prev, targetGenes: [...prev.targetGenes, newGene] }));
      setNewGene('');
    }
  };

  const removeGene = (g: string) => {
    if (config.targetGenes.length <= 1) return;
    setConfig(prev => ({ ...prev, targetGenes: prev.targetGenes.filter(x => x !== g) }));
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
        <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
          <Settings size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800">实验参数设置</h2>
          <p className="text-sm text-slate-500">定义您的实验分组和基因信息</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Left Column: General & Groups */}
        <div className="space-y-6">
          {/* Replicates */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">生物学重复数 (n)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={config.replicates}
              onChange={(e) => setConfig({ ...config, replicates: parseInt(e.target.value) || 3 })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-science-500 focus:border-transparent transition-all"
            />
          </div>

          {/* Reference Gene */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">内参基因名称 (Reference Gene)</label>
            <input
              type="text"
              value={config.referenceGene}
              onChange={(e) => setConfig({ ...config, referenceGene: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-science-500 focus:border-transparent transition-all"
            />
          </div>

          {/* Groups Management */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">实验分组</label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="添加分组 (如: Treatment A)"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-science-500 outline-none"
              />
              <button 
                onClick={addGroup}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 rounded-lg transition-colors"
              >
                <Plus size={20} />
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {config.groups.map(group => (
                <div key={group} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                  <span className="text-sm font-medium text-slate-700">{group}</span>
                  <button 
                    onClick={() => removeGroup(group)}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Control & Targets */}
        <div className="space-y-6">
           {/* Control Selector */}
           <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">对照组 (Control Group)</label>
            <select
              value={config.controlGroup}
              onChange={(e) => setConfig({ ...config, controlGroup: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-science-500 focus:border-transparent bg-white"
            >
              {config.groups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">用于 ΔΔCt 计算的基准组</p>
          </div>

          {/* Target Genes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">目的基因列表 (Target Genes)</label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="添加基因 (如: IL-6)"
                value={newGene}
                onChange={(e) => setNewGene(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGene()}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-science-500 outline-none"
              />
              <button 
                onClick={addGene}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 rounded-lg transition-colors"
              >
                <Plus size={20} />
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {config.targetGenes.map(gene => (
                <div key={gene} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                  <span className="text-sm font-medium text-slate-700">{gene}</span>
                  <button 
                    onClick={() => removeGene(gene)}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={() => onNext(config)}
          className="bg-science-600 hover:bg-science-700 text-white px-8 py-3 rounded-lg font-medium shadow-lg shadow-science-500/20 transition-all hover:scale-105 active:scale-95"
        >
          下一步：录入数据
        </button>
      </div>
    </div>
  );
};