import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthProvider} from './lib/AuthContext';
import {ErrorBoundary} from './components/ErrorBoundary';
import {UpdateNotifier} from './components/UpdateNotifier';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* ErrorBoundaryの外に置き、エラー画面でも新しいバージョンの通知が出るようにする */}
    <UpdateNotifier />
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
