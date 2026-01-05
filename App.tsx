import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './features/Dashboard';
import { QpcrTool } from './features/qpcr/QpcrTool';
import { MolarityTool } from './features/molarity/MolarityTool';

function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'qpcr' | 'molarity'>('dashboard');

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
    </Layout>
  );
}

export default App;