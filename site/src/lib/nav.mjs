export const NAV_GROUPS = [
  { key: 'start', label: 'Start' },
  { key: 'what-it-does', label: 'Scenarios' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'desired-state', label: 'Desired state' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'skills', label: 'Skills' },
  { key: 'security', label: 'Security' },
  { key: 'credits', label: 'Credits' },
  { key: 'docs', label: 'Site docs' },
];

export function routeFromId(id) {
  if (id === 'index') return '/';
  const route = id.endsWith('/index') ? id.slice(0, -6) : id;
  return `/${route}/`;
}

export function routeParamFromId(id) {
  if (id === 'index') return undefined;
  return id.endsWith('/index') ? id.slice(0, -6) : id;
}

export function buildNav(entries) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: entries
      .filter((entry) => entry.id === group.key || entry.id.startsWith(`${group.key}/`))
      .sort((a, b) => {
        const order = (entry) => (entry.id === group.key || entry.id.endsWith('/index')) ? -1 : (Number(entry.data.nav_order) || 99);
        return order(a) - order(b) || String(a.data.title).localeCompare(String(b.data.title));
      })
      .map((entry) => ({ id: entry.id, title: entry.data.title || entry.id, href: routeFromId(entry.id) })),
  })).filter((group) => group.items.length);
}
