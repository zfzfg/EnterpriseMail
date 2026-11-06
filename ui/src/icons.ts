const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;

export const iconMenu = svg(
  `<rect x="5" y="5" width="4" height="4"/><rect x="13" y="5" width="4" height="4"/><rect x="21" y="5" width="4" height="4"/>` +
  `<rect x="5" y="13" width="4" height="4"/><rect x="13" y="13" width="4" height="4"/><rect x="21" y="13" width="4" height="4"/>` +
  `<rect x="5" y="21" width="4" height="4"/><rect x="13" y="21" width="4" height="4"/><rect x="21" y="21" width="4" height="4"/>`
);

export const iconClose = svg(
  `<rect x="5" y="5" width="4" height="4"/><rect x="21" y="5" width="4" height="4"/>` +
  `<rect x="9" y="9" width="4" height="4"/><rect x="17" y="9" width="4" height="4"/>` +
  `<rect x="13" y="13" width="4" height="4"/>` +
  `<rect x="9" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/>` +
  `<rect x="5" y="21" width="4" height="4"/><rect x="21" y="21" width="4" height="4"/>`
);
