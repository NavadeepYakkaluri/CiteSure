'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSafety, CLASSIFICATIONS, findFigureAndTableMentions, findLongQuotes } = require('../server/lib/safetyChecker');

test('findFigureAndTableMentions identifies figures, tables, and provenance statements', () => {
  const text = `
    In our analysis, Table 1 displays the demographic characteristics.
    Figure 2: Adapted from Smith (2020) illustrates the cellular pathway.
    Chart 3 shows the growth over time.
  `;
  const items = findFigureAndTableMentions(text);
  assert.equal(items.length, 3);
  assert.equal(items[0].label, 'Table 1');
  assert.equal(items[0].hasProvenance, false);
  assert.equal(items[1].label, 'Figure 2');
  assert.equal(items[1].hasProvenance, true);
  assert.equal(items[2].label, 'Figure 3'); // Chart maps to Figure/visual
});

test('findLongQuotes flags block quotes over threshold', () => {
  const shortText = 'The author stated "this is a very brief quotation." and moved on.';
  assert.equal(findLongQuotes(shortText).length, 0);

  const longQuote =
    'As noted in the manifesto: "We hold that scientific discovery must be shared freely with the entire global community without artificial paywalls or barriers that restrict the dissemination of knowledge across geographic boundaries, educational institutions, or socioeconomic strata, and that every student deserves unrestricted access to fundamental human discoveries regardless of their ability to pay excessive commercial subscription fees." (Smith, 2020)';
  const quotes = findLongQuotes(longQuote);
  assert.equal(quotes.length, 1);
  assert.ok(quotes[0].wordCount >= 45);
});

test('checkSafety flags adapted figure as Permission May Be Required', async () => {
  const text = 'Figure 1: Adapted from Smith (2020) shows the architecture.';
  const res = await checkSafety(text, { references: [] });
  const fig = res.findings.find((f) => f.category === 'copyright_risk' && f.snippet.includes('Figure 1'));
  assert.ok(fig);
  assert.equal(fig.classification, CLASSIFICATIONS.PERMISSION_REQUIRED);
  assert.equal(fig.severity, 'high');
  assert.ok(fig.recommendation.includes('original publication'));
  assert.ok(fig.permissionPrefill);
  assert.equal(fig.permissionPrefill.materialType, 'figure');
});

test('checkSafety flags missing attribution for uncited statistical claim', async () => {
  const text = 'Research shows that 95% of participants experienced positive outcomes.';
  const res = await checkSafety(text, {
    uncitedClaims: [{ sentence: 'Research shows that 95% of participants experienced positive outcomes.', reason: 'contains a statistic' }],
  });
  const uncited = res.findings.find((f) => f.category === 'missing_attribution');
  assert.ok(uncited);
  assert.equal(uncited.classification, CLASSIFICATIONS.ATTRIBUTION_ATTENTION);
  assert.equal(uncited.severity, 'high');
  assert.ok(uncited.recommendation.includes('Add an explicit in-text citation'));
});

test('checkSafety identifies CC-BY as Likely Permitted with attribution notice', async () => {
  const text = 'A clean paper.';
  const references = [
    {
      title: 'Open Science Today',
      doi: '10.1371/journal.pone.0000000',
      raw: 'Author, A. (2021). Open Science Today. PLOS ONE.',
    },
  ];
  // PLOS is recognized as CC-BY
  const res = await checkSafety(text, { references });
  const licFinding = res.findings.find((f) => f.category === 'licence_restriction');
  assert.ok(licFinding);
  assert.equal(licFinding.classification, CLASSIFICATIONS.PERMITTED);
  assert.ok(licFinding.recommendation.includes('reproduced from'));
});

test('checkSafety identifies CC-BY-NC licence restriction for commercial use', async () => {
  const text = 'A clean paper.';
  const references = [
    {
      title: 'Educational Technology Study',
      doi: '10.1000/nc.1',
      raw: 'Author, B. (2022). Educational Technology Study.',
    },
  ];
  // Test with mock metadata returning CC-BY-NC
  const sources = require('../server/lib/sources');
  const realGet = sources.getSource;
  sources.getSource = async () => ({
    status: 'ok',
    meta: {
      title: 'Educational Technology Study',
      doi: '10.1000/nc.1',
      publisher: 'Noncommercial Press',
      license: { type: 'CC-BY-NC', name: 'Creative Commons Attribution-NonCommercial (CC BY-NC)' },
    },
  });

  try {
    const res = await checkSafety(text, { references });
    const ncFinding = res.findings.find((f) => f.snippet.includes('CC BY-NC'));
    assert.ok(ncFinding);
    assert.equal(ncFinding.classification, CLASSIFICATIONS.ATTRIBUTION_ATTENTION);
    assert.ok(ncFinding.explanation.includes('commercial'));
  } finally {
    sources.getSource = realGet;
  }
});

test('checkSafety identifies CC-BY-ND licence restriction for derivatives', async () => {
  const text = 'A clean paper.';
  const references = [
    {
      title: 'Strict Report',
      doi: '10.1000/nd.1',
      raw: 'Author, C. (2023). Strict Report.',
    },
  ];
  const sources = require('../server/lib/sources');
  const realGet = sources.getSource;
  sources.getSource = async () => ({
    status: 'ok',
    meta: {
      title: 'Strict Report',
      doi: '10.1000/nd.1',
      publisher: 'Policy Institute',
      license: { type: 'CC-BY-ND', name: 'Creative Commons Attribution-NoDerivatives (CC BY-ND)' },
    },
  });

  try {
    const res = await checkSafety(text, { references });
    const ndFinding = res.findings.find((f) => f.snippet.includes('CC BY-ND'));
    assert.ok(ndFinding);
    assert.equal(ndFinding.classification, CLASSIFICATIONS.PERMISSION_REQUIRED);
    assert.ok(ndFinding.explanation.includes('NoDerivatives'));
  } finally {
    sources.getSource = realGet;
  }
});

test('checkSafety detects unquoted verbatim overlap as plagiarism concern', async () => {
  const sentence = 'In our sample of 240 students sixty two percent showed lower recall scores than controls in the trial.';
  const text = `Introduction\n\n${sentence} (Walker, 2017).\n\nReferences\n\nWalker, M. (2017). Sleep Study.`;
  const references = [{ index: 0, title: 'Sleep Study', doi: '10.1000/sleep.1' }];
  const claims = [{ sentence, citation: '(Walker, 2017)', refIndex: 0 }];

  const sources = require('../server/lib/sources');
  const realGet = sources.getSource;
  sources.getSource = async () => ({
    status: 'ok',
    meta: { title: 'Sleep Study', doi: '10.1000/sleep.1' },
    content: {
      text: 'Background: In our sample of 240 students sixty two percent showed lower recall scores than controls in the trial conducted across semesters.',
    },
  });

  try {
    const res = await checkSafety(text, { references, claims });
    const plag = res.findings.find((f) => f.category === 'plagiarism_concern');
    assert.ok(plag, 'verbatim text without quotes must be flagged as plagiarism concern');
    assert.equal(plag.severity, 'high');
    assert.ok(plag.explanation.includes('patchwriting'));
    assert.ok(plag.recommendation.includes('independently rewrite'));
  } finally {
    sources.getSource = realGet;
  }
});
