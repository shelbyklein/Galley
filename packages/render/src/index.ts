// @galley/render: the shared page renderer. Imported by the editor canvas and by the hidden export page.
// Import '@galley/render/fonts' once per window to load the built-in Inter faces.
export { PageView, type AssetUrlFn, type PageViewProps } from './PageView';
export { createColorResolver, naiveCmykToRgb, type ColorMode, type ColorResolver, type ColorResolverOptions, type SoftProofFn } from './color';
export { defaultSoftProof, getSoftProofEpoch, getSoftProofSource, setSoftProofSource, subscribeSoftProof, type SoftProofSource } from './softproof';
export { bleedClipInsets, htmlFrameStyle, num, pt, sheetGeometry, type SheetGeometry } from './geometry';
export { bolder, loadPageResources, usedFontFaces, usedImageUrls } from './fontLoading';
export { collectPaintedColors, findNonSentinelColors, type PaintedColor } from './audit';
export { paragraphCss, paragraphLanguage, runCss, toCssText, type ParagraphCssOptions } from './styles/resolve';
