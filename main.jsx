import './storage-shim.js';
import { createRoot } from 'react-dom/client';
import Accretion from './Accretion.jsx';

createRoot(document.getElementById('root')).render(<Accretion />);

/* Register the service worker so the game opens with no network at all.
   Only works over https:// or http://localhost — not file://. */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
