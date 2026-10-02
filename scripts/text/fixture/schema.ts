import { createDocument, BASIC_PARAGRAPH_ID } from '@galley/model';
import { createColorResolver } from '../../../packages/render/src/color';
import { createTextSchema } from '../../../packages/render/src/text/schema';
import { STYLES } from './styles';
export const doc = createDocument({ engineVersion: '44.5.1' });
for (const s of Object.values(STYLES)) doc.paragraphStyles[s.id] = {
 id:s.id,name:s.label,basedOn:BASIC_PARAGRAPH_ID,
 shared:{fontFamily:'Inter',fontWeight:s.weight,fontStyle:s.italic?'italic':'normal'},
 print:{fontSize:s.font,leading:s.leading,firstLineIndent:s.indent,spaceBefore:s.before,spaceAfter:s.after,align:s.align}, web:{}
};
export const schema = createTextSchema(doc, createColorResolver(doc,'screen'));
