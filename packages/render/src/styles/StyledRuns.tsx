import { resolveRun, type PMNode, type ResolvedParagraph, type StyleTables } from '@galley/model';
import type { ColorResolver } from '../color';
import { dropCapCss, splitDropCapRuns } from './dropcaps';
import { runCss } from './resolve';
/** The same marked runs as the normal paragraph, with a display-only initial group for multi-character drop caps. */
export function StyledRuns({ runs, paragraph, tables, colors }: { runs: readonly PMNode[]; paragraph: ResolvedParagraph; tables: StyleTables; colors: ColorResolver }) {
  const draw = (nodes: readonly PMNode[], initial = false) => nodes.map((t, j) => {
    const resolved = resolveRun(tables, paragraph, t.marks);
    const css = runCss(paragraph, resolved, colors);
    if (initial) { delete css.fontSize; delete css.lineHeight; delete css.verticalAlign; }
    return <span key={j} lang={resolved.language !== paragraph.language ? resolved.language : undefined} style={Object.keys(css).length ? css : undefined}>{t.text ?? ''}</span>;
  });
  if (!runs.length) return <br />;
  if (paragraph.dropCapLines <= 0 || paragraph.dropCapChars <= 1) return <>{draw(runs)}</>;
  const { initial, rest } = splitDropCapRuns(runs, paragraph.dropCapChars);
  return <><span data-drop-cap={paragraph.dropCapChars} style={dropCapCss(paragraph)}>{draw(initial, true)}</span>{draw(rest)}</>;
}
