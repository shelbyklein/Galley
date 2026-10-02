/** Serializable font inventory shared across the main process, editor and exporter. */
export interface FontAxis { name: string; min: number; default: number; max: number }
export interface FontFaceInfo {
  styleName: string; weight: number; style: 'normal' | 'italic';
  format: 'truetype' | 'cff' | 'variable' | 'woff2';
  embeddable: boolean;
  id: string; path: string; faceIndex: number; family: string; postscriptName: string;
  source: 'bundled' | 'system' | 'document';
  axes: Record<string, FontAxis>; fsType: number; embeddingReason: string | null;
  outlines: 'truetype' | 'cff';
}
export interface FontFamilyInfo { family: string; faces: FontFaceInfo[]; source: FontFaceInfo['source'] }
export interface FontRequest { family: string; weight: number; style: 'normal' | 'italic' }
export interface FontBinding extends FontRequest {
  face: FontFaceInfo; url: string; missing: boolean; instanceAxes?: Record<string, number>;
  /** The established bundled CSS loads both source subsets in this order. */
  cssFiles?: string[];
}
export interface FontReportEntry extends FontRequest {
  resolvedFamily: string; styleName: string; source: FontFaceInfo['source']; path: string;
  fsType: number; status: 'truetype' | 'instanced' | 'type3' | 'substituted';
  resolvedWeight: number; cssFiles?: string[];
  warning: string | null;
}
export interface FontBridge {
  families(): Promise<FontFamilyInfo[]>;
  resolve(requests: FontRequest[]): Promise<FontBinding[]>;
}
