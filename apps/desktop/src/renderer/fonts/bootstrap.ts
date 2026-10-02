import { invalidateFonts, setFontSource } from '@galley/render/fonts';
import { useShellStore } from '../shell/shellStore';
import { refreshFontFamilies } from './index';
const bridge = window.galley?.fonts;
if (bridge) {
  setFontSource(async (requests) => { await refreshFontFamilies(); return bridge.resolve(requests); });
  let previous = useShellStore.getState().packagePath;
  useShellStore.subscribe((state) => {
    if (state.packagePath === previous) return;
    previous = state.packagePath;
    // Mark the page's existing font resources stale before any asynchronous inventory request.
    invalidateFonts();
    void refreshFontFamilies();
  });
}
