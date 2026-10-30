/** Lumiverse's custom CSS (global theme plus component overrides) lands in this one element. */
export const USER_CSS_ID = 'lumiverse-user-css';
export const THEME_MESSAGES_ATTRIBUTE = 'data-jb-theme-messages';

const MESSAGE_STYLES = [['BubbleMessage', 'bubble'], ['MinimalMessage', 'minimal']] as const;

/**
 * Names the chat message styles the user's custom CSS designs itself, so Janiverse's
 * left-avatar layout steps aside for that style instead of half-overriding the theme.
 * Janiverse's own Customize only writes MessageContent text rules, which are not counted.
 */
export function themedMessageStyles(css: string) {
  return MESSAGE_STYLES.filter(([component]) => css.includes(component)).map(([, style]) => style);
}

export function watchThemeMessages(doc: Document = document) {
  const root = doc.documentElement, previous = root.getAttribute(THEME_MESSAGES_ATTRIBUTE);
  const sync = () => {
    const styles = themedMessageStyles(doc.getElementById(USER_CSS_ID)?.textContent ?? '').join(' ');
    if (styles) { if (root.getAttribute(THEME_MESSAGES_ATTRIBUTE) !== styles) root.setAttribute(THEME_MESSAGES_ATTRIBUTE, styles); }
    else if (root.hasAttribute(THEME_MESSAGES_ATTRIBUTE)) root.removeAttribute(THEME_MESSAGES_ATTRIBUTE);
  };
  sync();
  const Observer = doc.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(sync) : undefined;
  observer?.observe(doc.head, { childList: true, subtree: true, characterData: true });
  return () => {
    observer?.disconnect();
    if (previous === null) root.removeAttribute(THEME_MESSAGES_ATTRIBUTE); else root.setAttribute(THEME_MESSAGES_ATTRIBUTE, previous);
  };
}
