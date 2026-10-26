'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateReuse,
  generatePermissionDraft,
  processPermissionRequest,
  OUTCOMES,
} = require('../server/lib/permissionAssistant');

test('evaluateReuse: CC-BY permits non-commercial and commercial reuse with attribution', () => {
  const meta = {
    title: 'Open Deep Learning',
    publisher: 'Open Science Press',
    license: { type: 'CC-BY', name: 'Creative Commons Attribution (CC BY 4.0)' },
  };

  const res = evaluateReuse({
    sourceMeta: meta,
    materialType: 'figure',
    exactMaterial: 'Figure 3',
    intendedUse: 'research paper',
    commercial: false,
    modified: false,
  });

  assert.equal(res.outcome, OUTCOMES.PROCEED);
  assert.ok(res.conditions.some((c) => c.includes('CC BY')));
});

test('evaluateReuse: CC-BY-NC requires permission for commercial use, proceeds for educational use', () => {
  const meta = {
    title: 'Classroom Methods',
    publisher: 'Academic Press',
    license: { type: 'CC-BY-NC', name: 'Creative Commons Attribution-NonCommercial (CC BY-NC)' },
  };

  const eduRes = evaluateReuse({
    sourceMeta: meta,
    materialType: 'table',
    intendedUse: 'thesis',
    commercial: false,
  });
  assert.equal(eduRes.outcome, OUTCOMES.PROCEED);

  const commRes = evaluateReuse({
    sourceMeta: meta,
    materialType: 'table',
    intendedUse: 'commercial website',
    commercial: true,
  });
  assert.equal(commRes.outcome, OUTCOMES.PERMISSION_MAY_BE_REQUIRED);
  assert.ok(commRes.explanation.includes('Non-Commercial'));
});

test('evaluateReuse: CC-BY-ND requires permission if modified, proceeds if unmodified', () => {
  const meta = {
    title: 'Standard Guidelines',
    publisher: 'Health Institute',
    license: { type: 'CC-BY-ND', name: 'Creative Commons Attribution-NoDerivatives (CC BY-ND)' },
  };

  const unmodRes = evaluateReuse({
    sourceMeta: meta,
    materialType: 'figure',
    commercial: false,
    modified: false,
  });
  assert.equal(unmodRes.outcome, OUTCOMES.PROCEED);

  const modRes = evaluateReuse({
    sourceMeta: meta,
    materialType: 'figure',
    commercial: false,
    modified: true,
  });
  assert.equal(modRes.outcome, OUTCOMES.PERMISSION_MAY_BE_REQUIRED);
  assert.ok(modRes.explanation.includes('NoDerivatives'));
});

test('evaluateReuse: All Rights Reserved requires permission for figures/tables', () => {
  const meta = {
    title: 'Proprietary Journal Article',
    publisher: 'Elsevier',
    license: { type: 'ARR', name: 'All Rights Reserved / Standard Publisher Copyright' },
  };

  const figRes = evaluateReuse({
    sourceMeta: meta,
    materialType: 'figure',
    intendedUse: 'research paper',
    commercial: false,
  });
  assert.equal(figRes.outcome, OUTCOMES.PERMISSION_MAY_BE_REQUIRED);
  assert.ok(figRes.portalUrl.includes('elsevier.com'));

  // Short scholarly text quote can proceed under fair use
  const textRes = evaluateReuse({
    sourceMeta: meta,
    materialType: 'text',
    intendedUse: 'research paper',
    commercial: false,
  });
  assert.equal(textRes.outcome, OUTCOMES.PROCEED);
  assert.ok(textRes.conditions.some((c) => c.includes('proportional')));
});

test('evaluateReuse: Status Unclear when source/license cannot be identified', () => {
  const res = evaluateReuse({
    sourceMeta: null,
    materialType: 'text',
    intendedUse: 'commercial website',
    commercial: true,
  });
  assert.equal(res.outcome, OUTCOMES.STATUS_UNCLEAR);
  assert.ok(res.disclaimer.includes('guidance'));
});

