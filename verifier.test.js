'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sources = require('../server/lib/sources');
const llm = require('../server/lib/llm');
const { verifyClaim, extractClaims, heuristicVerdict, rankPassages } = require('../server/lib/verifier');
const { checkFormat } = require('../server/lib/formatChecker');

// ---- mock network ---------------------------------------------------------
const realFetch = sources.deps.fetch;
const realAssert = sources.deps.assertPublicHost;
const realLlmFetch = llm.deps.fetch;
const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const html = (body) => new Response(`<html><head><title>Paper</title></head><body><p>${body}</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });

const FULLTEXT = (
  'Sleep deprivation impairs memory consolidation in adolescents. In our sample of 240 students, 62% of participants who slept under six hours showed lower recall scores than controls. ' +
  'The effect may be mediated by reduced hippocampal activity, although causality cannot be established from these correlational data. ' +
  'Participants were recruited from three schools and tested over two semesters. '
).repeat(1) + 'Further methodological detail follows. '.repeat(150);

function install({ crossref, openalex, content, fail } = {}) {
  sources._cache.clear();
  sources.deps.assertPublicHost = async () => {};
  sources.deps.fetch = async (url) => {
    const u = String(url);
    if (fail) throw new Error('network down');
    if (u.includes('api.crossref.org/works/')) return crossref ? json({ message: crossref }) : json({}, 404);
    if (u.includes('api.crossref.org/works?')) return json({ message: { items: [] } });
    if (u.includes('api.openalex.org')) return openalex ? json(openalex) : json({}, 404);
    if (u.startsWith('https://oa.example.org/')) return content ? html(content) : new Response('', { status: 403 });
    return json({}, 404);
  };
}
test.afterEach(() => {
  sources.deps.fetch = realFetch;
  sources.deps.assertPublicHost = realAssert;
  llm.deps.fetch = realLlmFetch;
  KEYS.forEach((k) => delete process.env[k]);
});

const REF = { raw: 'Lee, A. (2020). Sleep and memory. Journal of Sleep, 3(1), 1–10. https://doi.org/10.1000/sleep.1', title: 'Sleep and memory', year: '2020', doi: '10.1000/sleep.1', authors: [{ family: 'Lee' }] };
const CROSSREF = { DOI: '10.1000/sleep.1', title: ['Sleep and memory'], author: [{ given: 'A', family: 'Lee' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['Journal of Sleep'], type: 'journal-article', publisher: 'X' };
const OPENALEX_OA = { abstract_inverted_index: null, open_access: { is_oa: true, oa_url: 'https://oa.example.org/lee.html' }, best_oa_location: { is_oa: true, landing_page_url: 'https://oa.example.org/lee.html' }, locations: [] };

// ---- tests ------------------------------------------------------------------

test('Successful case: supported claim has a verbatim excerpt, source title and link', async () => {
  install({ crossref: CROSSREF, openalex: OPENALEX_OA, content: FULLTEXT });
  const r = await verifyClaim({ claim: 'Sleep deprivation impairs memory consolidation in adolescents.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(r.verdict, 'Supported');
  assert.equal(r.source.title, 'Sleep and memory');
  assert.equal(r.source.link, 'https://doi.org/10.1000/sleep.1');
  assert.equal(r.source.accessLevel, 'full_text');
  assert.ok(r.evidence.length >= 1);
  for (const e of r.evidence) assert.ok(FULLTEXT.includes(e.text), 'excerpt must be a verbatim substring of the source');
  assert.equal(r.mode, 'heuristic');
  assert.match(r.explanation, /no LLM configured/);
});

test('Incorrect number: wrong percentage against retrieved text => Mismatched with incorrect_number', async () => {
  install({ crossref: CROSSREF, openalex: OPENALEX_OA, content: FULLTEXT });
  const r = await verifyClaim({ claim: 'In a sample of students, 95% of participants who slept under six hours showed lower recall scores than controls.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(r.verdict, 'Mismatched');
  assert.ok(r.issues.includes('incorrect_number'));
  assert.match(r.explanation, /95%/);
  assert.match(r.explanation, /62%/);
  assert.ok(r.evidence.every((e) => FULLTEXT.includes(e.text)));
});

test('Overgeneralization / exaggeration are flagged as Weakly Supported (not Supported)', async () => {
  install({ crossref: CROSSREF, openalex: OPENALEX_OA, content: FULLTEXT });
  const r = await verifyClaim({ claim: 'Sleep deprivation always causes memory consolidation failure in adolescents.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(r.verdict, 'Weakly Supported');
  assert.ok(r.issues.includes('overgeneralization') || r.issues.includes('exaggeration'));
});

test('Inaccessible source (paywalled, no abstract) is Unverifiable, never Mismatched', async () => {
  install({ crossref: CROSSREF, openalex: { abstract_inverted_index: null, open_access: { is_oa: false }, locations: [] } });
  const r = await verifyClaim({ claim: 'Sleep deprivation impairs memory consolidation in adolescents.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(r.verdict, 'Unverifiable');
  assert.equal(r.source.accessLevel, 'none');
  assert.match(r.explanation, /DOI or title alone/);
  assert.equal(r.evidence.length, 0);
});

test('Open-access link that returns 403 is Unverifiable and the failure is reported', async () => {
  install({ crossref: CROSSREF, openalex: OPENALEX_OA, content: null });
  const r = await verifyClaim({ claim: 'Sleep deprivation impairs memory.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(r.verdict, 'Unverifiable');
  assert.ok(r.source.notes.some((n) => /oa\.example\.org/.test(n)));
});

test('Abstract-only: topic not addressed => Unverifiable, not Mismatched', async () => {
  const abstract = { 'Sleep': [0], 'studies': [1], 'are': [2], 'popular': [3], 'in': [4], 'psychology': [5], 'and': [6], 'neuroscience': [7], 'research': [8], 'worldwide': [9], 'today': [10], 'with': [11], 'many': [12], 'labs': [13], 'involved': [14], 'across': [15], 'several': [16], 'countries': [17], 'and': [18] };
  abstract['continents'] = [19]; abstract['for'] = [20]; abstract['decades'] = [21]; abstract['now'] = [22]; abstract['continuing'] = [23]; abstract['to'] = [24]; abstract['grow'] = [25]; abstract['rapidly'] = [26]; abstract['each'] = [27]; abstract['year'] = [28];
  abstract['as'] = [29]; abstract['funding'] = [30]; abstract['expands'] = [31]; abstract['broadly'] = [32]; abstract['everywhere'] = [33]; abstract['globally'] = [34];
  install({ crossref: CROSSREF, openalex: { abstract_inverted_index: abstract, open_access: { is_oa: false }, locations: [] } });
  const r = await verifyClaim({ claim: 'Caffeine consumption reduces tax revenue in coastal municipalities.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(r.verdict, 'Unverifiable');
  assert.equal(r.source.accessLevel, 'abstract');
});

test('DOI not found in Crossref => Unverifiable with explanation', async () => {
  install({ crossref: null });
  const r = await verifyClaim({ claim: 'A claim about sleep and memory in teenagers.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(r.verdict, 'Unverifiable');
  assert.match(r.explanation, /not found in Crossref/);
});

test('DOI resolving to a different work than the reference => Unverifiable (identity conflict)', async () => {
  install({ crossref: { ...CROSSREF, title: ['Quantum chromodynamics on the lattice'] }, openalex: OPENALEX_OA, content: FULLTEXT });
  const r = await verifyClaim({ claim: 'Sleep deprivation impairs memory consolidation in adolescents.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(r.verdict, 'Unverifiable');
  assert.match(r.explanation, /different work/);
});

test('Service outage is reported as such, not as a verdict about the claim', async () => {
  install({ fail: true });
  const r = await verifyClaim({ claim: 'A claim about sleep and memory in teenagers.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(r.verdict, 'Unverifiable');
  assert.match(r.explanation, /could not be reached/);
  assert.equal(r.confidence, 'low');
});

test('Citation with no reference entry => Unverifiable', async () => {
  const r = await verifyClaim({ claim: 'A claim about something here.', citation: '(Nobody, 2021)', reference: null });
  assert.equal(r.verdict, 'Unverifiable');
  assert.match(r.explanation, /no matching entry/);
});

test('Reference without DOI is looked up by Crossref search and only accepted on a confident match', async () => {
  install({ crossref: null });
  const r = await verifyClaim({ claim: 'A claim about student outcomes in blended learning.', citation: '(Smith, 2019)', reference: { raw: 'Smith, J. (2019). Student outcomes in blended learning. J Ed.', title: 'Student outcomes in blended learning', year: '2019', authors: [{ family: 'Smith' }] } });
  assert.equal(r.verdict, 'Unverifiable');
  assert.match(r.explanation, /could not be identified/);
});

// ---- LLM mode ----------------------------------------------------------------

test('LLM mode: verbatim quotes are kept, fabricated quotes are dropped and the verdict downgraded', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  install({ crossref: CROSSREF, openalex: OPENALEX_OA, content: FULLTEXT });
  const real = 'In our sample of 240 students, 62% of participants who slept under six hours showed lower recall scores than controls.';
  llm.deps.fetch = async () => json({ choices: [{ message: { content: JSON.stringify({ verdict: 'Supported', confidence: 'high', issues: [], explanation: 'Direct match.', evidence_quotes: [real] }) } }] });
  const ok = await verifyClaim({ claim: 'About 62% of short sleepers had lower recall.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(ok.mode, 'llm');
  assert.equal(ok.verdict, 'Supported');
  assert.equal(ok.evidence[0].text, real);

  llm.deps.fetch = async () => json({ choices: [{ message: { content: JSON.stringify({ verdict: 'Supported', confidence: 'high', issues: [], explanation: 'Looks right.', evidence_quotes: ['This sentence does not appear in the paper at all, honest.'] }) } }] });
  const fake = await verifyClaim({ claim: 'About 62% of short sleepers had lower recall.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(fake.verdict, 'Unverifiable');
  assert.equal(fake.evidence.length, 0);
  assert.match(fake.explanation, /Downgraded/);
});

test('LLM mode: Mismatched with contradiction is allowed; LLM failure falls back to heuristic and says so', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  install({ crossref: CROSSREF, openalex: OPENALEX_OA, content: FULLTEXT });
  llm.deps.fetch = async () => json({ choices: [{ message: { content: JSON.stringify({ verdict: 'Mismatched', confidence: 'medium', issues: ['contradiction'], explanation: 'Source says the opposite.', evidence_quotes: [] }) } }] });
  const m = await verifyClaim({ claim: 'Sleep deprivation improves memory.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(m.verdict, 'Mismatched');
  assert.deepEqual(m.issues, ['contradiction']);

  llm.deps.fetch = async () => new Response('boom', { status: 500 });
  const f = await verifyClaim({ claim: 'Sleep deprivation impairs memory consolidation in adolescents.', citation: '(Lee, 2020)', reference: REF });
  assert.equal(f.mode, 'heuristic');
  assert.match(f.explanation, /LLM comparison failed/);
});

// ---- extraction of claims ------------------------------------------------------

test('extractClaims links sentences to citations and reference entries, and flags uncited statistics', () => {
  const t = `Sleep matters a great deal for students. Smith and Jones (2019) found that 45% of students improved. Brown (2020) claimed something remarkable about models today. About 80% of researchers read abstracts only.\n\nReferences\n\nSmith, J., & Jones, K. (2019). Student outcomes in blended learning. Journal of Education, 12(3), 45–60.\n`;
  const f = checkFormat(t, 'apa');
  const { claims, uncited } = extractClaims(t, f.bodyEnd, f.citations);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].refIndex, 0);
  assert.match(claims[0].cleanClaim, /Smith and Jones found that 45% of students improved\./);
  assert.equal(claims[1].refIndex, null);
  assert.equal(uncited.length, 1);
  assert.match(uncited[0].sentence, /80%/);
});

test('heuristic never labels a claim Supported when no relevant passage exists', () => {
  const ranked = rankPassages('Totally unrelated claim about volcanoes erupting frequently.', FULLTEXT, 6);
  const r = heuristicVerdict('Totally unrelated claim about volcanoes erupting frequently.', ranked, 'full_text');
  assert.equal(r.verdict, 'Unverifiable');
  assert.equal(r.evidence.length, 0);
});
