import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');

const diagrams = [
  ['m2-delivery-lifecycle', 'delivery/lifecycle.md', ['Ask', 'Route', 'Build', 'Review', 'Quality', 'Publish', 'Settle', 'Merge', 'Prove', 'Learn']],
  ['m6-review-gates', 'delivery/gates.md', ['Ready', 'Gates', 'Thermos', 'Return', 'Settle', 'Review', 'Merge', 'Prove']],
  ['m5-model-routing', 'delivery/model-routing/index.md', ['Request', 'Resolve', 'Select', 'Route', 'Admit', 'Claim', 'Carrier', 'Reconcile', 'Receipt']],
  ['m1-convergence', 'roundhouse/convergence.md', ['Poll', 'Fetch', 'Resume', 'Promote', 'Fold', 'Review', 'Verdict', 'Apply', 'Journal', 'Publish']],
  ['m7-skill-sync', 'sync/index.md', ['Publish', 'Store', 'Fast pass', 'Fold', 'Lookup', 'Manager', 'Hooks', 'Journal', 'Arrive']],
  ['m8-canary-evidence', 'roundhouse/security/canary-evidence.md', ['Apply', 'Wait', 'Liveness', 'Gate', 'Outcome']],
  ['m3-trust-ratchet', 'roundhouse/security/trust-ratchet.md', ['Ask', 'Answer', 'Verify', 'Accept', 'Hold']],
  ['m10-anti-rollback', 'roundhouse/security/anti-rollback.md', ['Fetch', 'Ancestry', 'Generation', 'Archive', 'Verify', 'Decide']],
  ['m9-enrollment', 'roundhouse/security/enrollment-and-tofu.md', ['Ask', 'Contact', 'Prepare', 'Key', 'Prove', 'Return', 'Publish', 'Arrive']],
  ['m4-trust-boundaries', 'roundhouse/security/attack-shapes.md', ['Instruction', 'Key', 'Sign', 'Store', 'Verify', 'Gate', 'Outcome', 'Contain', 'Residual']],
];

