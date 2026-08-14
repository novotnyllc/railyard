import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
if (darkStart < 0) throw new Error('Missing dark color scheme');

const variables = (source) => Object.fromEntries(
  [...source.matchAll(/(--[\w-]+):\s*(#[\da-f]{3,8})/gi)].map(([, name, value]) => [name, value]),
);
const light = variables(css.slice(0, darkStart));
const dark = { ...light, ...variables(css.slice(darkStart)) };

const expectedSelectors = new Set([
  'a:focus-visible',
  'button:focus-visible',
  '.skip-link:focus',
  '.global-nav a:hover',
  '.header-cta:hover',
  '.button-primary:hover',
  '.text-link:hover',
  '.promise-card:hover',
  '.scenario-card:hover',
  '.start-callout .button:hover',
  '.nav-group a:hover',
  '.prev-next a:hover',
  '.start-callout a:focus-visible',
  '.start-callout button:focus-visible',
]);
const actualSelectors = new Set(
  [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((match) => match[1].split(','))
    .map((selector) => selector.trim())
    .filter((selector) => selector.includes(':hover') || selector.includes(':focus')),
);
const unmodeledSelectors = [...actualSelectors].filter((selector) => !expectedSelectors.has(selector));
const missingSelectors = [...expectedSelectors].filter((selector) => !actualSelectors.has(selector));
if (unmodeledSelectors.length || missingSelectors.length) {
  throw new Error(`Interaction inventory changed; model every selector. Unmodeled: ${unmodeledSelectors.join(', ') || 'none'}. Missing: ${missingSelectors.join(', ') || 'none'}.`);
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return index;
  }
  throw new Error('Unclosed CSS block');
}

function parseRules(source) {
  const darkOpen = source.indexOf('{', source.indexOf('@media (prefers-color-scheme: dark)'));
  const darkEnd = matchingBrace(source, darkOpen);
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(',').map((selector) => selector.trim()),
    declarations: Object.fromEntries(
      match[2].split(';').map((entry) => entry.split(/:(.*)/s).slice(0, 2).map((part) => part.trim())).filter(([property, propertyValue]) => property && propertyValue),
    ),
    dark: match.index > darkOpen && match.index < darkEnd,
  }));
}

const rules = parseRules(css);
function declaration(ruleSet, selector, property, scheme) {
  let result;
  for (const rule of ruleSet) {
    if ((scheme === 'dark' || !rule.dark) && rule.selectors.includes(selector) && rule.declarations[property]) {
      result = rule.declarations[property];
    }
  }
  if (!result) throw new Error(`Unresolved ${scheme} declaration: ${selector} ${property}`);
  return result;
}

function primaryButtonForeground(ruleSet, scheme) {
  try {
    return declaration(ruleSet, '.button-primary:hover', 'color', scheme);
  } catch {
    return declaration(ruleSet, '.button-primary', 'color', scheme);
  }
}

const overrideFixture = parseRules(`${css}\n.text-link:hover { color: #777; }`);
if (declaration(overrideFixture, '.text-link:hover', 'color', 'light') !== '#777') {
  throw new Error('Cascade self-check failed to detect a later interaction override');
}

function rgb(value) {
  let hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((part) => part + part).join('');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return { channels, alpha: hex.length === 8 ? Number.parseInt(hex.slice(6), 16) / 255 : 1 };
}

