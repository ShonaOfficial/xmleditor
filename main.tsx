import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';
import { notifyPWANeedRefresh, setPWAUpdateHandler } from './hooks/usePWA.ts';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    notifyPWANeedRefresh(true);
  },
  onOfflineReady() {
    notifyPWANeedRefresh(false);
  },
});

setPWAUpdateHandler(updateSW);

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
