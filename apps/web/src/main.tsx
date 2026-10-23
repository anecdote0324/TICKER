import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/600.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installFonts } from './fonts';
import { connectFeed } from './stores/feed';
import { loadCapabilities, loadInstruments } from './stores/instruments';
import { loadSettings } from './stores/settings';
import { loadAppState } from './stores/state';

async function boot() {
  installFonts();
  const root = createRoot(document.getElementById('root')!);
  // 설정과 저장된 배치를 먼저 읽어야 화면을 복원할 수 있어요. 종목 목록은 기다리지 않아요
  await Promise.all([loadSettings(), loadAppState(), loadCapabilities()]);
  connectFeed();
  void loadInstruments();
  root.render(<App />);
}

void boot();