test('generatePermissionDraft includes all required fields', () => {
  const draft = generatePermissionDraft({
    sourceTitle: 'Machine Learning Frontiers',
    sourceLink: 'https://doi.org/10.1000/ml.1',
    authors: 'Dr. Jane Doe, Dr. John Smith',
    publisher: 'Springer Nature',
    materialType: 'figure',
    exactMaterial: 'Figure 4, page 12',
    intendedUse: 'doctoral dissertation',
    audience: 'university faculty and academic readers',
    distribution: 'university digital repository and print copies',
    commercial: false,
    modified: true,
    userName: 'Alex Morgan',
    userAffiliation: 'Graduate School of Science',
    userEmail: 'alex@example.edu',
  });

  assert.ok(draft.includes('Machine Learning Frontiers'));
  assert.ok(draft.includes('Figure 4, page 12'));
  assert.ok(draft.includes('doctoral dissertation'));
  assert.ok(draft.includes('adapt/modify'));
  assert.ok(draft.includes('fees'));
  assert.ok(draft.includes('Alex Morgan'));
  assert.ok(draft.includes('alex@example.edu'));
  assert.ok(!draft.includes('Permission Granted'));
});

test('processPermissionRequest validates input and returns full package', async () => {
  const sources = require('../server/lib/sources');
  const realGet = sources.getSource;
  sources.getSource = async () => ({
    status: 'ok',
    meta: {
      title: 'Neurobiology Review',
      doi: '10.1016/j.neuro.2020.01.001',
      link: 'https://doi.org/10.1016/j.neuro.2020.01.001',
      publisher: 'Elsevier',
      license: { type: 'ARR', name: 'All Rights Reserved' },
    },
  });

  try {
    const res = await processPermissionRequest({
      sourceQuery: '10.1016/j.neuro.2020.01.001',
      materialType: 'table',
      exactMaterial: 'Table 2',
      intendedUse: 'journal article',
      commercial: false,
      modified: false,
      userName: 'Sam Researcher',
      userEmail: 'sam@university.edu',
    });

    assert.equal(res.source.title, 'Neurobiology Review');
    assert.equal(res.assessment.outcome, OUTCOMES.PERMISSION_MAY_BE_REQUIRED);
    assert.ok(res.assessment.portalUrl);
    assert.ok(res.requestDraft.includes('Table 2'));
    assert.ok(res.requestDraft.includes('Sam Researcher'));
  } finally {
    sources.getSource = realGet;
  }
});

test('evaluateReuse: thirdPartyCredit requires permission even if article is CC-BY', () => {
  const meta = {
    title: 'Open Source Advances',
    publisher: 'Nature Publishing Group',
    license: { type: 'CC-BY', name: 'Creative Commons Attribution (CC BY 4.0)' },
  };

  const res = evaluateReuse({
    sourceMeta: meta,
    materialType: 'figure',
    exactMaterial: 'Figure 2 (Adapted from Smith 2018)',
    commercial: false,
    modified: false,
    thirdPartyCredit: true,
  });

  assert.equal(res.outcome, OUTCOMES.PERMISSION_MAY_BE_REQUIRED);
  assert.ok(res.explanation.includes('third party'));
  assert.ok(res.conditions.some((c) => c.includes('third-party')));
});

