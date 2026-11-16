import {useEffect, useState} from 'react';
import {Theme} from '@astryxdesign/core/theme';

import {themes, defaultThemeSlug} from '../astryx-themes';
import AIChatPage from './pages/AIChatPage';
import {loadSettings, saveSettings, type ThemeMode} from './chat/model';

export default function App() {
  const [mode, setMode] = useState<ThemeMode>(() => loadSettings().mode);

  useEffect(() => {
    saveSettings({...loadSettings(), mode});
  }, [mode]);

  return (
    <Theme theme={themes[defaultThemeSlug]} mode={mode}>
      <AIChatPage mode={mode} onModeChange={setMode} />
    </Theme>
  );
}
