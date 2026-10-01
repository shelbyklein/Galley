// PDF/X-4 plumbing: output intent, XMP, Info, document ID.
import { PDFContext, PDFDict, PDFHexString, PDFName, PDFString, PDFRef } from '@cantoo/pdf-lib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { N } from './pdfio.ts';

export interface OutputIntentSpec {
  profilePath: string;
  identifier: string; // OutputConditionIdentifier
  condition: string; // OutputCondition
  registry: string;
  info: string;
}

export function addOutputIntent(ctx: PDFContext, catalog: PDFDict, spec: OutputIntentSpec): PDFRef {
  const prof = ctx.flateStream(fs.readFileSync(spec.profilePath), { N: 4, Alternate: N('DeviceCMYK') });
  const profRef = ctx.register(prof);
  const oi = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    OutputConditionIdentifier: PDFString.of(spec.identifier),
    OutputCondition: PDFString.of(spec.condition),
    RegistryName: PDFString.of(spec.registry),
    Info: PDFString.of(spec.info),
    DestOutputProfile: profRef,
  });
  catalog.set(N('OutputIntents'), ctx.obj([ctx.register(oi)]));
  return profRef;
}

export const pdfDate = (d: Date) =>
  `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}+00'00'`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function makeXmp(o: { title: string; creatorTool: string; producer: string; created: Date; modified: Date; docId: string; instId: string }): string {
  const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, '+00:00');
  const body = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Galley">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(o.title)}</rdf:li></rdf:Alt></dc:title>
   <xmp:CreatorTool>${esc(o.creatorTool)}</xmp:CreatorTool>
   <xmp:CreateDate>${iso(o.created)}</xmp:CreateDate>
   <xmp:ModifyDate>${iso(o.modified)}</xmp:ModifyDate>
   <xmp:MetadataDate>${iso(o.modified)}</xmp:MetadataDate>
   <xmpMM:DocumentID>uuid:${o.docId}</xmpMM:DocumentID>
   <xmpMM:InstanceID>uuid:${o.instId}</xmpMM:InstanceID>
   <xmpMM:RenditionClass>default</xmpMM:RenditionClass>
   <xmpMM:VersionID>1</xmpMM:VersionID>
   <pdf:Producer>${esc(o.producer)}</pdf:Producer>
   <pdf:Trapped>False</pdf:Trapped>
   <pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  return body;
}

export function addMetadata(ctx: PDFContext, catalog: PDFDict, info: PDFDict, o: { title: string; creator: string; producer: string; created: Date; modified: Date }) {
  const docId = crypto.randomUUID();
  const instId = crypto.randomUUID();
  info.set(N('Title'), PDFString.of(o.title));
  info.set(N('Creator'), PDFString.of(o.creator));
  info.set(N('Producer'), PDFString.of(o.producer));
  info.set(N('CreationDate'), PDFString.of(pdfDate(o.created)));
  info.set(N('ModDate'), PDFString.of(pdfDate(o.modified)));
  info.set(N('GTS_PDFXVersion'), PDFString.of('PDF/X-4'));
  info.set(N('Trapped'), N('False'));
  const xmp = makeXmp({ title: o.title, creatorTool: o.creator, producer: o.producer, created: o.created, modified: o.modified, docId, instId });
  const xmpRef = ctx.register(ctx.stream(Buffer.from(xmp, 'utf8'), { Type: 'Metadata', Subtype: 'XML' }));
  catalog.set(N('Metadata'), xmpRef);
  // trailer /ID: two 16-byte strings
  const id1 = crypto.createHash('md5').update(docId).digest('hex');
  const id2 = crypto.createHash('md5').update(instId).digest('hex');
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id1), PDFHexString.of(id2)]);
  return { docId, instId, id: [id1, id2] };
}
