import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppProviders } from './app/providers.js';
import { AppRouter } from './app/router.js';
import { captureInstallPrompt } from './lib/pwa.js';
import './styles/tokens.css';

/**
 * Punkt wejścia aplikacji webowej.
 *
 * Motyw ciemny jest domyślny (`06 §1.5`) — klasa `.dark` siedzi na `<html>` już
 * w `index.html`, przed pierwszym renderem, żeby nie mignęło jasne tło.
 */
const container = document.getElementById('root');
if (!container) {
  throw new Error('Brak elementu #root w index.html');
}

captureInstallPrompt();

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </StrictMode>,
);
