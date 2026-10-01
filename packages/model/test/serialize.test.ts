import { describe, expect, it } from 'vitest';
import {
  canonicalStringify,
  createStory,
  FORMAT_VERSION,
  migrations,
  parseDocument,
  serializeDocument,
  DocumentParseError,
} from '../src';
import { baseDoc, imageAsset, rectFrame } from './helpers';

function docWithAssets() {
  const doc = baseDoc();
  doc.assets.ast_1 = imageAsset('ast_1', { path: 'assets/photo.jpg' });
  doc.stories.sty_1 = createStory('sty_1', 'Hello');
  doc.frames = {
    r1: rectFrame('r1'),
    t1: { id: 't1', type: 'text', name: '', layerId: 'layer_1', x: 36, y: 36, w: 200, h: 100, rotation: 0, fill: null, stroke: null, storyId: 'sty_1', inset: 0 },
    i1: { id: 'i1', type: 'image', name: '', layerId: 'layer_1', x: 0, y: 0, w: 300, h: 200, rotation: 15, fill: null, stroke: null, assetId: 'ast_1', content: { x: -10, y: 0, w: 320, h: 213.3 } },
  };
  doc.pages.page_1!.items = ['r1', 't1', 'i1'];
  return doc;
}

describe('serialization', () => {
  it('serialize then parse deep-equals the document', () => {
    const doc = docWithAssets();
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  });

  it('writes formatVersion 1 and the engine version, and splits asset links into links.json', () => {
    const files = serializeDocument(docWithAssets());
    const document = JSON.parse(files.document);
    const links = JSON.parse(files.links);
    expect(document.formatVersion).toBe(1);
    expect(FORMAT_VERSION).toBe(1);
    expect(document.meta.engineVersion).toBe('44.5.1');
    expect(document.assets.ast_1).toEqual({ id: 'ast_1', kind: 'image', width: 3000, height: 2000, ppi: 300, colorSpace: 'rgb' });
    expect(links).toEqual({ formatVersion: 1, links: { ast_1: { path: 'assets/photo.jpg', hash: `sha256:${'a'.repeat(64)}` } } });
  });

  it('stamps the running engine version on save without touching the document', () => {
    const doc = docWithAssets();
    const files = serializeDocument(doc, { engineVersion: '45.0.0' });
    expect(JSON.parse(files.document).meta.engineVersion).toBe('45.0.0');
    expect(doc.meta.engineVersion).toBe('44.5.1');
    expect(parseDocument(files).meta.engineVersion).toBe('45.0.0');
  });

  it('is canonical: key insertion order does not change the bytes', () => {
    const a = docWithAssets();
    const b = JSON.parse(JSON.stringify(a));
    // rebuild b with reversed key order at every level
    const reverse = (v: any): any => (Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverse(v[k])])) : v);
    expect(serializeDocument(reverse(b))).toEqual(serializeDocument(a));
    expect(serializeDocument(a).document.endsWith('}\n')).toBe(true);
  });

  it('canonicalStringify sorts keys but keeps array order', () => {
    expect(canonicalStringify({ b: [3, 1, 2], a: { d: 1, c: 2 } })).toBe('{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": [\n    3,\n    1,\n    2\n  ]\n}\n');
  });

  it('a document without images parses without a links file', () => {
    const doc = baseDoc();
    expect(parseDocument({ document: serializeDocument(doc).document })).toEqual(doc);
  });

  it('rejects bad JSON, a missing or newer formatVersion, and a non-object', () => {
    const good = serializeDocument(baseDoc());
    expect(() => parseDocument({ ...good, document: '{ nope' })).toThrow(/not valid JSON/);
    expect(() => parseDocument({ ...good, document: '[]' })).toThrow(/must be a JSON object/);
    const noVersion = JSON.parse(good.document);
    delete noVersion.formatVersion;
    expect(() => parseDocument({ ...good, document: JSON.stringify(noVersion) })).toThrow(/formatVersion/);
    const newer = JSON.parse(good.document);
    newer.formatVersion = 2;
    expect(() => parseDocument({ ...good, document: JSON.stringify(newer) })).toThrow(/newer version of Galley/);
    expect(() => parseDocument({ ...good, document: JSON.stringify(newer) })).toThrow(DocumentParseError);
  });

  it('has an empty migration table at v1 (lane T adds migrations[1] for formatVersion 2)', () => {
    expect(Object.keys(migrations)).toEqual([]);
  });
});
