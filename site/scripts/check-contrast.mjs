import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

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
  '.terminal a:focus-visible',
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
  const mediaBlocks = [...source.matchAll(/@media\s*([^{}]+)\{/g)].map((match) => {
    const open = source.indexOf('{', match.index);
    return { query: match[1].trim(), open, end: matchingBrace(source, open) };
  });
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const declarationList = match[2].split(';').map((entry) => entry.split(/:(.*)/s).slice(0, 2).map((part) => part.trim())).filter(([property, propertyValue]) => property && propertyValue);
    return {
      selectors: match[1].split(',').map((selector) => selector.trim()),
      declarationList,
      declarations: Object.fromEntries(declarationList),
      media: mediaBlocks.filter(({ open, end }) => match.index > open && match.index < end).map(({ query }) => query),
    };
  });
}

const rules = parseRules(css);
const interactionSubjects = [
  '.global-nav a', '.header-cta', '.button-primary', '.text-link', '.promise-card', '.scenario-card',
  '.card-number', '.scenario-number', '.start-callout', '.nav-group a', '.prev-next a', '.prev-next span',
  '.skip-link', '.terminal a',
];
const modeledPaintSelectors = new Set([
  '.skip-link', '.global-nav a:hover', '.header-cta:hover', '.button-primary', '.button-primary:hover',
  '.text-link', '.text-link:hover', '.promise-card', '.promise-card:hover', '.promise-card p', '.card-number',
  '.scenario-card', '.scenario-card:hover', '.scenario-card p', '.scenario-number', '.start-callout',
  '.start-callout h2 em', '.start-callout p', '.start-callout .button', '.start-callout .button:hover',
  '.start-callout a:focus-visible', '.start-callout button:focus-visible', '.nav-group a', '.nav-group a:hover',
  '.nav-group a.active', '.prev-next a', '.prev-next a:hover', '.prev-next span', '.terminal a',
  '.terminal a:focus-visible',
]);
function assertNoCompetingPaint(ruleSet) {
  for (const rule of ruleSet) {
    const paintDeclarations = rule.declarationList.filter(([property]) => ['color', 'background', 'background-color', 'outline', 'outline-color', 'opacity'].includes(property));
    const hasPaint = paintDeclarations.length > 0;
    if (!hasPaint) continue;
    for (const selector of rule.selectors) {
      if (!interactionSubjects.some((subject) => selector.includes(subject))) continue;
      if (paintDeclarations.some(([, propertyValue]) => propertyValue.includes('!important'))) {
        throw new Error(`Interaction paint does not support !important: ${selector}`);
      }
      if (!modeledPaintSelectors.has(selector)) {
        throw new Error(`Unmodeled competing interaction paint: ${selector}`);
      }
    }
  }
}
assertNoCompetingPaint(rules);

let activeViewportWidth = Number.POSITIVE_INFINITY;
function mediaMatches(query, scheme) {
  const features = [...query.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim());
  const residue = query.replace(/\([^)]+\)/g, '').replace(/\band\b/gi, '').replace(/\bscreen\b/gi, '').trim();
  if (residue) throw new Error(`Unsupported media condition: ${query}`);
  return features.every((feature) => {
    if (feature === 'prefers-color-scheme: dark') return scheme === 'dark';
    if (feature === 'prefers-color-scheme: light') return scheme === 'light';
    const width = feature.match(/^(min|max)-width:\s*(\d+)px$/);
    if (width) return width[1] === 'min' ? activeViewportWidth >= Number(width[2]) : activeViewportWidth <= Number(width[2]);
    throw new Error(`Unsupported media feature: ${feature}`);
  });
}

function ruleApplies(rule, scheme) {
  return rule.media.every((query) => mediaMatches(query, scheme));
}

function schemeVariables(ruleSet, scheme) {
  const result = {};
  for (const rule of ruleSet) {
    if (rule.selectors.includes(':root') && ruleApplies(rule, scheme)) {
      for (const [property, propertyValue] of rule.declarationList) {
        if (property.startsWith('--')) result[property] = propertyValue;
      }
    }
  }
  return result;
}

