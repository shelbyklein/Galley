/** True when the keyboard belongs to a text field or an editable region, so object shortcuts must leave it alone. */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const html = el as HTMLElement;
  if (html.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export const isTypingNow = (): boolean => isEditableElement(document.activeElement);