test('processPermissionRequest: Nature Energy (ARR) vs NumPy (CC-BY) evaluates exact selected source without cross-contamination', async () => {
  const sources = require('../server/lib/sources');
  const realGet = sources.getSource;

  sources.getSource = async (ref) => {
    if (ref.doi === '10.1038/s41560-020-0566-0') {
      return {
        status: 'ok',
        sourceUsed: 'Official Crossref Work Metadata',
        meta: {
          title: 'The cost of uncoupling',
          doi: '10.1038/s41560-020-0566-0',
          link: 'https://doi.org/10.1038/s41560-020-0566-0',
          publisher: 'Springer Nature',
          license: {
            type: 'ARR',
            name: 'All Rights Reserved (Automated Text/Data Mining agreement only)',
            isTdmOnly: true,
          },
        },
      };
    }
    if (ref.doi === '10.1038/s41586-020-2649-2') {
      return {
        status: 'ok',
        sourceUsed: 'Official Crossref Work Metadata',
        meta: {
          title: 'Array programming with NumPy',
          doi: '10.1038/s41586-020-2649-2',
          link: 'https://doi.org/10.1038/s41586-020-2649-2',
          publisher: 'Springer Nature',
          license: {
            type: 'CC-BY',
            name: 'Creative Commons Attribution (CC BY 4.0)',
            url: 'https://creativecommons.org/licenses/by/4.0/',
          },
        },
      };
    }
    return { status: 'doi_not_found', notes: ['Not found'] };
  };

  try {
    // 1. Evaluate Nature Energy article
    const natureRes = await processPermissionRequest({
      sourceQuery: '10.1038/s41560-020-0566-0',
      materialType: 'figure',
      exactMaterial: 'Figure 1',
      intendedUse: 'research paper',
    });
    assert.equal(natureRes.canEvaluate, true);
    assert.equal(natureRes.source.title, 'The cost of uncoupling');
    assert.equal(natureRes.source.doi, '10.1038/s41560-020-0566-0');
    assert.equal(natureRes.source.license.type, 'ARR');
    assert.equal(natureRes.assessment.outcome, OUTCOMES.PERMISSION_MAY_BE_REQUIRED);
    assert.ok(natureRes.assessment.explanation.includes('All Rights Reserved'));
    assert.ok(natureRes.assessment.portalUrl);

    // 2. Evaluate NumPy article
    const numpyRes = await processPermissionRequest({
      sourceQuery: '10.1038/s41586-020-2649-2',
      materialType: 'figure',
      exactMaterial: 'Figure 1',
      intendedUse: 'research paper',
    });
    assert.equal(numpyRes.canEvaluate, true);
    assert.equal(numpyRes.source.title, 'Array programming with NumPy');
    assert.equal(numpyRes.source.doi, '10.1038/s41586-020-2649-2');
    assert.equal(numpyRes.source.license.type, 'CC-BY');
    assert.equal(numpyRes.assessment.outcome, OUTCOMES.PROCEED);
    assert.ok(numpyRes.assessment.explanation.includes('Creative Commons Attribution'));

    // Verify complete independence: neither data contaminated the other
    assert.notEqual(natureRes.source.title, numpyRes.source.title);
    assert.notEqual(natureRes.assessment.outcome, numpyRes.assessment.outcome);
  } finally {
    sources.getSource = realGet;
  }
});

test('processPermissionRequest: invalid DOI halts evaluation with canEvaluate: false', async () => {
  const sources = require('../server/lib/sources');
  const realGet = sources.getSource;
  sources.getSource = async () => ({
    status: 'doi_not_found',
    notes: ['Crossref has no record of DOI 10.9999/does-not-exist'],
  });

  try {
    const res = await processPermissionRequest({
      sourceQuery: '10.9999/does-not-exist',
      materialType: 'figure',
    });
    assert.equal(res.canEvaluate, false);
    assert.equal(res.status, 'unverified_source');
    assert.ok(res.error.message.includes('Could not verify source'));
    assert.equal(res.assessment, undefined);
  } finally {
    sources.getSource = realGet;
  }
});

test('processPermissionRequest: identity conflict halts evaluation with canEvaluate: false', async () => {
  const sources = require('../server/lib/sources');
  const realGet = sources.getSource;
  sources.getSource = async () => ({
    status: 'ok',
    identityConflict: true,
    notes: ['The DOI resolves to "Array programming with NumPy", which does not match "Unrelated Paper".'],
    meta: {
      title: 'Array programming with NumPy',
      doi: '10.1038/s41586-020-2649-2',
      license: { type: 'CC-BY', name: 'Creative Commons Attribution' },
    },
  });

  try {
    const res = await processPermissionRequest({
      sourceQuery: 'Unrelated Paper',
      materialType: 'figure',
    });
    assert.equal(res.canEvaluate, false);
    assert.equal(res.status, 'identity_conflict');
    assert.ok(res.error.message.includes('does not match the requested title'));
    assert.equal(res.assessment, undefined);
  } finally {
    sources.getSource = realGet;
  }
});

