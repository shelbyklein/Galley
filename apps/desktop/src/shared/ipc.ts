// Types and channel names shared by the main process, the preload script and the renderer windows.
// Lane C owns the file, menu and window parts. Lanes A and B add their own sections (export, place image) below the
// marked blocks; the bridge is additive on purpose so the merge is a union.

/** The model's two files of a `.galley` package, as text. Parsing and validating them is @galley/model's job. */
export interface PackageFiles {
  document: string;
  /** Absent when the package has no links.json (a document without images). */
  links?: string;
}

// ------------------------------------------------------------------------------------------------ files (lane C)

/** An image link whose file is not where links.json says it is. The editor shows a placeholder and a warning. */
export interface MissingLink {
  assetId: string;
  /** Path relative to the package folder, as stored in links.json. */
  path: string;
}

/** A package read from disk: its files, where it lives, and which image links are broken. */
export interface OpenedPackage extends PackageFiles {
  /** Absolute path of the `X.galley` folder. */
  path: string;
  missingLinks: MissingLink[];
}

export interface RecentFile {
  /** Absolute path of the `X.galley` folder. */
  path: string;
  /** Display name: the folder name without `.galley`. */
  name: string;
}

export interface SaveRequest {
  files: PackageFiles;
  /** The `path` of every linked image (`doc.assets[*].path`): saving to a new place copies these files into the package. */
  assetPaths: string[];
  /** The `X.galley` folder to write (from `chooseSavePath` for Save As, or the open package for Save). */
  path: string;
}

export interface ChooseSavePathRequest {
  /** Default file name for the Save As panel, without extension. */
  suggestedName: string;
  /** The package the document was saved to before, so the panel opens in its folder. */
  currentPath: string | null;
}

export interface SaveResult {
  /** Absolute path of the package that was written. */
  path: string;
  missingLinks: MissingLink[];
  recents: RecentFile[];
}

export type ConfirmChoice = 'save' | 'discard' | 'cancel';

export interface ConfirmRequest {
  /** The document's name, for the message. */
  name: string;
  /** What the user is about to do: the message reads "... before closing / opening / creating". */
  action: 'closing' | 'opening' | 'creating' | 'quitting';
}

/** The state main needs for the window chrome and the close prompt. Pushed by the renderer whenever it changes. */
export interface DocumentState {
  dirty: boolean;
  title: string;
  /** The saved package, or null for a document that has never been saved. */
  path: string | null;
}

// ------------------------------------------------------------------------------------------------ menu (lane C)

/**
 * A native menu item, described by the renderer (which owns the command registry) and built by the main process.
 * Clicking an item with an `id` sends `{ id, payload }` back to the renderer, which runs the command.
 */
export interface MenuItemSpec {
  /** A command id (`file.save`), or a synthetic id for submenus. */
  id?: string;
  label?: string;
  type?: 'normal' | 'separator' | 'checkbox';
  /** An Electron accelerator. Only set for shortcuts that cannot clash with typing (a modifier, or a function key). */
  accelerator?: string;
  enabled?: boolean;
  checked?: boolean;
  /** Extra data sent back on click (the path of a recent file). */
  payload?: string;
  /** A native role (`minimize`, `toggleDevTools`, ...) for items the main process implements. */
  role?: string;
  submenu?: MenuItemSpec[];
}

export interface MenuCommandMessage {
  id: string;
  payload?: string;
}

/** Text-editing actions the renderer asks the main process to perform on the focused field (the Edit menu in a text box). */
export type TextEditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

// ----------------------------------------------------------------------------------------------------------- API

/** What the preload script exposes to renderer windows as `window.galley`. */
export interface GalleyApi {
  /** `process.versions.electron`: stamped into documents as `meta.engineVersion`. */
  engineVersion: string;
  /** True when the app was started by an e2e test (GALLEY_E2E=1): the renderer then exposes `window.__galley` for tests. */
  e2e: boolean;
  /**
   * The package to open at startup, from `--open <path>`, the GALLEY_OPEN environment variable (the e2e hook), or,
   * under `npm run dev`, fixtures/poster-basic.galley. Null for none.
   */
  getInitialDocument(): Promise<OpenedPackage | null>;

  /** File commands. The renderer parses and serializes documents; main does the dialogs and the disk. */
  files: {
    /** The Open panel. Reads the package but does not activate it. Resolves null when cancelled; rejects with a readable message for a folder that is not a package. */
    open(): Promise<OpenedPackage | null>;
    /** Read a known package (a recent file) without activating it. */
    openPath(path: string): Promise<OpenedPackage>;
    /** The renderer parsed a package and opened it: serve its images, and (unless `remember` is false, as for the startup document) list it as recent. Returns its broken links and the recents. */
    activate(path: string, options?: { remember?: boolean }): Promise<{ missingLinks: MissingLink[]; recents: RecentFile[] }>;
    /** The Save As panel. Resolves the chosen `X.galley` path (extension added), or null when cancelled. Writes nothing. */
    chooseSavePath(request: ChooseSavePathRequest): Promise<string | null>;
    /** Write the package (document.json, links.json, and the linked images when saving to a new place). */
    save(request: SaveRequest): Promise<SaveResult>;
    /** A new document has no package yet; images placed into it live in a scratch package until the first save. */
    newDocument(): Promise<void>;
    /** The Save / Don't Save / Cancel prompt. */
    confirmUnsaved(request: ConfirmRequest): Promise<ConfirmChoice>;
    recents(): Promise<RecentFile[]>;
    clearRecents(): Promise<RecentFile[]>;
    /** Close this window now (the renderer has already dealt with unsaved changes). */
    closeWindow(): Promise<void>;
    /** The user cancelled a close or quit that the window asked about. */
    cancelClose(): Promise<void>;
  };

  /** Window chrome: dirty dot, title, and whether closing needs a prompt. */
  setDocumentState(state: DocumentState): void;
  /** Replace the application menu. */
  setMenu(spec: MenuItemSpec[]): void;
  /** Run a text-editing action on the focused field (used when the Edit menu is clicked while typing in a field). */
  textEdit(action: TextEditAction): void;
  /** Called when a menu item is clicked. Returns an unsubscribe function. */
  onMenuCommand(listener: (message: MenuCommandMessage) => void): () => void;
  /** Called when the window is being closed (red button, Cmd-Q) while the document has unsaved changes. */
  onCloseRequested(listener: () => void): () => void;
  /** Tell main the renderer has booted and can receive menu commands. */
  shellReady(): void;
}

export const IPC = {
  getInitialDocument: 'galley:get-initial-document',
  // lane C: files
  filesOpen: 'galley:files-open',
  filesOpenPath: 'galley:files-open-path',
  filesActivate: 'galley:files-activate',
  filesChooseSavePath: 'galley:files-choose-save-path',
  filesSave: 'galley:files-save',
  filesNewDocument: 'galley:files-new-document',
  filesConfirmUnsaved: 'galley:files-confirm-unsaved',
  filesRecents: 'galley:files-recents',
  filesClearRecents: 'galley:files-clear-recents',
  filesCloseWindow: 'galley:files-close-window',
  filesCancelClose: 'galley:files-cancel-close',
  // lane C: window and menu
  setDocumentState: 'galley:set-document-state',
  setMenu: 'galley:set-menu',
  textEdit: 'galley:text-edit',
  menuCommand: 'galley:menu-command',
  closeRequested: 'galley:close-requested',
  shellReady: 'galley:shell-ready',
} as const;
