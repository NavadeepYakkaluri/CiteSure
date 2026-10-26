'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkFormat } = require('../server/lib/formatChecker');

const types = (r) => r.issues.map((i) => i.type);
const find = (r, pred) => r.issues.find(pred);

function applyAll(text, issues) {
  let out = text;
  for (const i of [...issues].filter((x) => x.replacement !== null).sort((a, b) => b.start - a.start)) {
    out = out.slice(0, i.start) + i.replacement + out.slice(i.end);
  }
  return out;
}

const CLEAN_APA = `Learning improves with sleep (Walker, 2017, p. 12). Smith and Jones (2019) examined blended courses.

References

Smith, J., & Jones, K. (2019). Student outcomes in blended learning. Journal of Education, 12(3), 45–60. https://doi.org/10.1000/xyz123

Walker, M. (2017). Why we sleep. Scribner.
`;

test('APA: a clean document produces no issues', () => {
  const r = checkFormat(CLEAN_APA, 'apa');
  assert.deepEqual(r.issues.map((i) => `${i.type}:${i.problem}`), []);
  assert.equal(r.citations.length, 2);
  assert.equal(r.references.length, 2);
});

test('APA: missing reference entry and uncited reference are reported without inventing details', () => {
  const t = `Claim one (Nobody, 2021). Claim two (Walker, 2017).\n\nReferences\n\nWalker, M. (2017). Why we sleep. Scribner.\n\nUnused, A. (2010). Never cited work. Press.\n`;
  const r = checkFormat(t, 'apa');
  const miss = find(r, (i) => i.type === 'missing_reference');
  assert.ok(miss, 'missing reference reported');
  assert.equal(miss.replacement, null, 'no invented correction');
  assert.match(miss.fragment, /Nobody/);
  const unc = find(r, (i) => i.type === 'uncited_reference');
  assert.ok(unc);
  assert.match(unc.fragment, /Unused/);
});

test('APA: citation year / author that do not match the bibliography', () => {
  const t = `Study A (Walker, 2018). Study B (Smyth & Jones, 2019).\n\nReferences\n\nSmith, J., & Jones, K. (2019). Student outcomes. Journal of Education, 12(3), 45–60.\n\nWalker, M. (2017). Why we sleep. Scribner.\n`;
  const r = checkFormat(t, 'apa');
  const date = find(r, (i) => i.type === 'date');
  assert.ok(date);
  assert.equal(date.fragment, '2018');
  assert.equal(date.replacement, '2017');
  const author = find(r, (i) => i.type === 'author' && i.fragment === 'Smyth');
  assert.ok(author, 'misspelled author detected');
  assert.equal(author.replacement, 'Smith');
});

test('APA: in-text punctuation (& vs and, comma before year, et al., page label)', () => {
  const t = `A (Smith and Jones, 2019). B (Smith & Jones 2019). C Smith & Jones (2019) said. D (Smith & Jones, 2019, 45).\n\nReferences\n\nSmith, J., & Jones, K. (2019). Student outcomes. Journal of Education, 12(3), 45–60.\n`;
  const r = checkFormat(t, 'apa');
  assert.ok(find(r, (i) => i.fragment === 'and' && i.replacement === '&'));
  assert.ok(find(r, (i) => i.replacement === ', ' && i.type === 'punctuation'));
  assert.ok(find(r, (i) => i.fragment === '&' && i.replacement === 'and'), 'narrative uses "and"');
  assert.ok(find(r, (i) => i.fragment === '45' && i.replacement === 'p. 45'));
});

test('APA: reference formatting (initials, &, year parentheses, DOI form, trailing period)', () => {
  const t = `x (Smith, 2019).\n\nReferences\n\nSmith, John, and Jones, Kate. 2019. Student outcomes in schools. Journal of Education, 12(3), 45–60. doi:10.1000/xyz123.\n`;
  const r = checkFormat(t, 'apa');
  const out = applyAll(t, r.issues);
  assert.match(out, /Smith, J\., & Jones, K\. \(2019\)\./);
  assert.match(out, /https:\/\/doi\.org\/10\.1000\/xyz123$/m);
  assert.ok(types(r).includes('doi_url'));
});

test('APA: missing year / title / source are reported, never guessed', () => {
  const t = `x (Smith, 2019).\n\nReferences\n\nSmith, J. Student outcomes.\n`;
  const r = checkFormat(t, 'apa');
  const mi = r.issues.filter((i) => i.type === 'missing_info');
  assert.ok(mi.some((i) => /year/i.test(i.problem)));
  assert.ok(mi.every((i) => i.replacement === null));
});

