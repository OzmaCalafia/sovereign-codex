// App entry: offline fonts, persistent-storage request, React mount.
import React from 'react';
import ReactDOM from 'react-dom/client';

// Native offline font bundles
import '@fontsource/ubuntu/400.css';
import '@fontsource/ubuntu/700.css';

import App from './App.tsx';
import './index.css';

// Request permission to protect local IndexedDB from mobile OS storage eviction
navigator.storage?.persist?.();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