let light = schemeVariables(rules, 'light');
let dark = schemeVariables(rules, 'dark');
const breakpoints = [...css.matchAll(/\((?:min|max)-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]));
const viewportWidths = [...new Set([320, 1440, ...breakpoints.flatMap((width) => [width - 1, width, width + 1])])].filter((width) => width > 0).sort((a, b) => a - b);

function declaration(ruleSet, selector, property, scheme) {
  let result;
  for (const rule of ruleSet) {
    if (rule.selectors.includes(selector) && ruleApplies(rule, scheme) && rule.declarations[property]) {
      result = rule.declarations[property];
    }
  }
  if (!result) throw new Error(`Unresolved ${scheme} declaration: ${selector} ${property}`);
  return result;
}

function firstDeclaration(ruleSet, selectors, property, scheme, fallback) {
  for (const selector of selectors) {
    try {
      return declaration(ruleSet, selector, property, scheme);
    } catch {
      // Try the next selector in computed-style precedence order.
    }
  }
  return fallback;
}

function lastPropertyDeclaration(ruleSet, selector, properties, scheme) {
  let result;
  for (const rule of ruleSet) {
    if (rule.selectors.includes(selector) && ruleApplies(rule, scheme)) {
      for (const [property, propertyValue] of rule.declarationList) {
        if (properties.includes(property)) result = { property, value: propertyValue };
      }
    }
  }
  return result;
}

function backgroundDeclaration(ruleSet, selectors, scheme, fallback) {
  for (const selector of selectors) {
    const result = lastPropertyDeclaration(ruleSet, selector, ['background', 'background-color'], scheme);
    if (result) return result.value;
  }
  return fallback;
}

function primaryButtonForeground(ruleSet, scheme) {
  return firstDeclaration(ruleSet, ['.button-primary:hover', '.button-primary'], 'color', scheme);
}

function terminalForeground(ruleSet, scheme) {
  const expression = firstDeclaration(ruleSet, ['.terminal a:focus-visible', '.terminal a'], 'color', scheme);
  return expression === 'inherit' ? declaration(ruleSet, '.terminal', 'color', scheme) : expression;
}

for (const selector of ['a:focus-visible', 'button:focus-visible']) {
  for (const scheme of ['light', 'dark']) {
    for (const viewportWidth of viewportWidths) {
      activeViewportWidth = viewportWidth;
      for (const property of ['color', 'background', 'background-color']) {
        try {
          declaration(rules, selector, property, scheme);
          throw new Error(`Global focus paint must be modeled per surface: ${selector} ${property} (${scheme}, ${viewportWidth}px)`);
        } catch (error) {
          if (error.message.startsWith('Global focus paint')) throw error;
        }
      }
    }
  }
}

for (const selector of expectedSelectors) {
  for (const scheme of ['light', 'dark']) {
    for (const viewportWidth of viewportWidths) {
      activeViewportWidth = viewportWidth;
      try {
        declaration(rules, selector, 'opacity', scheme);
        throw new Error(`Interaction opacity requires an explicit compositing model: ${selector} (${scheme}, ${viewportWidth}px)`);
      } catch (error) {
        if (error.message.startsWith('Interaction opacity')) throw error;
      }
    }
  }
}
activeViewportWidth = Number.POSITIVE_INFINITY;

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