test('APA: DOI without a valid pattern is flagged for manual repair', () => {
  const t = `x (Smith, 2019).\n\nReferences\n\nSmith, J. (2019). Title of work here. Journal, 1(1), 1–2. DOI: abc\n`;
  const r = checkFormat(t, 'apa');
  const d = find(r, (i) => i.type === 'doi_url');
  assert.ok(d);
  assert.equal(d.replacement, null);
});

test('Quotations: no citation, no page number, period placement, unbalanced marks', () => {
  const t = [
    'He said "the quick brown fox jumps over the lazy dog today" and left.',
    '',
    'Another says "learning requires sleep and rest for memory" (Walker, 2017).',
    '',
    'Third: "sleep is a foundation for memory formation in humans." (Walker, 2017, p. 3)',
    '',
    'Broken "quote here.',
    '',
    'References',
    '',
    'Walker, M. (2017). Why we sleep. Scribner.',
  ].join('\n');
  const r = checkFormat(t, 'apa');
  const q = r.issues.filter((i) => i.type === 'quotation');
  assert.ok(q.some((i) => /without a citation/.test(i.problem)));
  assert.ok(q.some((i) => /page or paragraph/.test(i.problem)));
  assert.ok(q.some((i) => /Unbalanced/.test(i.problem)));
  const p = r.issues.find((i) => i.type === 'punctuation' && /period goes after/.test(i.problem));
  assert.ok(p);
  assert.match(p.replacement, /^” ?\(Walker, 2017, p\. 3\)\.$|^"\s?\(Walker, 2017, p\. 3\)\.$/);
});

test('MLA: author-page citations, year removal, Works Cited rules', () => {
  const t = `As argued (Smith 2019, 45) and (Smith, 12) and (Smith & Doe 7).\n\nWorks Cited\n\nSmith, John, and Jane Doe. "Student Outcomes." Journal of Education, vol. 12, no. 3, 2019, pp. 45-60.\n`;
  const r = checkFormat(t, 'mla');
  assert.ok(r.issues.some((i) => i.type === 'date' && i.fragment.includes('2019')), 'year removed in MLA');
  assert.ok(r.issues.some((i) => i.replacement === ' 12'), 'comma before page removed');
  assert.ok(r.issues.some((i) => i.fragment === '&' && i.replacement === 'and'));
  // Works Cited: quote/period + final period are present => no punctuation issues on the entry itself
  assert.equal(r.issues.filter((i) => i.location === 'reference').length, 0);
});

test('MLA: Works Cited entry problems', () => {
  const t = `(Smith 45)\n\nWorks Cited\n\nSmith, J. (2019). "Student Outcomes". Journal of Education. Retrieved from https://example.org/a\n`;
  const r = checkFormat(t, 'mla');
  const refIssues = r.issues.filter((i) => i.location === 'reference');
  assert.ok(refIssues.some((i) => i.type === 'date' && /parentheses/.test(i.problem)));
  assert.ok(refIssues.some((i) => i.type === 'doi_url' && /Retrieved from/.test(i.problem)));
  assert.ok(refIssues.some((i) => /end with a period/.test(i.problem)));
});

test('Chicago author-date: comma before year, page label, bibliography year placement', () => {
  const t = `As shown (Smith, 2019, p. 45).\n\nBibliography\n\nSmith, John. (2019). Student Outcomes. Chicago: Press.\n`;
  const r = checkFormat(t, 'chicago');
  assert.ok(r.issues.some((i) => i.type === 'punctuation' && i.replacement === ' ' && /comma/.test(i.problem)));
  assert.ok(r.issues.some((i) => i.fragment === 'p. 45' && i.replacement === '45'));
  assert.ok(r.issues.some((i) => /parentheses/.test(i.problem) && i.location === 'reference'));
});

test('No reference list: every citation is reported missing and a warning is shown', () => {
  const r = checkFormat('A claim is made here about learning (Walker, 2017) and more text follows it here.', 'apa');
  assert.equal(r.issues.filter((i) => i.type === 'missing_reference').length, 1);
  assert.ok(r.warnings.some((w) => /No reference list/.test(w)));
});

test('Every issue has an exact span that matches its fragment and context', () => {
  const t = require('fs').readFileSync(__dirname + '/fixtures/sample-apa.txt', 'utf8');
  const r = checkFormat(t, 'apa');
  for (const i of r.issues) {
    assert.equal(t.slice(i.start, i.end), i.fragment);
    assert.ok(i.context.includes(i.fragment));
    assert.equal(t.slice(i.ctxOffset, i.ctxOffset + i.context.length), i.context);
  }
});