const normalize = (value) => value.trim().replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').toLowerCase();
const sourceSteps = (source) => [...source.matchAll(/(\d+)\s·\s*([A-Za-z][^<\n\"]*)/g)].map((match) => ({ number: Number(match[1]), label: match[2].trim() }));
const pageSteps = (page) => [...page.matchAll(/^\s*(\d+)\.\s+\*\*([^*.]+)\.\*\*/gm)].map((match) => ({ number: Number(match[1]), label: match[2].trim() }));
const attr = (source, name) => source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
const svgSteps = (svg) => [...svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)]
  .filter((match) => attr(match[1], 'class')?.split(/\s+/).includes('step-marker'))
  .map((match) => {
    const attrs = match[1];
    const body = match[2];
    const circle = body.match(/<circle\b([^>]*)>/)?.[1] || '';
    const numberText = body.match(/<text\b([^>]*)>([^<]*)<\/text>/);
    return {
      number: Number(attr(attrs, 'data-step')),
      label: attr(attrs, 'data-step-label')?.trim() || '',
      ariaNumber: Number((attr(attrs, 'aria-label') || '').match(/^Step (\d+):/)?.[1]),
      ariaLabel: (attr(attrs, 'aria-label') || '').replace(/^Step \d+:\s*/, '').trim(),
      renderedNumber: Number(numberText?.[2]),
      cx: Number(attr(circle, 'cx')),
      cy: Number(attr(circle, 'cy')),
      radius: Number(attr(circle, 'r')),
    };
  });
const renderedText = (svg) => normalize([...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]).join(' '));

function assertSteps(kind, actual, expected, id) {
  if (actual.length !== expected.length) throw new Error(`${id}: ${kind} has ${actual.length} steps; expected ${expected.length}`);
  actual.forEach((step, index) => {
    const expectedNumber = index + 1;
    const actualLabel = normalize(step.label);
    const expectedLabel = normalize(expected[index]);
    const nextCharacter = actualLabel[expectedLabel.length] || '';
    const labelMatches = actualLabel === expectedLabel || (actualLabel.startsWith(expectedLabel) && !/[a-z0-9]/i.test(nextCharacter));
    const svgMarkerMatches = kind === 'SVG'
      ? step.ariaNumber === expectedNumber && normalize(step.ariaLabel) === expectedLabel && step.renderedNumber === expectedNumber
      : true;
    if (step.number !== expectedNumber || !labelMatches || !svgMarkerMatches) {
      throw new Error(`${id}: ${kind} step ${index + 1} is ${step.number} ${JSON.stringify(step.label)}; expected ${expectedNumber} ${JSON.stringify(expected[index])}`);
    }
  });
}

for (const [id, pageRelative, expected] of diagrams) {
  const source = await read(`src/diagrams/${id}.mmd`);
  const svg = await read(`public/diagrams/${id}.svg`);
  const page = await read(`src/content/pages/${pageRelative}`);
  assertSteps('Mermaid', sourceSteps(source), expected, id);
  const markers = svgSteps(svg);
  assertSteps('SVG', markers, expected, id);
  const text = renderedText(svg);
  for (const label of expected) {
    if (!text.includes(normalize(label))) throw new Error(`${id}: rendered SVG text is missing step label ${label}`);
  }
  for (let left = 0; left < markers.length; left += 1) {
    for (let right = left + 1; right < markers.length; right += 1) {
      const a = markers[left];
      const b = markers[right];
      const minimum = a.radius + b.radius;
      if (a.radius && b.radius && Math.hypot(a.cx - b.cx, a.cy - b.cy) < minimum) {
        throw new Error(`${id}: step badges ${a.number} and ${b.number} overlap`);
      }
    }
  }
  const expectedSequence = expected.map((_, index) => index + 1).join(',');
  if (svg.match(/data-sequence="([^"]+)"/)?.[1] !== expectedSequence) throw new Error(`${id}: SVG primary sequence does not match ${expectedSequence}`);
  const sequence = page.match(/### Sequence\n\n((?:\d+\.\s+\*\*[^\n]+\n)+)/);
  if (!sequence) throw new Error(`${id}: missing caption sequence block in ${pageRelative}`);
  assertSteps('caption', pageSteps(sequence[1]), expected, id);
  const rootAttributes = svg.match(/<svg\b([^>]*)>/)?.[1] || '';
  const title = svg.match(/<title\b([^>]*)>([^<]+)<\/title>/);
  const desc = svg.match(/<desc\b([^>]*)>([^<]+)<\/desc>/);
  const labelledBy = (attr(rootAttributes, 'aria-labelledby') || '').split(/\s+/).filter(Boolean);
  if (attr(rootAttributes, 'role') !== 'img' || !title || !desc || !labelledBy.includes(attr(title[1], 'id')) || !labelledBy.includes(attr(desc[1], 'id'))) {
    throw new Error(`${id}: SVG must wire role=img aria-labelledby to non-empty title and desc`);
  }
  const svgWithoutNamespace = svg.replace(/xmlns="https?:\/\/[^\"]+"/g, '');
  if (/https?:\/\//.test(source) || /https?:\/\//.test(svgWithoutNamespace)) throw new Error(`${id}: runtime/external URL found in diagram artifact`);
  console.log(`${id}\tsteps=${expected.length}\tmermaid=ok\tsvg=ok\tcaptions=ok`);
}

const m4 = await read('public/diagrams/m4-trust-boundaries.svg');
const m4Source = await read('src/diagrams/m4-trust-boundaries.mmd');
const m4RenderedText = [...m4.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1].trim()).filter(Boolean).join(' ');
for (const marker of ['stolen machine key', 'replay / downgrade', 'hub credential theft', 'Contain', 'Residual']) {
  if (!m4RenderedText.includes(marker) || !m4Source.includes(marker)) throw new Error(`m4: attack-shape marker ${marker} must exist in both artifacts`);
}
for (const [attempt, gate, residual] of [
  ['stolen machine key', 'parent / class scope', 'bounded authority until retirement'],
  ['replay / downgrade', 'ancestry / high-water', 'offline persistence'],
  ['hub credential theft', 'store transports only', 'disclosure / availability'],
]) {
  for (const marker of [attempt, gate, residual]) {
    if (!m4RenderedText.includes(marker) || !m4Source.includes(marker)) throw new Error(`m4: incomplete attack lane ${attempt}; missing ${marker}`);
  }
}
console.log('m4\tattack-shape-overlays=attempt+gate+residual');
