/**
 * The fonts the editor can offer: the Font family and style menus, and missing-font checks.
 *
 * This file is the contract between lane N, which implements it (system, document and bundled fonts, via @galley/fonts
 * in the main process), and lane S, whose type controls read it. Lane N replaces the bodies and keeps these exports and
 * their shapes, adding to them if it needs more. Until lane N lands, only the bundled Inter faces are listed (see
 * packages/render/src/fonts.ts).
 */

export interface FontFaceInfo {
  /** The style name shown in the style menu: `Regular`, `Bold Italic`, `Extra Bold`. */
  styleName: string;
  /** CSS weight, 100–900. */
  weight: number;
  style: 'normal' | 'italic';
  /** How the face is stored, which decides how it embeds in a PDF (CFF and variable fonts come out as Type 3). */
  format: 'truetype' | 'cff' | 'variable' | 'woff2';
  /** False when the font's license (OS/2 fsType) forbids embedding it in a PDF. */
  embeddable: boolean;
}

export interface FontFamilyInfo {
  family: string;
  faces: FontFaceInfo[];
  /** Bundled with Galley, installed on this Mac, or in the document's `fonts/` folder. */
  source: 'bundled' | 'system' | 'document';
}

const face = (styleName: string, weight: number, style: FontFaceInfo['style'] = 'normal'): FontFaceInfo => ({
  styleName,
  weight,
  style,
  format: 'woff2',
  embeddable: true,
});

const BUNDLED: readonly FontFamilyInfo[] = [
  {
    family: 'Inter',
    source: 'bundled',
    faces: [face('Regular', 400), face('Italic', 400, 'italic'), face('Bold', 700), face('Bold Italic', 700, 'italic'), face('Extra Bold', 800), face('Black', 900)],
  },
];

/** Every family the editor can offer, sorted by name. */
export function getFontFamilies(): readonly FontFamilyInfo[] {
  return BUNDLED;
}

/** React hook form of `getFontFamilies`; re-renders when the list changes (lane N: after a scan). */
export function useFontFamilies(): readonly FontFamilyInfo[] {
  return BUNDLED;
}