function composite(foreground, background) {
  const fg = rgb(foreground);
  const bg = rgb(background).channels;
  const channels = fg.channels.map((channel, index) => Math.round(channel * fg.alpha + bg[index] * (1 - fg.alpha)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(value) {
  const channels = rgb(value).channels
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const primaryButtonOverrideFixture = parseRules(`${css}\n.button-primary:hover { color: #777; }`);
if (primaryButtonForeground(primaryButtonOverrideFixture, 'light') !== '#777') {
  throw new Error('Cascade self-check failed to select a later primary-button hover foreground');
}
const primaryButtonOverrideRatio = contrast(
  color(light, primaryButtonForeground(primaryButtonOverrideFixture, 'light')),
  color(light, declaration(primaryButtonOverrideFixture, '.button-primary:hover', 'background', 'light')),
);
if (primaryButtonOverrideRatio >= 4.5) {
  throw new Error('Cascade self-check failed to make a low-contrast primary-button hover foreground fail');
}

function color(scheme, expression) {
  const variable = expression.match(/^var\((--[\w-]+)\)$/)?.[1];
  const result = variable ? scheme[variable] : expression;
  if (!result || !/^#[\da-f]{3,8}$/i.test(result)) throw new Error(`Unresolved color: ${expression}`);
  return result;
}

function outline(schemeName, scheme, selector) {
  let expression;
  try {
    expression = declaration(rules, selector, 'outline-color', schemeName);
  } catch {
    const shorthand = declaration(rules, selector, 'outline', schemeName);
    expression = shorthand.match(/var\(--[\w-]+\)|#[\da-f]{3,8}/i)?.[0];
  }
  return color(scheme, expression);
}

const pairs = [
  ['hover: global navigation', (name, scheme) => color(scheme, declaration(rules, '.global-nav a:hover', 'color', name)), (name, scheme) => scheme['--ground']],
  ['hover: header call to action', (name, scheme) => color(scheme, declaration(rules, '.header-cta:hover', 'color', name)), (name, scheme) => color(scheme, declaration(rules, '.header-cta:hover', 'background', name))],
  ['hover: primary button', (name, scheme) => color(scheme, primaryButtonForeground(rules, name)), (name, scheme) => color(scheme, declaration(rules, '.button-primary:hover', 'background', name))],
  ['hover: text link', (name, scheme) => color(scheme, declaration(rules, '.text-link:hover', 'color', name)), (name, scheme) => scheme['--ground']],
  ['hover: card heading', (name, scheme) => scheme['--ink'], (name, scheme) => color(scheme, declaration(rules, '.promise-card:hover', 'background', name))],
  ['hover: card body', (name, scheme) => color(scheme, declaration(rules, '.promise-card p', 'color', name)), (name, scheme) => color(scheme, declaration(rules, '.promise-card:hover', 'background', name))],
  ['hover: card accent', (name, scheme) => color(scheme, declaration(rules, '.card-number', 'color', name)), (name, scheme) => color(scheme, declaration(rules, '.scenario-card:hover', 'background', name))],
  ['hover: start callout button', (name, scheme) => color(scheme, declaration(rules, '.start-callout .button:hover', 'color', name)), (name, scheme) => color(scheme, declaration(rules, '.start-callout .button:hover', 'background', name))],
  ['hover: previous/next heading', (name, scheme) => color(scheme, declaration(rules, '.prev-next a', 'color', name)), (name, scheme) => color(scheme, declaration(rules, '.prev-next a:hover', 'background', name))],
  ['hover: previous/next label', (name, scheme) => color(scheme, declaration(rules, '.prev-next span', 'color', name)), (name, scheme) => color(scheme, declaration(rules, '.prev-next a:hover', 'background', name))],
  ['focus: global outline', (name, scheme) => outline(name, scheme, 'a:focus-visible'), (name, scheme) => scheme['--ground']],
  ['focus: card outline', (name, scheme) => outline(name, scheme, 'a:focus-visible'), (name, scheme) => scheme['--paper']],
  ['focus: filled button outline', (name, scheme) => outline(name, scheme, 'button:focus-visible'), (name, scheme) => scheme['--ground']],
  ['focus: skip link text', (name, scheme) => color(scheme, declaration(rules, '.skip-link', 'color', name)), (name, scheme) => color(scheme, declaration(rules, '.skip-link', 'background', name))],
  ['focus: start callout outline', (name, scheme) => outline(name, scheme, '.start-callout a:focus-visible'), (name, scheme) => color(scheme, declaration(rules, '.start-callout', 'background', name))],
];

const results = [];
for (const [schemeName, scheme] of [['light', light], ['dark', dark]]) {
  for (const [label, foregroundValue, backgroundValue] of pairs) {
    const foreground = foregroundValue(schemeName, scheme);
    const background = backgroundValue(schemeName, scheme);
    results.push({ scheme: schemeName, state: label, ratio: contrast(foreground, background) });
  }

  const navColor = color(scheme, declaration(rules, '.nav-group a:hover', 'color', schemeName));
  const authoredNavBackground = color(scheme, declaration(rules, '.nav-group a:hover', 'background', schemeName));
  const navBackground = rgb(authoredNavBackground).alpha < 1 ? composite(authoredNavBackground, scheme['--ground']) : authoredNavBackground;
  results.push({ scheme: schemeName, state: 'hover: sidebar link', ratio: contrast(navColor, navBackground) });
}

console.log('scheme\tstate\tratio');
for (const result of results) console.log(`${result.scheme}\t${result.state}\t${result.ratio.toFixed(2)}:1`);

const failures = results.filter(({ ratio }) => ratio < 4.5);
if (failures.length) {
  throw new Error(`Contrast below 4.5:1: ${failures.map(({ scheme, state, ratio }) => `${scheme} ${state} ${ratio.toFixed(2)}:1`).join(', ')}`);
}
