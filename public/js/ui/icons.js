// Icônes au trait (dessinées pour le projet, style 24 px, trait 1,75).
const P = {
  menu: 'M4 6h16M4 12h16M4 18h16', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18', chevron: 'M9 6l6 6-6 6', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  play: 'M7 5l12 7-12 7z', pause: 'M8 5v14M16 5v14', clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  earth: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  antenna: 'M12 13v8M8 21h8M5 5a10 10 0 0 0 0 10M19 5a10 10 0 0 1 0 10M8.5 7.5a5 5 0 0 0 0 5M15.5 7.5a5 5 0 0 1 0 5M12 9.5v1',
  thermo: 'M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0zM12 9v8', mountain: 'M3 19l6-11 4 7 2-3 6 7z',
  slope: 'M3 19h18L3 7z', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', droplet: 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5', rocket: 'M12 3c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10zM9 16l-2 4M15 16l2 4M12 9v2',
  battery: 'M3 8h16v8H3zM21 11v2M7 11v2M11 11v2', bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
  compare: 'M4 5h6v14H4zM14 5h6v14h-6z', ruler: 'M4 16L16 4l4 4L8 20zM8 12l2 2M11 9l2 2M14 6l2 2',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16', download: 'M12 4v12M7 11l5 5 5-5M4 20h16', database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-1-3-2 .5-1.500-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L7 8.500 5 8l-1 3 2 1v2l-2 1 1 3 2-.5L8.500 19 8 21l3 1 1-2h2l1 2 3-1-.5-2 1.500-1.500 2 .5 1-3-2-1z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.500v.5', warn: 'M12 3l10 18H2zM12 10v5M12 17.500v.5',
  check: 'M5 12l5 5 9-10', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.500 9h17M3.500 15h17M12 3c-4 4-4 14 0 18M12 3c4 4 4 14 0 18',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14', eye: 'M2 12c3-5 6-7 10-7s7 2 10 7c-3 5-6 7-10 7s-7-2-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10', users: 'M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM2 20c0-3 3-5.500 7-5.500s7 2.500 7 5.500M17 4.500a3.500 3.500 0 0 1 0 6.500M22 20c0-2.500-1.500-4.500-4-5.200',
  history: 'M4 12a8 8 0 1 0 2.500-5.800M4 4v4h4M12 8v4l3 2', pin: 'M12 21s-6-6.500-6-11a6 6 0 0 1 12 0c0 4.500-6 11-6 11zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', refresh: 'M4 12a8 8 0 0 1 14-5.300L20 8M20 4v4h-4M20 12a8 8 0 0 1-14 5.300L4 16M4 20v-4h4',
  external: 'M14 4h6v6M20 4l-9 9M18 13v6H5V6h6', moon: 'M20 14A8 8 0 1 1 10 4a6.500 6.500 0 0 0 10 10z', help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.7.4-1 1-1 1.700M12 17v.5',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10.500a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', star: 'M12 3l2.700 5.800 6.300.8-4.600 4.300 1.200 6.200L12 17l-5.600 3.100 1.200-6.200L3 9.600l6.300-.8z',
};
/** @returns {SVGElement} */
export function icon(name, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || P.info); svg.append(p);
  return svg;
}
export const ICON_NAMES = Object.keys(P);