function contrast(foreground, background, surface) {
  const renderedBackground = rgb(background).alpha < 1 ? composite(background, surface) : background;
  const renderedForeground = rgb(foreground).alpha < 1 ? composite(foreground, renderedBackground) : foreground;
  const values = [luminance(renderedForeground), luminance(renderedBackground)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

if (contrast('#00000080', '#fffdf9', '#fffdf9') >= 4.5) {
  throw new Error('Alpha self-check failed to composite a translucent foreground');
}

const primaryButtonOverrideFixture = parseRules(`${css}\n.button-primary:hover { color: #777; }`);
if (primaryButtonForeground(primaryButtonOverrideFixture, 'light') !== '#777') {
  throw new Error('Cascade self-check failed to select a later primary-button hover foreground');
}
const primaryButtonOverrideRatio = contrast(
  color(light, primaryButtonForeground(primaryButtonOverrideFixture, 'light')),
  color(light, declaration(primaryButtonOverrideFixture, '.button-primary:hover', 'background', 'light')),
  light['--ground'],
);
if (primaryButtonOverrideRatio >= 4.5) {
  throw new Error('Cascade self-check failed to make a low-contrast primary-button hover foreground fail');
}

function color(scheme, expression, seen = new Set()) {
  if (!expression) throw new Error(`Unresolved color: ${expression}`);
  const variable = expression.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (variable) {
    if (seen.has(variable)) throw new Error(`Circular color variable: ${variable}`);
    seen.add(variable);
  }
  const result = variable ? color(scheme, scheme[variable], seen) : expression;
  if (!result || !/^#[\da-f]{3,8}$/i.test(result)) throw new Error(`Unresolved color: ${expression}`);
  return result;
}

function outline(ruleSet, schemeName, scheme, selectors) {
  const candidates = Array.isArray(selectors) ? selectors : [selectors];
  let result;
  for (const selector of candidates) {
    result = lastPropertyDeclaration(ruleSet, selector, ['outline', 'outline-color'], schemeName);
    if (result) break;
  }
  if (!result) throw new Error(`Unresolved ${schemeName} outline: ${candidates.join(', ')}`);
  const expression = result.property === 'outline'
    ? result.value.match(/var\(--[\w-]+\)|#[\da-f]{3,8}/i)?.[0]
    : result.value;
  return color(scheme, expression);
}

const pairs = [
  ['hover: global navigation', (name, scheme) => color(scheme, declaration(rules, '.global-nav a:hover', 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.global-nav a:hover', '.global-nav a'], name, 'var(--ground)')), (name, scheme) => scheme['--ground']],
  ['hover: header call to action', (name, scheme) => color(scheme, declaration(rules, '.header-cta:hover', 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.header-cta:hover'], name)), (name, scheme) => scheme['--ground']],
  ['hover: primary button', (name, scheme) => color(scheme, primaryButtonForeground(rules, name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.button-primary:hover'], name)), (name, scheme) => scheme['--ground']],
  ['hover: text link', (name, scheme) => color(scheme, declaration(rules, '.text-link:hover', 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.text-link:hover', '.text-link'], name, 'var(--ground)')), (name, scheme) => scheme['--ground']],
  ['hover: promise heading', (name, scheme) => color(scheme, firstDeclaration(rules, ['.promise-card h3', '.promise-card:hover', '.promise-card'], 'color', name, 'var(--ink)')), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.promise-card:hover'], name)), (name, scheme) => scheme['--paper']],
  ['hover: promise body', (name, scheme) => color(scheme, declaration(rules, '.promise-card p', 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.promise-card:hover'], name)), (name, scheme) => scheme['--paper']],
  ['hover: promise accent', (name, scheme) => color(scheme, declaration(rules, '.card-number', 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.promise-card:hover'], name)), (name, scheme) => scheme['--paper']],
  ['hover: scenario heading', (name, scheme) => color(scheme, firstDeclaration(rules, ['.scenario-card h3', '.scenario-card:hover', '.scenario-card'], 'color', name, 'var(--ink)')), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.scenario-card:hover'], name)), (name, scheme) => scheme['--paper']],
  ['hover: scenario body', (name, scheme) => color(scheme, declaration(rules, '.scenario-card p', 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.scenario-card:hover'], name)), (name, scheme) => scheme['--paper']],
  ['hover: scenario accent', (name, scheme) => color(scheme, declaration(rules, '.scenario-number', 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.scenario-card:hover'], name)), (name, scheme) => scheme['--paper']],
  ['hover: start callout button', (name, scheme) => color(scheme, declaration(rules, '.start-callout .button:hover', 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout .button:hover'], name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout'], name))],
  ['hover: previous/next heading', (name, scheme) => color(scheme, firstDeclaration(rules, ['.prev-next a:hover', '.prev-next a'], 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.prev-next a:hover'], name)), (name, scheme) => scheme['--ground']],
  ['hover: previous/next label', (name, scheme) => color(scheme, declaration(rules, '.prev-next span', 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.prev-next a:hover'], name)), (name, scheme) => scheme['--ground']],
  ['focus: global anchor outline', (name, scheme) => outline(rules, name, scheme, 'a:focus-visible'), (name, scheme) => scheme['--ground'], (name, scheme) => scheme['--ground']],
  ['focus: global button outline', (name, scheme) => outline(rules, name, scheme, 'button:focus-visible'), (name, scheme) => scheme['--ground'], (name, scheme) => scheme['--ground']],
  ['focus: card outline', (name, scheme) => outline(rules, name, scheme, 'a:focus-visible'), (name, scheme) => scheme['--paper'], (name, scheme) => scheme['--paper']],
  ['focus: filled button outline', (name, scheme) => outline(rules, name, scheme, 'a:focus-visible'), (name, scheme) => scheme['--ground'], (name, scheme) => scheme['--ground']],
  ['focus: skip link text', (name, scheme) => color(scheme, firstDeclaration(rules, ['.skip-link:focus', '.skip-link'], 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.skip-link:focus', '.skip-link'], name)), (name, scheme) => scheme['--ground']],
  ['focus: skip link outline', (name, scheme) => outline(rules, name, scheme, ['.skip-link:focus', 'a:focus-visible']), (name, scheme) => scheme['--ground'], (name, scheme) => scheme['--ground']],
  ['focus: start callout link text', (name, scheme) => color(scheme, firstDeclaration(rules, ['.start-callout a:focus-visible', '.start-callout .button'], 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout a:focus-visible', '.start-callout .button'], name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout'], name))],
  ['focus: start callout button text', (name, scheme) => color(scheme, firstDeclaration(rules, ['.start-callout button:focus-visible', '.start-callout .button'], 'color', name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout button:focus-visible', '.start-callout .button'], name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout'], name))],
  ['focus: start callout link outline', (name, scheme) => outline(rules, name, scheme, ['.start-callout a:focus-visible', 'a:focus-visible']), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout'], name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout'], name))],
  ['focus: start callout button outline', (name, scheme) => outline(rules, name, scheme, ['.start-callout button:focus-visible', 'button:focus-visible']), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout'], name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.start-callout'], name))],
  ['focus: terminal link text', (name, scheme) => color(scheme, terminalForeground(rules, name)), (name, scheme) => color(scheme, backgroundDeclaration(rules, ['.terminal a:focus-visible', '.terminal a', '.terminal'], name)), (name, scheme) => scheme['--ground']],
  ['focus: terminal outline', (name, scheme) => outline(rules, name, scheme, '.terminal a:focus-visible'), (name, scheme) => scheme['--night'], (name, scheme) => scheme['--night']],
];

const scenarioOverrideFixture = parseRules(`${css}\n.scenario-card p { color: #777; }`);
if (contrast(
  color(dark, declaration(scenarioOverrideFixture, '.scenario-card p', 'color', 'dark')),
  color(dark, declaration(scenarioOverrideFixture, '.scenario-card:hover', 'background', 'dark')),
  dark['--paper'],
) >= 4.5) {
  throw new Error('Scenario self-check failed to make a low-contrast body override fail');
}

const navOverrideFixture = parseRules(`${css}\n.global-nav a:hover { color: var(--ink); background: var(--ink); }`);
if (contrast(
  color(light, declaration(navOverrideFixture, '.global-nav a:hover', 'color', 'light')),
  color(light, backgroundDeclaration(navOverrideFixture, ['.global-nav a:hover', '.global-nav a'], 'light', 'var(--ground)')),
  light['--ground'],
) >= 4.5) {
  throw new Error('Navigation self-check failed to make equal hover colors fail');
}

const skipOverrideFixture = parseRules(`${css}\n.skip-link:focus { color: var(--ink); background: var(--ink); }`);
if (contrast(
  color(light, firstDeclaration(skipOverrideFixture, ['.skip-link:focus', '.skip-link'], 'color', 'light')),
  color(light, backgroundDeclaration(skipOverrideFixture, ['.skip-link:focus', '.skip-link'], 'light')),
  light['--ground'],
) >= 4.5) {
  throw new Error('Skip-link self-check failed to make equal focus colors fail');
}

const backgroundOrderFixture = parseRules(`${css}\n.text-link:hover { background-color: var(--ground); background: var(--amber-dark); }`);
if (backgroundDeclaration(backgroundOrderFixture, ['.text-link:hover'], 'light') !== 'var(--amber-dark)') {
  throw new Error('Cascade self-check failed to preserve background declaration order');
}

const outlineOrderFixture = parseRules(`${css}\na:focus-visible { outline-color: var(--amber-dark); outline: 3px solid var(--ink); }`);
const outlineOrderResult = lastPropertyDeclaration(outlineOrderFixture, 'a:focus-visible', ['outline', 'outline-color'], 'light');
if (outlineOrderResult.property !== 'outline' || outlineOrderResult.value !== '3px solid var(--ink)') {
  throw new Error('Cascade self-check failed to preserve outline declaration order');
}

const terminalFocusFixture = parseRules(`${css}\n.terminal a:focus-visible { color: var(--night); background: var(--night); }`);
if (contrast(
  color(light, terminalForeground(terminalFocusFixture, 'light')),
  color(light, backgroundDeclaration(terminalFocusFixture, ['.terminal a:focus-visible', '.terminal a', '.terminal'], 'light')),
  light['--ground'],
) >= 4.5) {
  throw new Error('Terminal focus self-check failed to make equal text and background colors fail');
}

const buttonFocusFixture = parseRules(`${css}\nbutton:focus-visible { outline-color: var(--ground); }`);
const buttonFocusScheme = schemeVariables(buttonFocusFixture, 'light');
if (contrast(
  outline(buttonFocusFixture, 'light', buttonFocusScheme, 'button:focus-visible'),
  buttonFocusScheme['--ground'],
  buttonFocusScheme['--ground'],
) >= 4.5) {
  throw new Error('Button focus self-check failed to make a surface-colored outline fail');
}

const skipFocusFixture = parseRules(`${css}\n.skip-link:focus { outline-color: var(--ground); }`);
const skipFocusScheme = schemeVariables(skipFocusFixture, 'light');
if (contrast(
  outline(skipFocusFixture, 'light', skipFocusScheme, ['.skip-link:focus', 'a:focus-visible']),
  skipFocusScheme['--ground'],
  skipFocusScheme['--ground'],
) >= 4.5) {
  throw new Error('Skip-link focus self-check failed to make a surface-colored outline fail');
}

const startButtonFocusFixture = parseRules(`${css}\n.start-callout button:focus-visible { outline-color: var(--ink); }`);
const startButtonFocusScheme = schemeVariables(startButtonFocusFixture, 'light');
if (contrast(
  outline(startButtonFocusFixture, 'light', startButtonFocusScheme, ['.start-callout button:focus-visible', 'button:focus-visible']),
  color(startButtonFocusScheme, backgroundDeclaration(startButtonFocusFixture, ['.start-callout'], 'light')),
  color(startButtonFocusScheme, backgroundDeclaration(startButtonFocusFixture, ['.start-callout'], 'light')),
) >= 4.5) {
  throw new Error('Start-callout button focus self-check failed to make a callout-colored outline fail');
}

const mediaFixture = parseRules(`${css}\n.text-link:hover { color: #777; }\n@media (max-width: 620px) { .text-link:hover { color: var(--amber-dark); } }`);
activeViewportWidth = 1280;
if (declaration(mediaFixture, '.text-link:hover', 'color', 'light') !== '#777') {
  throw new Error('Media self-check failed to preserve the desktop interaction state');
}
activeViewportWidth = 620;
if (declaration(mediaFixture, '.text-link:hover', 'color', 'light') !== 'var(--amber-dark)') {
  throw new Error('Media self-check failed to apply the narrow interaction override');
}
const mediaFixtureWorstRatio = [620, 1280].map((viewportWidth) => {
  activeViewportWidth = viewportWidth;
  const scheme = schemeVariables(mediaFixture, 'light');
  return contrast(
    color(scheme, declaration(mediaFixture, '.text-link:hover', 'color', 'light')),
    color(scheme, backgroundDeclaration(mediaFixture, ['.text-link:hover', '.text-link'], 'light', 'var(--ground)')),
    scheme['--ground'],
  );
}).sort((a, b) => a - b)[0];
if (mediaFixtureWorstRatio >= 4.5) {
  throw new Error('Media self-check failed to retain a low-contrast desktop state');
}

const variableMediaFixture = parseRules(`${css}\n:root { --interactive-hover: var(--ink); }\n@media (max-width: 620px) { :root { --interactive-hover: var(--paper); } }`);
activeViewportWidth = 1280;
if (schemeVariables(variableMediaFixture, 'light')['--interactive-hover'] !== 'var(--ink)') {
  throw new Error('Variable self-check failed to preserve the desktop custom property');
}
const variableDesktopScheme = schemeVariables(variableMediaFixture, 'light');
if (contrast(
  color(variableDesktopScheme, firstDeclaration(variableMediaFixture, ['.promise-card h3', '.promise-card:hover', '.promise-card'], 'color', 'light', 'var(--ink)')),
  color(variableDesktopScheme, backgroundDeclaration(variableMediaFixture, ['.promise-card:hover'], 'light')),
  variableDesktopScheme['--paper'],
) >= 4.5) {
  throw new Error('Variable self-check failed to retain a low-contrast desktop custom property');
}
activeViewportWidth = 620;
if (schemeVariables(variableMediaFixture, 'light')['--interactive-hover'] !== 'var(--paper)') {
  throw new Error('Variable self-check failed to apply the narrow custom property override');
}

const competingSelectorFixture = parseRules(`${css}\n.hero-actions .text-link { color: #777; }`);
try {
  assertNoCompetingPaint(competingSelectorFixture);
  throw new Error('Competing-selector self-check failed to reject contextual interaction paint');
} catch (error) {
  if (!error.message.startsWith('Unmodeled competing interaction paint')) throw error;
}

const results = [];
for (const schemeName of ['light', 'dark']) {
  const viewportResults = [];
  for (const viewportWidth of viewportWidths) {
    activeViewportWidth = viewportWidth;
    const scheme = schemeVariables(rules, schemeName);
    for (const [label, foregroundValue, backgroundValue, surfaceValue] of pairs) {
      const foreground = foregroundValue(schemeName, scheme);
      const background = backgroundValue(schemeName, scheme);
      const surface = surfaceValue(schemeName, scheme);
      viewportResults.push({ scheme: schemeName, state: label, ratio: contrast(foreground, background, surface), viewportWidth });
    }

    const navColor = color(scheme, declaration(rules, '.nav-group a:hover', 'color', schemeName));
    const authoredNavBackground = color(scheme, backgroundDeclaration(rules, ['.nav-group a:hover'], schemeName));
    viewportResults.push({ scheme: schemeName, state: 'hover: sidebar link', ratio: contrast(navColor, authoredNavBackground, scheme['--ground']), viewportWidth });
  }
  for (const state of new Set(viewportResults.map((result) => result.state))) {
    results.push(viewportResults.filter((result) => result.state === state).sort((a, b) => a.ratio - b.ratio)[0]);
  }
}

const diagramIds = [
  'm2-delivery-lifecycle', 'm6-review-gates', 'm5-model-routing', 'm1-convergence',
  'm7-skill-sync', 'm8-canary-evidence', 'm3-trust-ratchet', 'm10-anti-rollback',
  'm9-enrollment', 'm4-trust-boundaries',
];

function svgMediaRanges(svg) {
  return [...svg.matchAll(/@media\s*\(prefers-color-scheme:dark\)\s*\{/g)].map((match) => {
    const open = svg.indexOf('{', match.index);
    let depth = 0;
    for (let index = open; index < svg.length; index += 1) {
      if (svg[index] === '{') depth += 1;
      if (svg[index] === '}' && --depth === 0) return { start: match.index, end: index + 1, body: svg.slice(open + 1, index) };
    }
    throw new Error('Unclosed SVG dark-mode block');
  });
}

function svgMediaBlocks(svg) {
  return svgMediaRanges(svg).map(({ body }) => body);
}

function svgLightSource(svg) {
  let source = '';
  let cursor = 0;
  for (const { start, end } of svgMediaRanges(svg)) {
    source += svg.slice(cursor, start);
    cursor = end;
  }
  return source + svg.slice(cursor);
}

function svgHasClass(svg, className) {
  return new RegExp(`<[^>]+\\bclass="[^"]*\\b${className}\\b[^"]*"`).test(svg);
}

function svgClassFill(svg, className, schemeName) {
  if (!svgHasClass(svg, className)) throw new Error(`SVG class absent from markup: .${className}`);
  const pattern = new RegExp(`\\.${className}\\s*\\{[^}]*?\\bfill\\s*:\\s*([^;}]+)`);
  const light = svgLightSource(svg).match(pattern)?.[1];
  const dark = svgMediaBlocks(svg).map((block) => block.match(pattern)?.[1]).find(Boolean);
  if (!light) throw new Error(`Unresolved SVG light fill: .${className}`);
  if (!dark) throw new Error(`Unresolved SVG dark fill: .${className}`);
  return (schemeName === 'dark' ? dark : light).trim();
}

function svgSurfacePairs(svg, schemeName) {
  const surface = svgClassFill(svg, 'bg', schemeName);
  const backgrounds = [
    ['background', surface, surface],
    ['node', svgClassFill(svg, 'node', schemeName), surface],
  ];
  for (const optional of ['decision', 'actor', 'zone', 'attack-gate']) {
    if (svgHasClass(svg, optional)) backgrounds.push([optional, svgClassFill(svg, optional, schemeName), surface]);
  }
  return backgrounds;
}

for (const schemeName of ['light', 'dark']) {
  for (const id of diagramIds) {
    const svg = await readFile(new URL(`../public/diagrams/${id}.svg`, import.meta.url), 'utf8');
    const backgrounds = svgSurfacePairs(svg, schemeName);
    const textPairs = [
      ['label text', 'label', ['background', 'node', 'decision', 'actor', 'zone']],
      ['small text', 'small', ['background', 'node', 'zone']],
      ['step number', 'step-number', ['step-badge']],
      ['attack label', 'attack-label', ['attack-node']],
      ['attack gate text', 'attack-gate-label', ['attack-gate']],
    ];
    for (const [label, textClass, backgroundNames] of textPairs) {
      if (!svgHasClass(svg, textClass)) continue;
      const foreground = svgClassFill(svg, textClass, schemeName);
      const candidates = backgroundNames.flatMap((name) => backgrounds.filter(([surfaceName]) => surfaceName === name));
      if (textClass === 'step-number') candidates.push(['step-badge', svgClassFill(svg, 'step-badge', schemeName), svgClassFill(svg, 'bg', schemeName)]);
      if (textClass === 'attack-label') candidates.push(['attack-node', svgClassFill(svg, 'attack-node', schemeName), svgClassFill(svg, 'bg', schemeName)]);
      const worst = candidates.map(([surfaceName, background, base]) => ({
        scheme: schemeName,
        state: `diagram: ${id} ${label} on ${surfaceName}`,
        ratio: contrast(foreground, background, base),
        viewportWidth: 'SVG',
      })).sort((left, right) => left.ratio - right.ratio)[0];
      if (worst) results.push(worst);
    }
  }
}

function expectContrastFailure(label, operation) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`Contrast parser negative check did not fail: ${label}`);
}

expectContrastFailure('light lookup ignores dark-only rules', () => svgClassFill(
  '<svg><style>@media(prefers-color-scheme:dark){.only-dark{fill:#fff}}</style><rect class="only-dark"/></svg>',
  'only-dark',
  'light',
));
expectContrastFailure('dark lookup rejects a missing dark rule', () => svgClassFill(
  '<svg><style>.only-light{fill:#fff}</style><rect class="only-light"/></svg>',
  'only-light',
  'dark',
));
console.log('contrast parser negative checks=ok');

console.log('scheme\tstate\tworst viewport\tratio');
for (const result of results) console.log(`${result.scheme}\t${result.state}\t${result.viewportWidth === 'SVG' ? 'SVG' : `${result.viewportWidth}px`}\t${result.ratio.toFixed(2)}:1`);

const failures = results.filter(({ ratio }) => ratio < 4.5);
if (failures.length) {
  throw new Error(`Contrast below 4.5:1: ${failures.map(({ scheme, state, ratio }) => `${scheme} ${state} ${ratio.toFixed(2)}:1`).join(', ')}`);
}
