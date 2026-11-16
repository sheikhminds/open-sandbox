import {Theme} from '@astryxdesign/core/theme';

import {themes, defaultThemeSlug} from '../astryx-themes';
import AIChatPage from './pages/AIChatPage';

export default function App() {
  return (
    <Theme theme={themes[defaultThemeSlug]}>
      <AIChatPage />
    </Theme>
  );
}
