export const NAV_GROUPS = [
  { key: 'start', label: 'Start' },
  { key: 'what-it-does', label: 'Scenarios' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'desired-state', label: 'Desired state' },
  { key: 'sync', label: 'Sync' },
  { key: 'roundhouse', label: 'Roundhouse' },
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
  const parentIdFor = (id, key) => {
    const clean = id.endsWith('/index') ? id.slice(0, -6) : id;
    const parts = clean.split('/');
    if (parts.length <= 1) return null;
    return parts.length === 2 ? `${key}/index` : `${parts.slice(0, -1).join('/')}/index`;
  };

  return NAV_GROUPS.map((group) => {
    const groupEntries = entries.filter((entry) => entry.id === group.key || entry.id.startsWith(`${group.key}/`));
    const groupIds = new Set(groupEntries.map((entry) => entry.id));
    const children = new Map();
    for (const entry of groupEntries) {
      const candidateParent = parentIdFor(entry.id, group.key);
      const parentId = candidateParent && groupIds.has(candidateParent) ? candidateParent : null;
      const list = children.get(parentId) || [];
      list.push(entry);
      children.set(parentId, list);
    }
    const order = (entry) => (entry.id === group.key || entry.id === `${group.key}/index`) ? -1 : (Number(entry.data.nav_order) || 99);
    const flatten = (parentId, depth = 0) => (children.get(parentId) || [])
      .sort((a, b) => order(a) - order(b) || String(a.data.title).localeCompare(String(b.data.title)))
      .flatMap((entry) => [
        { id: entry.id, title: entry.data.title || entry.id, href: routeFromId(entry.id), depth },
        ...flatten(entry.id, depth + 1),
      ]);
    return { ...group, items: flatten(null) };
  }).filter((group) => group.items.length);
}
