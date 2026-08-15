import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/i18n';
import App from './App';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './components/ThemeProvider';
import { FeatureFlagsProvider } from './components/FeatureFlagsProvider';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <FeatureFlagsProvider>
          <App />
        </FeatureFlagsProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);
