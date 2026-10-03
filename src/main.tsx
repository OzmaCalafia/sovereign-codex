// App entry: offline fonts, persistent-storage request, React mount.
import React from 'react';
import ReactDOM from 'react-dom/client';

// Native offline font bundles
import '@fontsource/ubuntu/300.css';
import '@fontsource/ubuntu/400.css';
import '@fontsource/ubuntu/500.css';
import '@fontsource/ubuntu/700.css';

import App from './App.tsx';
import './index.css';

// Request permission to protect local IndexedDB from mobile OS storage eviction
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((persistent) => {
    if (persistent) {
      console.log("[STORAGE] Persistent local storage granted.");
    } else {
      console.warn("[STORAGE] Storage is temporary. May be evicted under disk pressure.");
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
