import React from 'react';
import { Microscope, Activity, Github, ArrowLeft } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  onGoHome: () => void;
  onBack?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, onGoHome, onBack }) => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer group" 
            onClick={onGoHome}
          >
            <div className="bg-science-600 p-2 rounded-lg text-white group-hover:bg-science-700 transition-colors">
              <Microscope size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">SciTools Hub</h1>
              <p className="text-xs text-slate-500">科研实验工具平台</p>
            </div>
          </div>
          <nav className="flex items-center gap-6">
            <a href="#" className="text-sm font-medium text-slate-600 hover:text-science-600 transition-colors">使用教程</a>
            <a href="#" className="text-sm font-medium text-slate-600 hover:text-science-600 transition-colors">关于我们</a>
            <a href="#" className="text-slate-400 hover:text-slate-800 transition-colors">
              <Github size={20} />
            </a>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {onBack && (
          <button 
            onClick={onBack}
            className="mb-6 flex items-center gap-2 text-slate-500 hover:text-science-600 transition-colors group"
          >
             <div className="p-1.5 rounded-full bg-white border border-slate-200 group-hover:border-science-200 group-hover:bg-science-50 transition-colors shadow-sm">
               <ArrowLeft size={16} />
             </div>
             <span className="font-medium text-sm">返回</span>
          </button>
        )}
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-500 text-sm">
            © {new Date().getFullYear()} SciTools Hub. Designed for Scientists.
          </p>
        </div>
      </footer>
    </div>
  );
};