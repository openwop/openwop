import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
// Side-effect import: initializes Firebase Auth (if configured) so the
// `onIdTokenChanged` subscriber populates the cached ID token before
// any fetch fires. No-op when Firebase env vars are unset.
import './auth/firebase.js';
import { getCurrentUser, getRedirectState } from './auth/firebase.js';
// Trigger lazy init synchronously at module load so the auth state
// settles before the first fetch.
void getCurrentUser();
// Kick off redirect-result processing at boot. The promise is
// memoized inside firebase.ts; components await the same one.
// Awaiting here pre-warms it so the redirect-back handler runs
// before the first paint that might depend on its outcome.
void getRedirectState();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Mount point #root not found in index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
