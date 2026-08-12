import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './lib/store.jsx';
import { App } from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline not available */ });
  });
}
