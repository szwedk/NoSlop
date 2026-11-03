// Golden-set gate (docs/DESIGN.md §5): human.json hide = 0 and dim <= 2 %; ai.json labelled/disclosed/hashtag/tool/residue hide >= 95 %.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
// Values produced inside the jsdom vm context have another realm's prototypes; compare structurally.
const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);
import fs from 'node:fs';
import path from 'node:path';
import { loadScripts, CORE_FILES, ROOT } from './helpers/load.mjs';

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/corpus', f), 'utf8'));
const GATED = ['labelled', 'disclosed', 'hashtag', 'tool', 'residue', 'prompt'];

let NoSlop, ai, human, defaults;
before(async () => {
  ({ NoSlop } = await loadScripts(CORE_FILES));
  ai = read('ai.json'); human = read('human.json');
  defaults = NoSlop.defaultSettings();
});

function settingsFor(mode) {
  const s = JSON.parse(JSON.stringify(defaults));
  for (const k of Object.keys(s.sites)) s.sites[k].mode = mode;
  return s;
}
function run(items, mode) {
  const s = settingsFor(mode);
  return items.map((it) => ({ it, v: NoSlop.scorer.score(it, NoSlop.rules, s, it.site || 'x') }));
}
const describeItem = (r) => `[${r.it.category}] ${r.v.action} ${r.v.score} ${r.v.reasons.join(',')} :: ${(r.it.title ? r.it.title + ' / ' : '') + String(r.it.text).slice(0, 90).replace(/\n/g, ' ')}`;

describe('corpus shape', () => {
  test('ai.json has >= 200 items across all categories with the required fields', () => {
    assert.ok(ai.length >= 200, 'ai items: ' + ai.length);
    const cats = new Set(ai.map((i) => i.category));
    for (const c of [...GATED, 'style']) assert.ok(cats.has(c), 'missing category ' + c);
    for (const i of ai) { assert.equal(typeof i.text, 'string'); assert.ok(['hide', 'dim', 'none', 'not_hide'].includes(i.expect)); }
    assert.ok(ai.filter((i) => i.category === 'labelled').every((i) => Array.isArray(i.labels) && i.labels.length));
  });
  test('human.json has >= 200 realistic items incl. short, emoji, caps, non-English and AI mentions', () => {
    assert.ok(human.length >= 200, 'human items: ' + human.length);
    const texts = human.map((i) => i.text);
    assert.ok(texts.filter((t) => t.split(/\s+/).length <= 3).length >= 15, 'short posts');
    assert.ok(texts.filter((t) => /\p{Extended_Pictographic}/u.test(t)).length >= 10, 'emoji posts');
    assert.ok(texts.filter((t) => t.length > 12 && t === t.toUpperCase() && /[A-Z]/.test(t)).length >= 5, 'ALL CAPS posts');
    assert.ok(texts.some((t) => /pierogi|Krakowie|Tatrach/.test(t)), 'Polish');
    assert.ok(texts.some((t) => /abuelo|paella|Sevilla/.test(t)), 'Spanish');
    assert.ok(texts.some((t) => /Steuererklärung|Verspätung|Bäcker/.test(t)), 'German');
    assert.ok(texts.filter((t) => /\bAI\b|ChatGPT|Midjourney|Grok|Copilot/i.test(t)).length >= 15, 'posts that mention AI');
    assert.ok(texts.filter((t) => /\n/.test(t)).length >= 5, 'lists');
    for (const i of human) assert.ok(['none', 'not_hide'].includes(i.expect));
  });
});

describe('gate: human corpus', () => {
  for (const mode of ['balanced', 'strict']) {
    test(`${mode}: hide = 0`, () => {
      const bad = run(human, mode).filter((r) => r.v.action === 'hide');
      assert.equal(bad.length, 0, 'hidden human posts:\n' + bad.map(describeItem).join('\n'));
    });
  }
  test('balanced: dim <= 2 %', () => {
    const rs = run(human, 'balanced');
    const dim = rs.filter((r) => r.v.action === 'dim');
    assert.ok(dim.length / rs.length <= 0.02, `dimmed ${dim.length}/${rs.length}:\n` + dim.map(describeItem).join('\n'));
  });
  test('posts that merely mention AI are not hidden in either mode', () => {
    const mentions = human.filter((i) => /\bAI\b|ChatGPT|Midjourney|Grok|Sora|Copilot/i.test(i.text));
    assert.ok(mentions.length >= 15);
    for (const mode of ['balanced', 'strict']) for (const r of run(mentions, mode)) assert.notEqual(r.v.action, 'hide', mode + ' ' + describeItem(r));
  });
});

describe('gate: ai corpus', () => {
  test('balanced: labelled / disclosed / hashtag / tool / residue / prompt hide >= 95 % each and overall', () => {
    const rs = run(ai.filter((i) => GATED.includes(i.category)), 'balanced');
    const total = rs.length, hidden = rs.filter((r) => r.v.action === 'hide').length;
    const misses = rs.filter((r) => r.v.action !== 'hide');
    assert.ok(hidden / total >= 0.95, `overall ${hidden}/${total}:\n` + misses.map(describeItem).join('\n'));
    for (const c of GATED) {
      const sub = rs.filter((r) => r.it.category === c);
      const h = sub.filter((r) => r.v.action === 'hide').length;
      assert.ok(h / sub.length >= 0.95, `${c}: ${h}/${sub.length}\n` + sub.filter((r) => r.v.action !== 'hide').map(describeItem).join('\n'));
    }
  });
  test('labelled items hide at 100 % (tier 0 is exact)', () => {
    const rs = run(ai.filter((i) => i.category === 'labelled'), 'balanced');
    assert.ok(rs.every((r) => r.v.action === 'hide' && r.v.tier === 0), rs.filter((r) => r.v.action !== 'hide').map(describeItem).join('\n'));
  });
  test('strict is never weaker than balanced on the ai corpus', () => {
    const b = run(ai, 'balanced'), s = run(ai, 'strict');
    const rank = { none: 0, dim: 1, hide: 2 };
    b.forEach((r, i) => assert.ok(rank[s[i].v.action] >= rank[r.v.action], describeItem(r)));
  });
  test('style-only slop dims (never hides) in >= 60 % of style items', () => {
    const rs = run(ai.filter((i) => i.category === 'style'), 'balanced');
    assert.ok(rs.every((r) => r.v.action !== 'hide'), 'style must never hide:\n' + rs.filter((r) => r.v.action === 'hide').map(describeItem).join('\n'));
    const dim = rs.filter((r) => r.v.action === 'dim').length;
    assert.ok(dim / rs.length >= 0.6, `style dim ${dim}/${rs.length}:\n` + rs.filter((r) => r.v.action === 'none').map(describeItem).join('\n'));
  });
  test('per-item expectations: expect:none / not_hide / dim are honoured (hide checked by the 95 % gate)', () => {
    for (const r of run(ai, 'balanced')) {
      if (r.it.expect === 'none') assert.equal(r.v.action, 'none', describeItem(r));
      if (r.it.expect === 'not_hide') assert.notEqual(r.v.action, 'hide', describeItem(r));
    }
  });
  test('dimInsteadOfHide downgrades every hide to dim', () => {
    const s = settingsFor('balanced'); s.dimInsteadOfHide = true;
    for (const it of ai) assert.notEqual(NoSlop.scorer.score(it, NoSlop.rules, s, it.site || 'x').action, 'hide');
  });
  test('mode off hides nothing', () => {
    for (const r of run(ai, 'off')) assert.equal(r.v.action, 'none');
  });
});
