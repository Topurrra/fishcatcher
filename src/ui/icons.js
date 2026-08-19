// Feedback glyphs (Tabler Icons, MIT). currentColor + stroke, one family, width 2.
const svg16 = (paths, cls = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

// Feedback glyphs for progress / done / problem states.
// Build a real SVG node from one of the strings below. Parsed as XML, never as
// HTML, and only from these constants, so nothing user-controlled reaches the DOM.
export function iconNode(svgString) {
  return document.importNode(new DOMParser().parseFromString(svgString, 'image/svg+xml').documentElement, true);
}

// Replace an element's content with one of the UI icons.
export function setIcon(el, name) {
  el.replaceChildren(iconNode(UI_ICONS[name]));
}

export const UI_ICONS = {
  spinner: svg16('<path d="M12 3a9 9 0 1 0 9 9" />', 'spinner'),
  check: svg16('<path d="M5 12l5 5l10 -10" />'),
  alert: svg16('<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 8v4" /><path d="M12 16h.01" />')
};

