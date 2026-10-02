/**
 * Serialization of a document to its on-disk form and back.
 *
 * A `.galley` package holds two JSON files for the model (the folder layout, assets/ and fonts/ are lane C's job):
 *
 *   document.json   the model, with `formatVersion` and `meta.engineVersion`. Assets appear here by id with their
 *                   intrinsic data only (pixel size, ppi, color space).
 *   links.json      `{ formatVersion, links: { <assetId>: { path, hash } } }`: where each linked image lives
 *                   (relative path) and its content hash, so a missing or modified file can be detected without
 *                   touching document.json.
 *
 * Output is canonical: object keys sorted, two-space indent, trailing newline. The same document always serializes to
 * the same bytes, regardless of the order keys were inserted, so files diff cleanly and "undo restores the document
 * byte for byte" can be asserted on the serialized text (compare `serializeDocument(doc).document`, not
 * `JSON.stringify(doc)`, whose key order depends on edit history).
 */
import { z } from 'zod';
import { idSchema } from './ids';
import {
  assetIntrinsicSchema,
  assetLinkSchema,
  documentSchema,
  FORMAT_VERSION,
  type GalleyDocument,
} from './schema';
import { validateDocument, type ValidationIssue } from './validate';
import { MigrationError, migrateV1ToV2 } from './migrate/v1';

export interface DocumentFiles {
  /** Contents of document.json. */
  document: string;
  /** Contents of links.json. */
  links: string;
}

export class DocumentParseError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(issues.length > 0 ? `${message}: ${issues.slice(0, 5).join('; ')}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ''}` : message);
    this.name = 'DocumentParseError';
  }
}

/** JSON with sorted object keys, 2-space indent and a trailing newline. */
export function canonicalStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + '\n';
}

export interface SerializeOptions {
  /** Stamp `meta.engineVersion` with the running engine (pass `process.versions.electron` when saving). */
  engineVersion?: string;
}

export function serializeDocument(doc: GalleyDocument, options: SerializeOptions = {}): DocumentFiles {
  const assets: Record<string, unknown> = {};
  const links: Record<string, unknown> = {};
  for (const asset of Object.values(doc.assets)) {
    const { path, hash, ...intrinsic } = asset;
    assets[asset.id] = intrinsic;
    links[asset.id] = { path, hash };
  }
  const meta = options.engineVersion ? { ...doc.meta, engineVersion: options.engineVersion } : doc.meta;
  return {
    document: canonicalStringify({ ...doc, meta, assets }),
    links: canonicalStringify({ formatVersion: FORMAT_VERSION, links }),
  };
}

// ----------------------------------------------------------------------------------------------------- migrations

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Upgrade steps for document.json, keyed by the version they upgrade from: `migrations[1]` turns a v1 raw document into v2
 * (./migrate/v1.ts). Each step takes and returns the raw parsed JSON, before schema validation, and sets `formatVersion`.
 * `parseDocument` applies them in order until the document is current, so a v1 package opens like any other.
 */
export const migrations: Record<number, Migration> = { 1: migrateV1ToV2 };

/** The same for links.json, whose content did not change between v1 and v2: only the version moves. */
const linkMigrations: Record<number, Migration> = { 1: (raw) => ({ ...raw, formatVersion: 2 }) };

function migrateRaw(raw: Record<string, unknown>, what: string, steps: Record<number, Migration>): Record<string, unknown> {
  const declared = raw.formatVersion;
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1) {
    throw new DocumentParseError(`${what} has no valid formatVersion`);
  }
  let version: number = declared;
  if (version > FORMAT_VERSION) {
    throw new DocumentParseError(`${what} was saved by a newer version of Galley (formatVersion ${version}; this build reads up to ${FORMAT_VERSION})`);
  }
  let out = raw;
  while (version < FORMAT_VERSION) {
    const step = steps[version];
    if (!step) throw new DocumentParseError(`No migration from formatVersion ${version}`);
    try {
      out = step(out);
    } catch (e) {
      if (e instanceof MigrationError) throw new DocumentParseError(`${what} could not be upgraded from formatVersion ${version}`, [e.message]);
      throw e;
    }
    version = out.formatVersion as number;
  }
  return out;
}

const linksFileSchema = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION),
  links: z.record(idSchema, assetLinkSchema),
});

function parseJson(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new DocumentParseError(`${what} is not valid JSON (${(e as Error).message})`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DocumentParseError(`${what} must be a JSON object`);
  return value as Record<string, unknown>;
}

const formatIssues = (error: z.ZodError): string[] => error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
const formatValidation = (issues: ValidationIssue[]): string[] => issues.map((i) => `${i.path}: ${i.message}`);

/**
 * Parse and validate a document from its files. Throws `DocumentParseError` with the problems listed: bad JSON, a newer
 * format, a value the schema rejects (a unit string, a negative size, ...), or a dangling id. `links` may be omitted
 * for a document without images.
 */
export function parseDocument(files: { document: string; links?: string }): GalleyDocument {
  const rawDoc = migrateRaw(parseJson(files.document, 'document.json'), 'document.json', migrations);
  const rawLinks = files.links === undefined ? { formatVersion: FORMAT_VERSION, links: {} } : migrateRaw(parseJson(files.links, 'links.json'), 'links.json', linkMigrations);

  const linksResult = linksFileSchema.safeParse(rawLinks);
  if (!linksResult.success) throw new DocumentParseError('links.json is invalid', formatIssues(linksResult.error));
  const links = linksResult.data.links;

  const rawAssets = rawDoc.assets;
  const assets: Record<string, unknown> = {};
  if (rawAssets && typeof rawAssets === 'object' && !Array.isArray(rawAssets)) {
    for (const [id, intrinsic] of Object.entries(rawAssets as Record<string, unknown>)) {
      const parsed = assetIntrinsicSchema.safeParse(intrinsic);
      if (!parsed.success) throw new DocumentParseError(`asset "${id}" is invalid`, formatIssues(parsed.error));
      const link = links[id];
      if (!link) throw new DocumentParseError(`asset "${id}" has no entry in links.json`);
      assets[id] = { ...parsed.data, ...link };
    }
    for (const id of Object.keys(links)) {
      if (!(id in assets)) throw new DocumentParseError(`links.json refers to unknown asset "${id}"`);
    }
  }

  const result = documentSchema.safeParse({ ...rawDoc, assets: rawAssets === undefined ? undefined : assets });
  if (!result.success) throw new DocumentParseError('document.json is invalid', formatIssues(result.error));
  const issues = validateDocument(result.data);
  if (issues.length > 0) throw new DocumentParseError('document.json is inconsistent', formatValidation(issues));
  return result.data;
}
