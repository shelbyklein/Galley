/**
 * Shell UI state: what the shell and its panels need that is not the document and not shared with other lanes.
 * Owned by lane C. Kept apart from the editor store on purpose (that one is shared and holds the model, selection,
 * viewport and tool): nothing here is in the undo history, and nothing here is saved in a document.
 *
 *   panels        which docked panels are shown and which are collapsed (remembered between runs)
 *   proxy         whether swatches apply to the fill or the stroke (the fill/stroke proxy in the Tools column)
 *   control strip the reference point, linked proportions, the last chosen fitting
 *   file          the open package, its broken image links, recent files
 *   notices       errors and warnings shown over the canvas
 *   dialog        the one open modal dialog
 */
import type { Id } from '@galley/model';
import { create } from 'zustand';
import type { MissingLink, RecentFile } from '../../shared/ipc';
import type { NewDocumentSpec } from '../dialogs/presets';
import { REF_TOP_LEFT, type RefPoint } from './control-strip/transform';

export type PanelId = 'pages' | 'layers' | 'swatches' | 'paragraphStyles' | 'characterStyles' | 'textWrap' | 'imageContent' | 'links';
export const PANEL_IDS: readonly PanelId[] = ['pages', 'layers', 'swatches', 'paragraphStyles', 'characterStyles','textWrap', 'imageContent', 'links'];
export const PANEL_TITLES: Record<PanelId, string> = { pages: 'Pages', layers: 'Layers', swatches: 'Swatches', paragraphStyles: 'Paragraph Styles', characterStyles: 'Character Styles',textWrap:'Text Wrap', imageContent: 'Image Content', links: 'Links' };

export interface PanelState {
  visible: boolean;
  collapsed: boolean;
}

export type ProxyTarget = 'fill' | 'stroke';

export interface Notice {
  id: string;
  level: 'error' | 'warning' | 'info';
  text: string;
  detail?: string;
}

export type DialogRequest =
  | { kind: 'newDocument'; resolve: (spec: NewDocumentSpec | null) => void }
  /** `swatchId: null` makes a new swatch; an id edits that swatch. */
  | { kind: 'swatch'; swatchId: Id | null };

export interface ShellState {
  panels: Record<PanelId, PanelState>;
  setPanel(id: PanelId, patch: Partial<PanelState>): void;
  togglePanelVisible(id: PanelId): void;

  proxyTarget: ProxyTarget;
  setProxyTarget(target: ProxyTarget): void;

  refPoint: RefPoint;
  setRefPoint(ref: RefPoint): void;
  proportionsLinked: boolean;
  setProportionsLinked(linked: boolean): void;
  /** The fitting last chosen from the control strip's dropdown (display only). */
  lastFitting: string | null;
  setLastFitting(label: string | null): void;

  /** The Swatches panel's tint field, and the swatch it highlights (`null` is [None]). */
  tint: number;
  setTint(tint: number): void;
  selectedSwatchId: Id | null;
  setSelectedSwatch(id: Id | null): void;

  packagePath: string | null;
  missingLinks: MissingLink[];
  linkWarningDismissed: boolean;
  recents: RecentFile[];
  setFileState(patch: Partial<Pick<ShellState, 'packagePath' | 'missingLinks' | 'linkWarningDismissed' | 'recents'>>): void;

  notices: Notice[];
  pushNotice(notice: Omit<Notice, 'id'>): string;
  dismissNotice(id: string): void;

  dialog: DialogRequest | null;
  openDialog(dialog: DialogRequest): void;
  closeDialog(): void;
}

const STORAGE_KEY = 'galley.shell.panels';
const DEFAULT_PANELS: Record<PanelId, PanelState> = {
  pages: { visible: true, collapsed: false },
  layers: { visible: true, collapsed: false },
  swatches: { visible: true, collapsed: false },
  paragraphStyles: { visible: false, collapsed: false },
  characterStyles: { visible: false, collapsed: false },
  textWrap: {visible:false,collapsed:false},
  imageContent: { visible: false, collapsed: false },
  links: { visible: false, collapsed: false },
};

function loadPanels(): Record<PanelId, PanelState> {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null') as Partial<Record<PanelId, Partial<PanelState>>> | null;
    if (!raw) return structuredClone(DEFAULT_PANELS);
    const out = structuredClone(DEFAULT_PANELS);
    for (const id of PANEL_IDS) {
      if (typeof raw[id]?.visible === 'boolean') out[id].visible = raw[id]!.visible!;
      if (typeof raw[id]?.collapsed === 'boolean') out[id].collapsed = raw[id]!.collapsed!;
    }
    return out;
  } catch {
    return structuredClone(DEFAULT_PANELS);
  }
}

function savePanels(panels: Record<PanelId, PanelState>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(panels));
  } catch {
    /* storage can be unavailable; the layout just is not remembered */
  }
}

let noticeCounter = 0;

export const useShellStore = create<ShellState>()((set, get) => ({
  panels: loadPanels(),
  setPanel: (id, patch) => {
    const panels = { ...get().panels, [id]: { ...get().panels[id], ...patch } };
    set({ panels });
    savePanels(panels);
  },
  togglePanelVisible: (id) => get().setPanel(id, { visible: !get().panels[id].visible }),

  proxyTarget: 'fill',
  setProxyTarget: (proxyTarget) => set({ proxyTarget }),

  refPoint: REF_TOP_LEFT,
  setRefPoint: (refPoint) => set({ refPoint }),
  proportionsLinked: false,
  setProportionsLinked: (proportionsLinked) => set({ proportionsLinked }),
  lastFitting: null,
  setLastFitting: (lastFitting) => set({ lastFitting }),

  tint: 100,
  setTint: (tint) => set({ tint: Math.min(100, Math.max(0, tint)) }),
  selectedSwatchId: null,
  setSelectedSwatch: (selectedSwatchId) => set({ selectedSwatchId }),

  packagePath: null,
  missingLinks: [],
  linkWarningDismissed: false,
  recents: [],
  setFileState: (patch) => set(patch),

  notices: [],
  pushNotice: (notice) => {
    const id = `notice-${++noticeCounter}`;
    set((s) => ({ notices: [...s.notices, { ...notice, id }] }));
    return id;
  },
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}));
