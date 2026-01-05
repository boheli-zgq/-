import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './features/Dashboard';
import { QpcrTool } from './features/qpcr/QpcrTool';
import { MolarityTool } from './features/molarity/MolarityTool';
import { WesternTool } from './features/western/WesternTool';

function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'qpcr' | 'molarity' | 'western'>('dashboard');

  return (
    <Layout onGoHome={() => setCurrentView('dashboard')}>
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
    </Layout>
  );
}

export default App;