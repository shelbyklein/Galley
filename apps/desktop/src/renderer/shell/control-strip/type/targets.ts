import type { CaretFormatting } from './typeStore';
import { useShellStore } from '../../shellStore';
import { applyCharacterStyle, applyParagraphStyle, CHARACTER_PROPS, clearTextOverrides, paragraphAttrs, paragraphText, resolveParagraph, resolveRun, runMarks, setTextOverrides, wholeStory, type CharacterOverrides, type ParagraphOverrides, type PMNode, type StoryPoint, type StoryRange, type StyleKind } from '@galley/model';
import { useEditorStore, type EditorState } from '../../../store';

/** PM block opening/closing tokens count as positions; model formatting ranges count only paragraph text. */
export function storyPointAt(doc: PMNode, pos: number): StoryPoint {
  let start = 1;
  const paragraphs = doc.content ?? [];
  for (let i = 0; i < paragraphs.length; i++) {
    const length = paragraphText(paragraphs[i]!).length;
    if (pos <= start + length || i === paragraphs.length - 1) return { paragraph: i, offset: Math.max(0, Math.min(length, pos - start)) };
    start += length + 2;
  }
  return { paragraph: 0, offset: 0 };
}
export function textTargets(state: Pick<EditorState, 'history' | 'selection' | 'textSelection'>): { storyId: string; range: StoryRange }[] {
  const doc = state.history.doc;
  const sel = state.textSelection;
  if (sel && doc.stories[sel.storyId]) {
    const story = doc.stories[sel.storyId]!;
    return [{ storyId: sel.storyId, range: { from: storyPointAt(story.doc, Math.min(sel.anchor, sel.head)), to: storyPointAt(story.doc, Math.max(sel.anchor, sel.head)) } }];
  }
  const stories = new Set<string>();
  const visit = (id: string) => {
    const frame = doc.frames[id];
    if (frame?.type === 'text') stories.add(frame.storyId);
    else if (frame?.type === 'group') frame.childIds.forEach(visit);
  };
  state.selection.forEach(visit);
  return [...stories].map((storyId) => ({ storyId, range: wholeStory(doc.stories[storyId]!.doc) }));
}
export function textContext(state: EditorState, caret: CaretFormatting | null = null) {
  const targets = textTargets(state);
  const target = targets[0];
  if (!target) return null;
  const doc = state.history.doc;
  const p = doc.stories[target.storyId]!.doc.content![target.range.from.paragraph]!;
  const attrs = paragraphAttrs(p);
  const paragraph = resolveParagraph(doc, attrs);
  let offset = 0;
  const run = (p.content ?? []).find((t) => { const end = offset + (t.text?.length ?? 0); const here = target.range.from.offset < end; offset = end; return here; }) ?? p.content?.at(-1);
  const pending = caret && state.textSelection?.anchor === state.textSelection?.head && caret.storyId === target.storyId && caret.position === state.textSelection?.head ? caret.marks : null;
  const effectiveMarks = pending ?? run?.marks;
  const marks = runMarks(effectiveMarks);
  const overridden = !!marks.overrides || targets.some((t) => doc.stories[t.storyId]!.doc.content!.slice(t.range.from.paragraph, t.range.to.paragraph + 1).some((node) => {
    if (Object.keys(paragraphAttrs(node).overrides ?? {}).length) return true;
    return (node.content ?? []).some((r) => !!runMarks(r.marks).overrides);
  }));
  return { targets, attrs, paragraph, run: resolveRun(doc, paragraph, effectiveMarks), characterStyle: marks.style ?? 'none', overridden };
}
function formatEach(label: string, apply: (storyId: string, range: StoryRange) => void): void {
  const state = useEditorStore.getState();
  const targets = textTargets(state);
  if (!targets.length) return;
  state.beginTransaction(label);
  try { targets.forEach((t) => apply(t.storyId, t.range)); state.commitTransaction(); }
  catch (e) { useEditorStore.getState().cancelTransaction(); throw e; }
}
export function caretFormat(detail: { kind: 'style'; styleId: string | null; handled: boolean } | { kind: 'overrides'; patch: { set?: CharacterOverrides; unset?: Partial<Record<'shared' | 'print' | 'web', readonly string[]>> }; handled: boolean }): boolean {
  const sel = useEditorStore.getState().textSelection;
  if (!sel || sel.anchor !== sel.head) return false;
  window.dispatchEvent(new CustomEvent('galley:caret-format', { detail }));
  if (!detail.handled) useShellStore.getState().pushNotice({ level: 'info', text: 'Select text to format characters.' });
  return true;
}
export function applyTextStyle(kind: StyleKind, styleId: string): void {
  if (kind === 'character' && caretFormat({ kind: 'style', styleId, handled: false })) return;
  formatEach('Apply Style', (storyId, range) => {
    if (kind === 'paragraph') useEditorStore.getState().dispatch(applyParagraphStyle, { storyId, range, styleId });
    else useEditorStore.getState().dispatch(applyCharacterStyle, { storyId, range, styleId });
  });
}
export function overrideText(target: 'paragraph' | 'character', set: ParagraphOverrides | CharacterOverrides): void {
  if (target === 'character' && caretFormat({ kind: 'overrides', patch: { set: set as CharacterOverrides }, handled: false })) return;
  formatEach('Change Text Formatting', (storyId, range) => {
    if (target === 'paragraph') useEditorStore.getState().dispatch(setTextOverrides, { storyId, range, target, patch: { set: set as ParagraphOverrides } });
    else useEditorStore.getState().dispatch(setTextOverrides, { storyId, range, target, patch: { set: set as CharacterOverrides } });
  });
}
export function clearOverrides(scope: 'paragraph' | 'character' | 'all' = 'all'): void {
  const atCaret = scope !== 'paragraph' && caretFormat({ kind: 'overrides', patch: { unset: { shared: CHARACTER_PROPS.shared, print: CHARACTER_PROPS.print } }, handled: false });
  if (atCaret && scope === 'character') return;
  formatEach('Clear Overrides', (storyId, range) => useEditorStore.getState().dispatch(clearTextOverrides, { storyId, range, scope }));
}
