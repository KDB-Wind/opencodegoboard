import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/Loading';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const TokenStats = lazy(() => import('./pages/TokenStats').then((m) => ({ default: m.TokenStats })));
const UsageRecords = lazy(() => import('./pages/UsageRecords').then((m) => ({ default: m.UsageRecords })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));

function App() {
  return (
    <HashRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tokens" element={<TokenStats />} />
            <Route path="/records" element={<UsageRecords />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}

export default App;
