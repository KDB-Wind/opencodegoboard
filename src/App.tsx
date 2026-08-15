import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/Loading';
import { useFeatureFlags } from './components/FeatureFlagsProvider';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const TokenStats = lazy(() => import('./pages/TokenStats').then((m) => ({ default: m.TokenStats })));
const UsageRecords = lazy(() => import('./pages/UsageRecords').then((m) => ({ default: m.UsageRecords })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));

function AppRoutes() {
  const { flags } = useFeatureFlags();
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route
          path="/tokens"
          element={flags.token_stats ? <TokenStats /> : <Navigate to="/" replace />}
        />
        <Route
          path="/records"
          element={flags.usage_records ? <UsageRecords /> : <Navigate to="/" replace />}
        />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <HashRouter>
      <Suspense fallback={<Loading />}>
        <AppRoutes />
      </Suspense>
    </HashRouter>
  );
}

export default App;
