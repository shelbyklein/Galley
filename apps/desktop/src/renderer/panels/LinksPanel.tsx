import { effectiveImagePpi, setAssetProps, type Asset, type GalleyDocument } from '@galley/model';
import { useEffect, useRef, useState } from 'react';
import { bumpAssetGeneration } from '../../shared/assets';
import type { LinkStatus } from '../../shared/ipc';
import { selectDoc, useEditorStore } from '../store';
import { readableError } from '../shell/files/documentActions';
import { useShellStore } from '../shell/shellStore';
import { trimNumber } from '../shell/control-strip/units';
import { Panel } from './Panel';

export function imageUsages(doc: GalleyDocument, assetId: string) {
  return Object.values(doc.frames).filter((f) => f.type === 'image' && f.assetId === assetId);
}

export function LinksPanel() {
  const doc = useEditorStore(selectDoc);
  const generation = useEditorStore((s) => s.documentGeneration);
  const [statuses, setStatuses] = useState<LinkStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  const check = async () => {
    const serial = ++request.current;
    const state = useEditorStore.getState();
    const gen = state.documentGeneration;
    const assets = state.history.doc.assets;
    try {
      const found = await window.galley!.images.check(Object.values(assets));
      if (!alive.current || serial !== request.current || useEditorStore.getState().documentGeneration !== gen || useEditorStore.getState().history.doc.assets !== assets) return;
      bumpAssetGeneration();
      setStatuses(found);
      useShellStore.getState().setFileState({ missingLinks: found.filter((s) => s.status === 'missing' || s.status === 'unreadable').map(({ assetId, path }) => ({ assetId, path })), linkWarningDismissed: false });
    } catch (e) {
      if (alive.current && serial === request.current && useEditorStore.getState().documentGeneration === gen) setError(readableError(e));
    }
  };
  // Check on document/link edits (including undo); never poll or watch external files.
  useEffect(() => { setStatuses([]); setError(''); void check(); }, [doc.assets, generation]);
  const relink = async (asset: Asset) => {
    const gen = useEditorStore.getState().documentGeneration;
    setBusy(true); setError('');
    try {
      const replacement = await window.galley!.images.relink(asset);
      const state = useEditorStore.getState();
      if (!replacement || gen !== state.documentGeneration || state.history.doc.assets[asset.id] !== asset) return;
      state.dispatch(setAssetProps, { id: asset.id, props: replacement });
      await check();
    } catch (e) {
      if (alive.current && gen === useEditorStore.getState().documentGeneration) setError(readableError(e));
    } finally { if (alive.current) setBusy(false); }
  };
  const select = (frameId: string) => {
    const state = useEditorStore.getState();
    const contains = (id: string): boolean => id === frameId || (doc.frames[id]?.type === 'group' && doc.frames[id].childIds.some(contains));
    const page = Object.values(doc.pages).find((p) => p.items.some(contains));
    if (page) state.setCurrentPage(page.id);
    state.setSelection([frameId]);
  };
  return <Panel id="links" menu={[{ label: 'Check Packaged Links', onSelect: () => void check(), disabled: busy }]}>
    <p className="gl-panel-note">Package copies · originals are not watched</p>
    <div className="gl-links-actions"><button type="button" className="gl-input" onClick={() => void check()} disabled={busy}>Check Links</button></div>
    {Object.values(doc.assets).map((asset) => {
      const status = statuses.find((s) => s.assetId === asset.id);
      const usages = imageUsages(doc, asset.id);
      return <div className="gl-link-row" key={asset.id} data-asset-id={asset.id} data-status={status?.status ?? 'checking'}>
        <div className="gl-link-heading"><strong title={asset.path}>{asset.path.split('/').pop()}</strong><span className={`gl-link-status is-${status?.status}`}>{status ? ({ ok: 'OK', missing: 'Missing', changed: 'Changed', unreadable: 'Unreadable' } as const)[status.status] : 'Checking…'}</span></div>
        <p className="gl-link-path">{asset.path}</p>
        <p className="gl-link-detail">{asset.width} × {asset.height} px · Actual {trimNumber(asset.ppi, 1)} ppi</p>
        {usages.map((frame) => {
          const ppi = frame.type === 'image' ? effectiveImagePpi(asset, frame) : null;
          return <button type="button" key={frame.id} className="gl-link-usage" onClick={() => select(frame.id)} title="Select image frame">{frame.name || 'Image frame'} · Effective {ppi ? `${trimNumber(ppi.x, 1)} × ${trimNumber(ppi.y, 1)}` : '—'} ppi</button>;
        })}
        {!usages.length && <p className="gl-link-detail">No placed frames</p>}
        {status?.detail && <p className="gl-form-error">{status.detail}</p>}
        <button type="button" className="gl-input" onClick={() => void relink(asset)} disabled={busy}>Relink…</button>
      </div>;
    })}
    {!Object.keys(doc.assets).length && <p className="gl-panel-note">No linked images.</p>}
    {error && <p className="gl-form-error" role="alert" data-testid="links-error">{error}</p>}
  </Panel>;
}
