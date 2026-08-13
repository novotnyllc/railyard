function withBase(path, base) {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith(base)) return path;
  return base === '/' ? path : `${base}${path}`;
}

function walk(node, base) {
  if (!node || typeof node !== 'object') return;
  if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && typeof node.url === 'string') {
    node.url = withBase(node.url, base);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, base));
    else if (value && typeof value === 'object') walk(value, base);
  }
}

export default function remarkBaseLinks(options = {}) {
  const base = options.base || '/';
  return (tree) => walk(tree, base);
}
