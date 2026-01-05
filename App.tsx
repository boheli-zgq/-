import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './features/Dashboard';
import { QpcrTool } from './features/qpcr/QpcrTool';

function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'qpcr'>('dashboard');

  return (
    <Layout onGoHome={() => setCurrentView('dashboard')}>
      {currentView === 'dashboard' ? (
        <Dashboard onSelectTool={(id) => setCurrentView(id as any)} />
      ) : (
        <QpcrTool />
      )}
    </Layout>
  );
}

export default App;