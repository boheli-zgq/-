import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './features/Dashboard';
import { QpcrTool } from './features/qpcr/QpcrTool';
import { MolarityTool } from './features/molarity/MolarityTool';
import { WesternTool } from './features/western/WesternTool';
import { BcaTool } from './features/bca/BcaTool';
import { TranswellTool } from './features/transwell/TranswellTool';
import { ScratchTool } from './features/scratch/ScratchTool';
import { ImmunofluorescenceTool } from './features/immunofluorescence/ImmunofluorescenceTool';
import { EduTool } from './features/edu/EduTool';
import { Sparkles, X } from 'lucide-react';

function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'qpcr' | 'molarity' | 'western' | 'bca' | 'transwell' | 'scratch' | 'if_analysis' | 'edu'>('dashboard');
  const [showWelcome, setShowWelcome] = useState(true);

  return (
    <Layout 
      onGoHome={() => setCurrentView('dashboard')}
      onBack={currentView !== 'dashboard' ? () => setCurrentView('dashboard') : undefined}
    >
      {currentView === 'dashboard' && (
        <Dashboard onSelectTool={(id) => setCurrentView(id as any)} />
      )}
      {currentView === 'qpcr' && (
        <QpcrTool />
      )}
      {currentView === 'molarity' && (
        <MolarityTool />
      )}
      {currentView === 'western' && (
        <WesternTool />
      )}
      {currentView === 'bca' && (
        <BcaTool />
      )}
      {currentView === 'transwell' && (
        <TranswellTool />
      )}
      {currentView === 'scratch' && (
        <ScratchTool />
      )}
      {currentView === 'if_analysis' && (
        <ImmunofluorescenceTool />
      )}
      {currentView === 'edu' && (
        <EduTool />
      )}

      {/* Welcome Modal */}
      {showWelcome && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative transform transition-all scale-100 border border-slate-100">
             <button 
                onClick={() => setShowWelcome(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-full hover:bg-slate-50"
             >
                <X size={20} />
             </button>

             <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-gradient-to-tr from-science-100 to-purple-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
                    <Sparkles size={32} className="text-science-600" />
                </div>
                
                <h3 className="text-xl font-bold text-slate-800 mb-3">欢迎使用 SciTools Hub</h3>
                
                <div className="text-slate-600 leading-relaxed mb-8 space-y-2">
                    <p>网站功能尚在开发中，大家积极提供建议。</p>
                    <p className="font-bold text-science-600 text-lg bg-science-50 py-2 rounded-lg px-2">
                        祝各位实验顺利，工作顺利，毕业顺利！ 🎓
                    </p>
                </div>

                <button 
                    onClick={() => setShowWelcome(false)}
                    className="w-full bg-science-600 hover:bg-science-700 text-white py-3 rounded-xl font-medium shadow-lg shadow-science-500/25 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                    开始探索
                </button>
             </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export default App;