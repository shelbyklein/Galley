/**
 * Built-in fonts: Inter (SIL Open Font License, from @fontsource/inter, whose LICENSE ships in node_modules). The
 * editor and the export page both import this module so they load the same files. Static weights only, so printed
 * text embeds as real TrueType and not Type 3 (see spikes/press/FINDINGS.md, caveat 1). The app's font manager
 * adds system and document fonts through setFontSource; these Inter rules also serve standalone render fixtures.
 */
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-400-italic.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-700-italic.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/inter/latin-900.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-400-italic.css';
import '@fontsource/inter/latin-ext-700.css';
import '@fontsource/inter/latin-ext-700-italic.css';
import '@fontsource/inter/latin-ext-800.css';
import '@fontsource/inter/latin-ext-900.css';

export const BUILTIN_FONT_FAMILY = 'Inter';

export { setFontSource, invalidateFonts, getFontEpoch, subscribeFonts, isMissingFont, parseFontRequest } from './fontRuntime';
import './fontRuntime.css';
