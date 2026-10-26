'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TYPE_LABELS = {
    missing_reference: 'Missing reference',
    uncited_reference: 'Uncited reference',
    citation_mismatch: 'Citation mismatch',
    author: 'Author name',
    date: 'Date',
    punctuation: 'Punctuation',
    reference_format: 'Reference format',
    missing_info: 'Missing details',
    doi_url: 'DOI / URL',
    quotation: 'Quotation',
  };
  const PROBLEM_LABELS = {
    incorrect_number: 'Incorrect number',
    overgeneralization: 'Overgeneralization',
    exaggeration: 'Exaggeration',
    contradiction: 'Contradiction',
    unsupported: 'Unsupported',
  };
  const VERDICT_CLASS = { Supported: 'good', 'Weakly Supported': 'warn', Mismatched: 'bad', Unverifiable: 'neutral' };
  const VERDICT_SEVERITY = { Mismatched: 'high', 'Weakly Supported': 'medium', Unverifiable: 'low' };
  const ACCESS_LABELS = { full_text: 'Open full text', abstract: 'Abstract only', none: 'No content accessible' };
  const STYLE_LABELS = { apa: 'APA 7', mla: 'MLA 9', chicago: 'Chicago' };

  const CATEGORY_LABELS = {
    copyright_risk: 'Copyright risk',
    plagiarism_concern: 'Possible plagiarism',
    missing_attribution: 'Missing attribution',
    licence_restriction: 'Licence restriction',
  };
  const CLASSIFICATION_BADGE = {
    'Likely permitted under the identified licence or policy': 'permitted',
    'Permission may be required': 'required',
    'Attribution or licence conditions need attention': 'attention',
    'Status unclear; further verification required': 'unclear',
  };
  const OUTCOME_CLASS = {
    'Proceed Without Requesting Permission': 'proceed',
    'Permission May Be Required': 'required',
    'Status Unclear': 'unclear',
  };

  const state = {
    config: null,
    analysis: null,
    decisions: {}, // issueId -> {status:'applied'|'edited'|'kept', text?}
    drafts: {},
    editing: null,
    included: {},
    verif: {}, // claimId -> {status, result?, error?}
    open: new Set(),
    tab: 'format',
    runId: 0,
    fFilter: { type: '', severity: '', location: '', decision: '' },
    eFilter: { verdict: '', problem: '', severity: '', confidence: '' },
    sFilter: { classification: '', category: '', severity: '' },
    permResult: null,
  };

  // ---------- views ----------
  function showView(name) {
    for (const v of ['input', 'results', 'report', 'permission']) {
      const viewEl = $('view-' + v);
      if (viewEl) viewEl.hidden = v !== name;
    }
    const navHome = $('nav-home');
    const navPerm = $('nav-permission');
    const navRes = $('nav-results');
    const navRep = $('nav-report');
    if (navHome) navHome.classList.toggle('active', name === 'input');
    if (navPerm) navPerm.classList.toggle('active', name === 'permission');
    if (navRes) navRes.classList.toggle('active', name === 'results');
    if (navRep) navRep.classList.toggle('active', name === 'report');

    if ($('perm-back-btn')) {
      $('perm-back-btn').textContent = state.analysis ? '← Back to Results' : '← Back to Home';
    }

    if (name === 'report') renderReport();
    if (lenisInstance) {
      lenisInstance.scrollTo(0, { immediate: true });
    } else {
      window.scrollTo(0, 0);
    }
  }

  // ---------- smooth scrolling (Lenis & Enhanced Scroll) ----------
  let lenisInstance = null;
  if (typeof Lenis !== 'undefined') {
    lenisInstance = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      direction: 'vertical',
      gestureDirection: 'vertical',
      smooth: true,
      mouseMultiplier: 1.0,
      smoothTouch: false,
      touchMultiplier: 2,
    });

    function raf(time) {
      lenisInstance.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  }

  function smoothScroll(target, offset = -78) {
    if (lenisInstance) {
      lenisInstance.scrollTo(target, { offset, duration: 1.1 });
    } else if (typeof target === 'number' || (target && target.top !== undefined)) {
      window.scrollTo({ top: typeof target === 'number' ? target : target.top, behavior: 'smooth' });
    } else {
      const el = typeof target === 'string' ? $(target) : target;
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      if (b.dataset.view) showView(b.dataset.view);
    });
  });

  $('brand-link').addEventListener('click', (e) => {
    e.preventDefault();
    showView('input');
    smoothScroll(0);
  });
  if ($('nav-home')) {
    $('nav-home').addEventListener('click', () => {
      showView('input');
      smoothScroll(0);
    });
  }
  if ($('nav-features')) {
    $('nav-features').addEventListener('click', () => {
      showView('input');
      smoothScroll($('features'));
    });
  }
  if ($('nav-how')) {
    $('nav-how').addEventListener('click', () => {
      showView('input');
      smoothScroll($('how-it-works'));
    });
  }
  if ($('nav-check-doc')) {
    $('nav-check-doc').addEventListener('click', () => {
      showView('input');
      smoothScroll($('document-checker'));
      $('text-input').focus();
    });
  }
  if ($('hero-upload-btn')) {
    $('hero-upload-btn').addEventListener('click', () => {
      showView('input');
      smoothScroll($('document-checker'));
      $('file-input').click();
    });
  }
  if ($('hero-paste-btn')) {
    $('hero-paste-btn').addEventListener('click', () => {
      showView('input');
      smoothScroll($('document-checker'));
      $('text-input').focus();
    });
  }
  $('new-analysis').addEventListener('click', () => {
    clearPermissionResult();
    showView('input');
    smoothScroll($('document-checker'));
  });

  if ($('btn-view-report-from-results')) {
    $('btn-view-report-from-results').addEventListener('click', () => showView('report'));
  }
  if ($('report-back-btn')) {
    $('report-back-btn').addEventListener('click', () => showView('results'));
  }
  if ($('perm-back-btn')) {
    $('perm-back-btn').addEventListener('click', () => showView(state.analysis ? 'results' : 'input'));
  }

  const jumpToInputOrTab = (tab) => {
    if (state.analysis) {
      setTab(tab);
      showView('results');
    } else {
      showView('input');
      const el = $('text-input');
      if (el) {
        smoothScroll($('document-checker'));
        el.focus();
      }
    }
  };

  const setupCard = (cardId, action) => {
    const el = $(cardId);
    if (!el) return;
    el.addEventListener('click', action);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        action();
      }
    });
  };
  setupCard('card-format', () => jumpToInputOrTab('format'));
  setupCard('card-evidence', () => jumpToInputOrTab('evidence'));
  setupCard('card-permission', () => showView('permission'));
  setupCard('card-safety', () => jumpToInputOrTab('safety'));

  // ---------- config ----------
  async function loadConfig() {
    try {
      const r = await fetch('/api/config');
      state.config = await r.json();
      const c = state.config;
      $('config-note').innerHTML = c.llm.enabled
        ? `Claim comparison powered by <strong>${esc(c.llm.provider)}</strong> (${esc(c.llm.model)}). Sources verified via Crossref &amp; OpenAlex.`
        : `Claim verification active in rule-based mode. Set <code>OPENAI_API_KEY</code> for semantic checking.`;
    } catch (e) {
      $('config-note').textContent = 'Could not reach the CiteSure server. Is it running?';
    }
  }

  // ---------- input ----------
  const fileInput = $('file-input');
  function updateFileUi() {
    const f = fileInput.files[0];
    $('file-name').textContent = f ? `${f.name} (${(f.size / 1024).toFixed(0)} KB)` : 'Drop PDF or DOCX here, or browse files';
    $('clear-file').hidden = !f;
  }
  fileInput.addEventListener('change', updateFileUi);
  $('clear-file').addEventListener('click', () => {
    fileInput.value = '';
    updateFileUi();
  });
  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) {
      const dt = new DataTransfer();
      dt.items.add(e.dataTransfer.files[0]);
      fileInput.files = dt.files;
      updateFileUi();
    }
  });
  document.querySelectorAll('input[name="style"]').forEach((r) =>
    r.addEventListener('change', () => {
      const hint = $('style-hint');
      if (hint) hint.hidden = r.value !== 'chicago' || !r.checked;
    })
  );
  if ($('style-hint')) $('style-hint').hidden = true;

  function showInputError(msg) {
    const el = $('input-error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  $('analyze-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showInputError('');
    const file = fileInput.files[0];
    const text = $('text-input').value;
    const style = document.querySelector('input[name="style"]:checked').value;
    if (!file && !text.trim()) return showInputError('Upload a PDF/DOCX file or paste some text first.');
    if (file && !/\.(pdf|docx)$/i.test(file.name)) {
      return showInputError(`"${file.name}" is not supported. Upload a .pdf or .docx file, or paste the text.`);
    }
    const fd = new FormData();
    fd.append('style', style);
    if (file) fd.append('file', file);
    else fd.append('text', text);
    const btn = $('analyze-btn');
    btn.disabled = true;
    $('analyze-status').innerHTML = `<span class="spinner" aria-hidden="true"></span> ${file ? `Reading and analyzing ${esc(file.name)}…` : 'Analyzing document and verifying citations…'}`;
    try {
      const r = await fetch('/api/analyze', { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data.error && data.error.message) || `Request failed (${r.status})`);
      startResults(data, file && text.trim() ? 'Both a file and pasted text were provided; the uploaded file was analyzed.' : null);
    } catch (err) {
      showInputError(err.message);
    } finally {
      btn.disabled = false;
      $('analyze-status').textContent = '';
    }
  });

  // ---------- results ----------
  function startResults(data, extraNote) {
    clearPermissionResult();
    state.analysis = data;
    state.decisions = {};
    state.drafts = {};
    state.editing = null;
    state.included = {};
    state.verif = {};
    state.open = new Set();
    state.tab = 'format';
    state.fFilter = { type: '', severity: '', location: '', decision: '' };
    state.eFilter = { verdict: '', problem: '', severity: '', confidence: '' };
    state.sFilter = { classification: '', category: '', severity: '' };
    ['f-type', 'f-severity', 'f-location', 'f-decision', 'e-verdict', 'e-problem', 'e-severity', 'e-confidence', 's-classification', 's-category', 's-severity'].forEach((id) => {
      const el = $(id);
      if (el) el.value = '';
    });
    $('nav-results').hidden = false;
    $('nav-results').disabled = false;
    $('nav-report').hidden = false;
    $('nav-report').disabled = false;

    const warns = [...(data.notes || []), ...(data.warnings || [])];
    if (extraNote) warns.unshift(extraNote);
    if (!data.llm.enabled) warns.push('No LLM key is configured: claim verification uses a keyword and number check only.');
    $('warnings').hidden = !warns.length;
    $('warnings').innerHTML = warns.length ? '<ul>' + warns.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul>' : '';

    const safeCount = (data.safety && data.safety.findings) ? data.safety.findings.length : 0;
    $('results-meta').textContent = `${STYLE_LABELS[data.style]} · ${data.citations.length} in-text citation(s) · ${data.references.length} reference(s) · ${data.claims.length} cited claim(s) · ${safeCount} safety item(s)`;

    // type filter options from present types
    const types = [...new Set(data.issues.map((i) => i.type))];
    $('f-type').innerHTML = '<option value="">All</option>' + types.map((t) => `<option value="${t}">${esc(TYPE_LABELS[t] || t)}</option>`).join('');

    setTab('format');
    renderAll();
    showView('results');
    runVerification();
  }

  function renderAll() {
    renderSummary();
    renderFormatList();
    renderEvidenceList();
    renderSafetyList();
    updateReviewButton();
  }

  function setTab(t) {
    state.tab = t;
    document.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === t);
      b.setAttribute('aria-selected', String(b.dataset.tab === t));
    });
    $('panel-format').hidden = t !== 'format';
    $('panel-evidence').hidden = t !== 'evidence';
    $('panel-safety').hidden = t !== 'safety';
  }
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // filters
  const bindFilter = (id, obj, key, render) => {
    const el = $(id);
    if (el) el.addEventListener('change', (e) => { state[obj][key] = e.target.value; render(); });
  };
  bindFilter('f-type', 'fFilter', 'type', () => renderFormatList());
  bindFilter('f-severity', 'fFilter', 'severity', () => renderFormatList());
  bindFilter('f-location', 'fFilter', 'location', () => renderFormatList());
  bindFilter('f-decision', 'fFilter', 'decision', () => renderFormatList());
  bindFilter('e-verdict', 'eFilter', 'verdict', () => renderEvidenceList());
  bindFilter('e-problem', 'eFilter', 'problem', () => renderEvidenceList());
  bindFilter('e-severity', 'eFilter', 'severity', () => renderEvidenceList());
  bindFilter('e-confidence', 'eFilter', 'confidence', () => renderEvidenceList());
  bindFilter('s-classification', 'sFilter', 'classification', () => renderSafetyList());
  bindFilter('s-category', 'sFilter', 'category', () => renderSafetyList());
  bindFilter('s-severity', 'sFilter', 'severity', () => renderSafetyList());

  // ---------- evidence items ----------
  function evidenceItems() {
    const a = state.analysis;
    const items = a.claims.map((c) => {
      const v = state.verif[c.id] || { status: 'pending' };
      const r = v.result;
      return { kind: 'claim', id: c.id, claim: c, v, verdict: r ? r.verdict : null, severity: r ? VERDICT_SEVERITY[r.verdict] || 'none' : 'none', confidence: r ? r.confidence : null, problems: r ? r.issues || [] : [] };
    });
    for (const u of a.uncitedClaims) {
      items.push({ kind: 'uncited', id: u.id, claim: u, verdict: '__uncited', severity: 'medium', confidence: null, problems: ['unsupported'] });
    }
    return items;
  }

  function renderSummary() {
    const a = state.analysis;
    if (!a) return;
    const items = evidenceItems();
    const vc = { Supported: 0, 'Weakly Supported': 0, Mismatched: 0, Unverifiable: 0 };
    let pending = 0;
    for (const it of items) {
      if (it.kind !== 'claim') continue;
      if (it.verdict) vc[it.verdict]++;
      else pending++;
    }
    const sev = { high: 0, medium: 0, low: 0 };
    const tc = {};
    a.issues.forEach((i) => {
      sev[i.severity]++;
      tc[i.type] = (tc[i.type] || 0) + 1;
    });

    const sFindings = (a.safety && a.safety.findings) || [];
    const sClass = {
      permitted: sFindings.filter((f) => f.classification === 'Likely permitted under the identified licence or policy').length,
      permissionRequired: sFindings.filter((f) => f.classification === 'Permission may be required').length,
      conditionsAttention: sFindings.filter((f) => f.classification === 'Attribution or licence conditions need attention').length,
      statusUnclear: sFindings.filter((f) => f.classification === 'Status unclear; further verification required').length,
    };

    const tile = (n, l, cls, filt) => `<button class="stat ${cls}" style="text-align:left;cursor:pointer;font:inherit" data-filter="${esc(filt)}"><div class="stat-n">${n}</div><div class="stat-l">${esc(l)}</div></button>`;
    $('summary').innerHTML =
      `<div class="stat-group-title">Copyright &amp; citation safety (${sFindings.length})</div>` +
      tile(sClass.permitted, 'Likely permitted', 'good', 's:classification:Likely permitted under the identified licence or policy') +
      tile(sClass.permissionRequired, 'Permission may be required', 'bad', 's:classification:Permission may be required') +
      tile(sClass.conditionsAttention, 'Conditions need attention', 'warn', 's:classification:Attribution or licence conditions need attention') +
      tile(sClass.statusUnclear, 'Status unclear', 'neutral', 's:classification:Status unclear; further verification required') +
      `<div class="stat-group-title">Evidence (claim-to-source)${pending ? ` · ${pending} still checking` : ''}</div>` +
      tile(vc.Supported, 'Supported', 'good', 'e:verdict:Supported') +
      tile(vc['Weakly Supported'], 'Weakly Supported', 'warn', 'e:verdict:Weakly Supported') +
      tile(vc.Mismatched, 'Mismatched', 'bad', 'e:verdict:Mismatched') +
      tile(vc.Unverifiable, 'Unverifiable', 'neutral', 'e:verdict:Unverifiable') +
      tile(a.uncitedClaims.length, 'Uncited claims', 'warn', 'e:verdict:__uncited') +
      `<div class="stat-group-title">Formatting issues (${a.issues.length})</div>` +
      tile(sev.high, 'High severity', 'bad', 'f:severity:high') +
      tile(sev.medium, 'Medium severity', 'warn', 'f:severity:medium') +
      tile(sev.low, 'Low severity', 'neutral', 'f:severity:low') +
      Object.keys(tc).map((t) => tile(tc[t], TYPE_LABELS[t] || t, 'neutral', 'f:type:' + t)).join('');
    $('count-format').textContent = a.issues.length;
    $('count-evidence').textContent = items.length;
    if ($('count-safety')) $('count-safety').textContent = sFindings.length;
  }
  $('summary').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    const [scope, key, ...rest] = b.dataset.filter.split(':');
    const val = rest.join(':');
    if (scope === 'f') {
      state.fFilter = { type: '', severity: '', location: '', decision: '' };
      ['f-type', 'f-severity', 'f-location', 'f-decision'].forEach((id) => ($(id).value = ''));
      state.fFilter[key] = val;
      $('f-' + key).value = val;
      setTab('format');
      renderFormatList();
    } else if (scope === 'e') {
      state.eFilter = { verdict: '', problem: '', severity: '', confidence: '' };
      ['e-verdict', 'e-problem', 'e-severity', 'e-confidence'].forEach((id) => ($(id).value = ''));
      state.eFilter[key] = val;
      $('e-' + key).value = val;
      setTab('evidence');
      renderEvidenceList();
    } else if (scope === 's') {
      state.sFilter = { classification: '', category: '', severity: '' };
      ['s-classification', 's-category', 's-severity'].forEach((id) => ($(id).value = ''));
      state.sFilter[key] = val;
      $('s-' + key).value = val;
      setTab('safety');
      renderSafetyList();
    }
  });

  // ---------- formatting list ----------
  const decisionOf = (id) => (state.decisions[id] && state.decisions[id].status) || 'pending';
  const DECISION_LABEL = { pending: 'Undecided', applied: 'Staged', edited: 'Edited', kept: 'Kept' };
  const DECISION_CLASS = { pending: 'neutral', applied: 'good', edited: 'info', kept: 'neutral' };

  function highlighted(issue) {
    const ctx = issue.context;
    const s = Math.max(0, issue.start - issue.ctxOffset);
    const e = Math.min(ctx.length, issue.end - issue.ctxOffset);
    const pre = issue.location === 'in-text' && issue.ctxOffset > 0 ? '…' : '';
    const post = issue.location === 'in-text' && issue.ctxOffset + ctx.length < state.analysis.text.length ? '…' : '';
    return `${pre}${esc(ctx.slice(0, s))}<mark>${esc(ctx.slice(s, e))}</mark>${esc(ctx.slice(e))}${post}`;
  }

  function renderFormatList() {
    const a = state.analysis;
    if (!a) return;
    const f = state.fFilter;
    const list = a.issues.filter((i) => (!f.type || i.type === f.type) && (!f.severity || i.severity === f.severity) && (!f.location || i.location === f.location) && (!f.decision || decisionOf(i.id) === f.decision));
    const ul = $('format-list');
    if (!list.length) {
      ul.innerHTML = `<li class="empty">${a.issues.length ? 'No formatting issues match these filters.' : 'No formatting issues were detected. (This does not guarantee a perfect reference list: italics and some style rules cannot be checked from extracted text.)'}</li>`;
      return;
    }
    ul.innerHTML = list.map(formatItemHtml).join('');
  }

  function formatItemHtml(i) {
    const open = state.open.has(i.id);
    const dec = decisionOf(i.id);
    const d = state.decisions[i.id];
    const where = i.location === 'reference' ? 'Reference list' : 'In-text';
    let body = '';
    if (open) {
      const finalText = dec === 'edited' ? d.text : i.replacement;
      body = `<div class="finding-body">
        <div class="row"><div class="row-label">Original text</div><div class="quote">${highlighted(i)}</div></div>
        <div class="row"><div class="row-label">Problem</div><div>${esc(i.problem)}</div></div>
        <div class="row"><div class="row-label">Suggested correction</div>
          <div>${esc(i.suggestion)}</div>
          ${i.replacement !== null ? `<div class="diff" style="margin-top:8px"><div class="old">${esc(i.fragment) || '(nothing)'}</div><div class="new">${esc(i.replacement) || '(remove)'}</div></div>` : `<div class="hint">No safe automatic correction exists, because it would require information not in your document. Use Edit Manually.</div>`}
        </div>
        ${dec === 'edited' ? `<div class="row"><div class="row-label">Your edit</div><div class="diff"><div class="new">${esc(finalText) || '(remove)'}</div></div></div>` : ''}
        <div class="actions">
          <button class="btn btn-ghost btn-small ${dec === 'applied' ? 'is-active' : ''}" data-act="apply" data-id="${i.id}" ${i.replacement === null ? 'disabled title="No automatic correction available"' : ''}>Apply Correction</button>
          <button class="btn btn-ghost btn-small ${dec === 'edited' || state.editing === i.id ? 'is-active' : ''}" data-act="edit" data-id="${i.id}">Edit Manually</button>
          <button class="btn btn-ghost btn-small ${dec === 'kept' ? 'is-active' : ''}" data-act="keep" data-id="${i.id}">Keep Original</button>
          ${dec !== 'pending' ? `<button class="btn btn-ghost btn-small" data-act="reset" data-id="${i.id}">Undo decision</button>` : ''}
        </div>
        ${state.editing === i.id ? `<div class="edit-box"><label for="edit-${i.id}" class="row-label">Replace the highlighted text with:</label><textarea id="edit-${i.id}" rows="3" data-draft="${i.id}">${esc(state.drafts[i.id] != null ? state.drafts[i.id] : d && d.status === 'edited' ? d.text : i.fragment)}</textarea><div class="actions"><button class="btn btn-primary btn-small" data-act="save-edit" data-id="${i.id}">Stage my edit</button><button class="btn btn-ghost btn-small" data-act="cancel-edit" data-id="${i.id}">Cancel</button></div></div>` : ''}
        <p class="hint">Staged changes are only applied to your document after you review them (Review changes).</p>
      </div>`;
    }
    return `<li class="finding ${open ? 'open' : ''}" id="item-${i.id}">
      <button class="finding-head" data-toggle="${i.id}" aria-expanded="${open}">
        <span class="chev" aria-hidden="true">▸</span>
        <span><div class="finding-title">${esc(TYPE_LABELS[i.type] || i.type)} <span class="muted" style="font-weight:400">· ${where}</span></div>
        <div class="finding-sub">${esc(i.problem)}</div></span>
        <span class="badges"><span class="badge b-${i.severity}">${esc(i.severity)}</span><span class="badge b-${DECISION_CLASS[dec]}">${esc(DECISION_LABEL[dec])}</span></span>
      </button>${body}</li>`;
  }

  $('format-list').addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const id = t.dataset.toggle;
      state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      return renderFormatList();
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const issue = state.analysis.issues.find((x) => x.id === id);
    const act = b.dataset.act;
    if (act === 'apply') {
      state.decisions[id] = decisionOf(id) === 'applied' ? undefined : { status: 'applied' };
      if (!state.decisions[id]) delete state.decisions[id];
      state.editing = null;
    } else if (act === 'keep') {
      state.decisions[id] = { status: 'kept' };
      state.editing = null;
    } else if (act === 'reset') {
      delete state.decisions[id];
      state.editing = null;
    } else if (act === 'edit') {
      state.editing = state.editing === id ? null : id;
    } else if (act === 'cancel-edit') {
      state.editing = null;
      delete state.drafts[id];
    } else if (act === 'save-edit') {
      const txt = state.drafts[id] != null ? state.drafts[id] : issue.fragment;
      state.decisions[id] = txt === issue.fragment ? { status: 'kept' } : { status: 'edited', text: txt };
      state.editing = null;
      delete state.drafts[id];
    }
    state.included[id] = true;
    renderAll();
  });
  $('format-list').addEventListener('input', (e) => {
    if (e.target.dataset.draft) state.drafts[e.target.dataset.draft] = e.target.value;
  });

  // ---------- evidence list ----------
  function renderEvidenceList() {
    const a = state.analysis;
    if (!a) return;
    const f = state.eFilter;
    const items = evidenceItems().filter((it) => {
      if (f.verdict && it.verdict !== f.verdict) return false;
      if (f.problem && !it.problems.includes(f.problem)) return false;
      if (f.severity && it.severity !== f.severity) return false;
      if (f.confidence && it.confidence !== f.confidence) return false;
      return true;
    });
    const ul = $('evidence-list');
    if (!items.length) {
      ul.innerHTML = `<li class="empty">${a.claims.length || a.uncitedClaims.length ? 'No findings match these filters.' : 'No cited claims were found. CiteSure looks for sentences with in-text citations in the selected style.'}</li>`;
      return;
    }
    ul.innerHTML = items.map(evidenceItemHtml).join('');
  }

  function sourceLinkHtml(r) {
    const s = r.source || {};
    const label = s.title || s.doi || 'Source';
    return s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label);
  }

  function evidenceItemHtml(it) {
    const open = state.open.has(it.id);
    if (it.kind === 'uncited') {
      const u = it.claim;
      return `<li class="finding ${open ? 'open' : ''}" id="item-${it.id}">
        <button class="finding-head" data-toggle="${it.id}" aria-expanded="${open}">
          <span class="chev" aria-hidden="true">▸</span>
          <span><div class="finding-title">Uncited claim</div><div class="finding-sub">${esc(u.sentence)}</div></span>
          <span class="badges"><span class="badge b-medium">medium</span><span class="badge b-warn">Needs a source</span></span>
        </button>
        ${open ? `<div class="finding-body"><div class="row"><div class="row-label">Statement</div><div class="quote">${esc(u.sentence)}</div></div>
          <div class="row"><div class="row-label">Why it was flagged</div><div>This sentence ${esc(u.reason)} but has no in-text citation. Add a source for it or soften the wording. It was not checked against any source.</div></div></div>` : ''}
      </li>`;
    }
    const c = it.claim;
    const v = it.v;
    const r = v.result;
    let badges = '';
    if (r) badges = `<span class="badge b-${VERDICT_CLASS[r.verdict]}">${esc(r.verdict)}</span><span class="badge b-low">${esc(r.confidence)} confidence</span>`;
    else if (v.status === 'error') badges = '<span class="badge b-bad">Check failed</span>';
    else badges = `<span class="badge b-low">${v.status === 'running' ? 'Checking…' : 'Queued'}</span>`;
    let body = '';
    if (open) {
      const claimShown = esc(c.sentence);
      if (r) {
        const ev = (r.evidence || []).length
          ? r.evidence.map((x) => `<div class="quote evidence">${esc(x.text)}<small>Verbatim excerpt from the retrieved source text</small></div>`).join('')
          : '<div class="muted">No supporting or contradicting excerpt is available for this verdict.</div>';
        body = `<div class="finding-body">
          <div class="row"><div class="row-label">Claim · cites ${esc(c.citation)}</div><div class="quote">${claimShown}</div></div>
          <div class="row"><div class="row-label">Source</div><div>${sourceLinkHtml(r)}${r.source.doi ? ` <span class="muted">· DOI ${esc(r.source.doi)}</span>` : ''}<div class="muted" style="font-size:13px">Access: ${esc(ACCESS_LABELS[r.source.accessLevel] || r.source.accessLevel)}${r.source.accessOrigin ? ' (' + esc(r.source.accessOrigin) + ')' : ''}${r.source.identifiedBy === 'crossref-search' ? ' · matched by title/author search, no DOI in reference' : ''}</div></div></div>
          <div class="row"><div class="row-label">Relevant evidence</div>${ev}</div>
          <div class="row"><div class="row-label">Explanation</div><div>${esc(r.explanation)}</div>
            ${(r.issues || []).length ? `<div class="badges" style="justify-content:flex-start;margin-top:6px">${r.issues.map((p) => `<span class="badge b-warn">${esc(PROBLEM_LABELS[p] || p)}</span>`).join('')}</div>` : ''}</div>
          <div class="row"><div class="row-label">Confidence</div><div>${esc(r.confidence)} · method: ${r.mode === 'llm' ? 'LLM comparison of retrieved excerpts' : r.mode === 'heuristic' ? 'keyword/number check' : 'no comparison possible'}${r.accessNote ? ' · ' + esc(r.accessNote) : ''}</div></div>
          ${r.source.notes && r.source.notes.length ? `<div class="row"><div class="row-label">Retrieval notes</div><ul class="hint" style="margin:0;padding-left:18px">${r.source.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
          <div class="actions"><button class="btn btn-ghost btn-small" data-vact="recheck" data-id="${it.id}">Re-check this claim</button>${r.source.link ? `<a class="btn btn-ghost btn-small" style="text-decoration:none" href="${esc(r.source.link)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ''}</div>
        </div>`;
      } else {
        body = `<div class="finding-body"><div class="row"><div class="row-label">Claim · cites ${esc(c.citation)}</div><div class="quote">${claimShown}</div></div>
          <div class="row">${v.status === 'error' ? `<div class="alert alert-error">${esc(v.error)}</div><div class="actions"><button class="btn btn-ghost btn-small" data-vact="recheck" data-id="${it.id}">Retry</button></div>` : '<span class="muted">Verification in progress…</span>'}</div></div>`;
      }
    }
    return `<li class="finding ${open ? 'open' : ''}" id="item-${it.id}">
      <button class="finding-head" data-toggle="${it.id}" aria-expanded="${open}">
        <span class="chev" aria-hidden="true">▸</span>
        <span><div class="finding-title">${esc(c.citation)}${r && r.source.title ? ` <span class="muted" style="font-weight:400">· ${esc(r.source.title)}</span>` : ''}</div><div class="finding-sub">${esc(c.sentence)}</div></span>
        <span class="badges">${badges}</span>
      </button>${body}</li>`;
  }

  $('evidence-list').addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const id = t.dataset.toggle;
      state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      return renderEvidenceList();
    }
    const b = e.target.closest('[data-vact]');
    if (b && b.dataset.vact === 'recheck') {
      const claim = state.analysis.claims.find((c) => c.id === b.dataset.id);
      if (claim) verifyOne(claim, state.runId).then(() => { renderSummary(); renderEvidenceList(); });
      renderEvidenceList();
    }
  });

  // ---------- verification ----------
  async function verifyOne(claim, runId) {
    state.verif[claim.id] = { status: 'running' };
    const a = state.analysis;
    const reference = claim.refIndex != null ? a.references[claim.refIndex] : null;
    try {
      const r = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          claim: claim.cleanClaim || claim.sentence,
          citation: claim.citation,
          reference: reference ? { raw: reference.raw, title: reference.title, year: reference.year, doi: reference.doi, url: reference.url, authors: reference.authors } : null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (runId !== state.runId) return;
      if (!r.ok) throw new Error((data.error && data.error.message) || `Request failed (${r.status})`);
      state.verif[claim.id] = { status: 'done', result: data };
    } catch (err) {
      if (runId !== state.runId) return;
      state.verif[claim.id] = { status: 'error', error: err.message };
    }
  }

  async function runVerification() {
    const runId = ++state.runId;
    const claims = state.analysis.claims;
    const total = claims.length;
    $('verify-progress').hidden = !total;
    let done = 0;
    const tick = () => {
      $('progress-bar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
      $('progress-text').textContent = done < total ? `Verifying claims: ${done}/${total}` : `Verified ${total} claim(s)`;
    };
    tick();
    claims.forEach((c) => (state.verif[c.id] = { status: 'pending' }));
    renderSummary();
    renderEvidenceList();
    let next = 0;
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        if (runId !== state.runId) return;
        renderSummary();
        renderEvidenceList();
      }, 150);
    };
    async function worker() {
      while (next < claims.length && runId === state.runId) {
        const c = claims[next++];
        await verifyOne(c, runId);
        if (runId !== state.runId) return;
        done++;
        tick();
        refresh();
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    if (runId === state.runId) {
      renderSummary();
      renderEvidenceList();
    }
  }

  // ---------- safety list ----------
  function renderSafetyList() {
    const a = state.analysis;
    if (!a) return;
    const safety = a.safety || { findings: [] };
    const f = state.sFilter;
    const list = (safety.findings || []).filter((item) => {
      if (f.classification && item.classification !== f.classification) return false;
      if (f.category && item.category !== f.category) return false;
      if (f.severity && item.severity !== f.severity) return false;
      return true;
    });
    const ul = $('safety-list');
    if (!ul) return;
    if (!list.length) {
      ul.innerHTML = `<li class="empty">${(safety.findings || []).length ? 'No safety findings match these filters.' : 'No copyright or citation safety issues were detected. (Always verify publisher licences and reproduction terms before publishing.)'}</li>`;
      return;
    }
    ul.innerHTML = list.map(safetyItemHtml).join('');
  }

  function safetyItemHtml(f) {
    const open = state.open.has(f.id);
    const catLabel = CATEGORY_LABELS[f.category] || f.category;
    const classBadge = CLASSIFICATION_BADGE[f.classification] || 'neutral';

    let categoryNotice = '';
    if (f.category === 'copyright_risk') {
      categoryNotice = '<div class="row-label" style="color:var(--bad)">Category: Copyright Risk</div><p style="margin:2px 0 0;font-size:13.5px">Figures, charts, and tables are creative graphical works whose copyright is typically retained by the publisher or author. Statutory quotation exceptions (fair use / fair dealing) rarely cover full graphical items without express permission.</p>';
    } else if (f.category === 'plagiarism_concern') {
      categoryNotice = '<div class="row-label" style="color:var(--bad)">Category: Plagiarism / Patchwriting Concern</div><p style="margin:2px 0 0;font-size:13.5px">Verbatim text without quotation marks. <em>Important: Text similarity alone is never definitive proof of intentional plagiarism or copyright infringement.</em> Review against original source context.</p>';
    } else if (f.category === 'missing_attribution') {
      categoryNotice = '<div class="row-label" style="color:var(--warn)">Category: Missing Attribution</div><p style="margin:2px 0 0;font-size:13.5px">Empirical finding or specific data without an in-text citation. Academic integrity requires attributing all non-original empirical claims to their primary source.</p>';
    } else if (f.category === 'licence_restriction') {
      categoryNotice = '<div class="row-label" style="color:var(--accent)">Category: Licence Terms &amp; Restrictions</div><p style="margin:2px 0 0;font-size:13.5px">Publisher licence conditions (such as CC-BY, Non-Commercial, or No-Derivatives) govern how this cited work may be reused or adapted.</p>';
    }

    const rawSteps = (f.recommendation || '').split('\n').filter(Boolean);
    const stepListHtml = rawSteps.length > 1
      ? `<ol class="steps-list">${rawSteps.map((s) => `<li>${esc(s.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>`
      : `<div>${esc(f.recommendation)}</div>`;

    let sourceHtml = '';
    if (f.source) {
      sourceHtml = `<div class="row"><div class="row-label">Cited source information</div><div class="meta-box">
        <div class="meta-row"><span class="meta-label">Title:</span><span>${f.source.link ? `<a href="${esc(f.source.link)}" target="_blank" rel="noopener noreferrer">${esc(f.source.title || 'Source')}</a>` : esc(f.source.title || 'Source')}</span></div>
        ${f.source.doi ? `<div class="meta-row"><span class="meta-label">DOI:</span><code>${esc(f.source.doi)}</code></div>` : ''}
        ${f.source.publisher ? `<div class="meta-row"><span class="meta-label">Publisher:</span><span>${esc(f.source.publisher)}</span></div>` : ''}
        ${f.source.license ? `<div class="meta-row"><span class="meta-label">Licence:</span><span class="badge b-${f.source.license.type.startsWith('CC-BY') ? 'good' : 'warn'}">${esc(f.source.license.name)}</span></div>` : ''}
      </div></div>`;
    }

    let actionsHtml = '';
    if (f.permissionPrefill) {
      actionsHtml += `<button type="button" class="btn btn-primary btn-small" data-sact="check-perm" data-id="${f.id}">Check Reuse Permission ↗</button>`;
    }
    if (f.source && f.source.link) {
      actionsHtml += ` <a class="btn btn-ghost btn-small" href="${esc(f.source.link)}" target="_blank" rel="noopener noreferrer">Open Source Page</a>`;
    }

    let body = '';
    if (open) {
      body = `<div class="finding-body">
        <div class="row"><div class="row-label">Location &amp; Context</div><div class="quote">${esc(f.snippet)}<small>${esc(f.location)}</small></div></div>
        <div class="row">${categoryNotice}</div>
        <div class="row"><div class="row-label">Explanation</div><div>${esc(f.explanation)}</div></div>
        <div class="row"><div class="row-label">Recommended Next Action (Step-by-step)</div>${stepListHtml}
          <div class="prohibition-box">
            <strong>Actionable integrity standard:</strong> Never use superficial word changes, automated synonym swappers, or visual alterations to disguise copied material. Understand the underlying idea and rewrite it independently preserving accurate meaning, or quote verbatim with quotation marks and complete page attribution.
          </div>
        </div>
        ${sourceHtml}
        ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ''}
        <div class="row" style="margin-top:14px"><p class="caveat" style="margin:0;font-size:12.5px">${esc(f.disclaimer || 'Guidance notice: Text similarity and automated licence scans are guidance rather than a legal guarantee.')}</p></div>
      </div>`;
    }

    return `<li class="finding ${open ? 'open' : ''}" id="item-${f.id}">
      <button class="finding-head" data-toggle="${f.id}" aria-expanded="${open}">
        <span class="chev" aria-hidden="true">▸</span>
        <span>
          <div class="finding-title">${esc(catLabel)} <span class="muted" style="font-weight:400">· ${esc(f.location)}</span></div>
          <div class="finding-sub">${esc(f.snippet.slice(0, 130))}${f.snippet.length > 130 ? '…' : ''}</div>
        </span>
        <span class="badges">
          <span class="badge b-${f.severity}">${esc(f.severity)}</span>
          <span class="badge b-${classBadge}">${esc(f.classification)}</span>
        </span>
      </button>
      ${body}
    </li>`;
  }

  function clearPermissionResult() {
    state.permResult = null;
    const resCard = $('perm-result-card');
    if (resCard) {
      resCard.hidden = true;
      resCard.innerHTML = '';
    }
    const draftCard = $('perm-draft-section');
    if (draftCard) {
      draftCard.hidden = true;
      draftCard.innerHTML = '';
    }
    const errEl = $('perm-error');
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
      errEl.className = 'alert alert-error';
    }
    const status = $('perm-status');
    if (status) status.textContent = '';
  }

  function openPermissionForFinding(f) {
    clearPermissionResult();

    const pre = f.permissionPrefill || {};
    let srcQuery = pre.sourceQuery || '';
    if (!srcQuery && f.source) {
      srcQuery = f.source.doi || f.source.title || '';
    }
    if (!srcQuery && f.snippet) {
      const doiM = f.snippet.match(/(?:doi:?\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s"<>)]+)/i);
      if (doiM) srcQuery = doiM[1].replace(/[.,;)\]]+$/, '');
    }

    $('perm-source').value = srcQuery;
    if (pre.materialType) $('perm-material').value = pre.materialType;
    if (pre.exactMaterial) $('perm-exact').value = pre.exactMaterial;
    $('perm-commercial').checked = !!pre.commercial;
    $('perm-modified').checked = !!pre.modified;
    if ($('perm-thirdparty')) {
      $('perm-thirdparty').checked = !!pre.thirdPartyCredit;
    }

    showView('permission');

    if (srcQuery) {
      evaluatePermission();
    } else {
      const errEl = $('perm-error');
      errEl.className = 'alert alert-info';
      errEl.innerHTML = `<strong>Finding selected:</strong> ${esc(pre.exactMaterial || 'Material')}. Please enter the source DOI, URL, or publication title above to evaluate reuse terms.`;
      errEl.hidden = false;
      $('perm-source').focus();
    }
  }

  $('safety-list').addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const id = t.dataset.toggle;
      state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      return renderSafetyList();
    }
    const b = e.target.closest('[data-sact]');
    if (!b) return;
    const act = b.dataset.sact;
    const id = b.dataset.id;
    const f = ((state.analysis && state.analysis.safety && state.analysis.safety.findings) || []).find((x) => x.id === id);
    if (!f) return;

    if (act === 'check-perm' && f.permissionPrefill) {
      openPermissionForFinding(f);
    }
  });

  // ---------- permission assistant ----------
  if ($('perm-source')) {
    $('perm-source').addEventListener('input', () => {
      if (state.permResult) {
        const cur = $('perm-source').value.trim();
        const prev = state.permResult.sourceQuery || (state.permResult.source && (state.permResult.source.doi || state.permResult.source.title)) || '';
        if (cur !== prev) {
          clearPermissionResult();
        }
      }
    });
  }

  async function evaluatePermission() {
    const sourceQuery = $('perm-source').value.trim();
    const materialType = $('perm-material').value;
    const exactMaterial = $('perm-exact').value.trim();
    const intendedUse = $('perm-use').value;
    const audience = $('perm-audience').value.trim();
    const commercial = $('perm-commercial').checked;
    const modified = $('perm-modified').checked;
    const thirdPartyCredit = $('perm-thirdparty') ? $('perm-thirdparty').checked : false;
    const userName = $('perm-name').value.trim();
    const userAffiliation = $('perm-affiliation').value.trim();
    const userEmail = $('perm-email').value.trim();

    clearPermissionResult();

    const errEl = $('perm-error');
    if (!sourceQuery) {
      errEl.className = 'alert alert-error';
      errEl.textContent = 'Please enter a source DOI, URL, or publication title.';
      errEl.hidden = false;
      return;
    }

    const btn = $('perm-evaluate-btn');
    const status = $('perm-status');
    btn.disabled = true;
    status.innerHTML = '<span class="spinner" aria-hidden="true"></span> Looking up official rights &amp; publisher policies…';

    try {
      const r = await fetch('/api/permission', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceQuery,
          materialType,
          exactMaterial,
          intendedUse,
          audience,
          commercial,
          modified,
          thirdPartyCredit,
          userName,
          userAffiliation,
          userEmail,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data.error && data.error.message) || `Request failed (${r.status})`);
      renderPermissionResult(data);
    } catch (err) {
      errEl.className = 'alert alert-error';
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      status.textContent = '';
    }
  }

  $('permission-form').addEventListener('submit', (e) => {
    e.preventDefault();
    evaluatePermission();
  });

  function renderPermissionResult(data) {
    // If source lookup failed or identity conflict occurred, stop evaluation and ask user to verify
    if (data.canEvaluate === false) {
      state.permResult = null;
      const errEl = $('perm-error');
      errEl.className = 'alert alert-error';
      const err = data.error || {};
      errEl.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px">⚠️ Source verification required — Evaluation halted</div>
        <p style="margin:0 0 6px;line-height:1.5">${esc(err.message || 'Could not verify the requested publication in official registries.')}</p>
        ${err.details ? `<p class="muted" style="margin:0 0 8px;font-size:12.5px">${esc(err.details)}</p>` : ''}
        <p style="margin:0;font-size:13px"><strong>Next step:</strong> Please verify the DOI, URL, or publication title in the search field above and try again. CiteSure will never show a permission outcome without verifying the exact source first.</p>
      `;
      errEl.hidden = false;
      const resCard = $('perm-result-card');
      if (resCard) {
        resCard.hidden = true;
        resCard.innerHTML = '';
      }
      const draftCard = $('perm-draft-section');
      if (draftCard) {
        draftCard.hidden = true;
        draftCard.innerHTML = '';
      }
      smoothScroll(errEl);
      return;
    }

    state.permResult = data;
    const assessment = data.assessment || {};
    const outcome = assessment.outcome || data.outcome || 'Status Unclear';
    const explanation = assessment.explanation || data.explanation || '';
    const conditions = assessment.conditions || data.conditions || [];
    const uncertainties = assessment.uncertainties || data.uncertainties || [];
    const source = data.source || {};
    const material = data.material || {};
    const officialPortal = assessment.portalUrl || data.officialPortal || source.link || null;
    const licenseUrl = source.licenseUrl || (source.license && source.license.url) || officialPortal || null;
    const disclaimer = assessment.disclaimer || data.disclaimer || '';
    const outcomeCls = OUTCOME_CLASS[outcome] || 'unclear';

    const conditionsListHtml = (conditions || []).map((c) => `<li>${esc(c)}</li>`).join('');
    const uncertaintiesListHtml = (uncertainties || []).map((u) => `<li>${esc(u)}</li>`).join('');

    const portalBtnHtml = officialPortal
      ? `<div style="margin-top:14px"><a class="btn btn-ghost" href="${esc(officialPortal)}" target="_blank" rel="noopener noreferrer">Open Official Publisher Portal / Policy ↗</a></div>`
      : '';

    const resCard = $('perm-result-card');
    resCard.innerHTML = `
      <h2>Permission Evaluation Result</h2>
      <div class="outcome-box outcome-${outcomeCls}">
        <div class="outcome-title">
          <span>${outcome === 'Proceed Without Requesting Permission' ? '✓' : outcome === 'Permission May Be Required' ? '⚠️' : 'ℹ️'}</span>
          <span>${esc(outcome)}</span>
        </div>
        <p style="margin:4px 0 0;font-size:14.5px;line-height:1.5">${esc(explanation)}</p>
      </div>

      <div class="row">
        <div class="row-label">Evaluated publication &amp; verified source</div>
        <div class="meta-box">
          <div class="meta-row"><span class="meta-label">Exact Title:</span><span>${source.link ? `<a href="${esc(source.link)}" target="_blank" rel="noopener noreferrer">${esc(source.title || 'Untitled Work')}</a>` : esc(source.title || 'Untitled Work')}</span></div>
          ${source.authors ? `<div class="meta-row"><span class="meta-label">Author(s):</span><span>${esc(source.authors)}</span></div>` : ''}
          ${source.publisher ? `<div class="meta-row"><span class="meta-label">Publisher:</span><span>${esc(source.publisher)}</span></div>` : ''}
          ${source.doi ? `<div class="meta-row"><span class="meta-label">DOI / URL:</span><code><a href="${esc(source.link || `https://doi.org/${source.doi}`)}" target="_blank" rel="noopener noreferrer">${esc(source.doi)}</a></code></div>` : (source.link ? `<div class="meta-row"><span class="meta-label">URL:</span><code><a href="${esc(source.link)}" target="_blank" rel="noopener noreferrer">${esc(source.link)}</a></code></div>` : '')}
          <div class="meta-row"><span class="meta-label">Licence:</span><span>${licenseUrl ? `<a href="${esc(licenseUrl)}" target="_blank" rel="noopener noreferrer"><strong>${esc(source.licenseName || (source.license && source.license.name) || 'Traditional copyright / All Rights Reserved')}</strong> ↗</a>` : `<strong>${esc(source.licenseName || (source.license && source.license.name) || 'Traditional copyright / All Rights Reserved')}</strong>`}</span></div>
          <div class="meta-row"><span class="meta-label">Licence Source:</span><span class="badge b-neutral">${esc(source.licenseSource || 'Official Crossref Registry')}</span></div>
        </div>
      </div>

      <div class="row">
        <div class="row-label">Material details &amp; intended use</div>
        <div class="meta-box">
          <div class="meta-row"><span class="meta-label">Material:</span><span>${esc(material.exactMaterial || material.materialType || 'Specified material')} (${esc(material.materialType || 'figure')})</span></div>
          <div class="meta-row"><span class="meta-label">Intended Use:</span><span>${esc(material.intendedUse || 'research paper')} ${material.commercial ? '<span class="badge b-warn">Commercial</span>' : '<span class="badge b-good">Non-commercial</span>'} ${material.modified ? '<span class="badge b-warn">Modified/Adapted</span>' : '<span class="badge b-neutral">Unmodified</span>'}</span></div>
          <div class="meta-row"><span class="meta-label">Third-Party Status:</span><span>${material.thirdPartyCredit ? '<span class="badge b-bad">Credited to third party (requires third-party permission)</span>' : '<span class="badge b-good">Not credited to third party</span>'}</span></div>
        </div>
      </div>

      <div class="row">
        <div class="row-label">Stated conditions &amp; attribution requirements</div>
        <ul class="steps-list" style="margin-top:4px">${conditionsListHtml}</ul>
      </div>

      ${uncertainties.length ? `
      <div class="row">
        <div class="row-label">Uncertainties &amp; verification notes</div>
        <ul class="steps-list" style="margin-top:4px">${uncertaintiesListHtml}</ul>
      </div>` : ''}

      ${portalBtnHtml}

      <div class="row" style="margin-top:16px">
        <p class="caveat" style="margin:0">${esc(disclaimer || 'Legal notice: This assessment is informational guidance based on available licence metadata, not formal legal advice. Actual rights may depend on jurisdiction, specific institutional agreements, or third-party rights.')}</p>
      </div>
    `;
    resCard.hidden = false;

    // Render Draft section
    const draftText = typeof data.requestDraft === 'string'
      ? data.requestDraft
      : (data.draft && data.draft.body) || '';
    const subjMatch = draftText.match(/^Subject:\s*(.*)$/m);
    const draftSubject = (data.draft && data.draft.subject) || (subjMatch ? subjMatch[1] : `Permission Request: ${source.title || 'Material Reuse'}`);
    const draftCard = $('perm-draft-section');
    if (draftText) {
      const portalNote = assessment.usesRightslink
        ? 'This publisher manages permissions via RightsLink / Copyright Clearance Center. You can submit directly via their online portal or use this letter draft for direct inquiries.'
        : 'Official publisher contact or permissions desk. CiteSure does not send emails automatically.';
      draftCard.innerHTML = `
        <h2>Permission Request Draft</h2>
        <p class="muted" style="margin-bottom:12px">Review, customize, and copy this formal request letter. You can submit it via the publisher’s online permissions portal (e.g. RightsLink) or send it to their rights department. <em>CiteSure does not send emails automatically.</em></p>
        <div class="note" style="margin-bottom:14px;background:#f3f6ff;border:1px solid #c8d3f8;color:#1b2f8f;padding:10px 14px;border-radius:8px">${esc(portalNote)}</div>
        <div class="field">
          <label for="perm-draft-subject">Subject Line</label>
          <input type="text" id="perm-draft-subject" class="input-text" value="${esc(draftSubject)}" />
        </div>
        <div class="field">
          <label for="perm-draft-body">Formal Permission Request Letter</label>
          <textarea id="perm-draft-body" rows="14" style="font-family:var(--font);font-size:13.5px;line-height:1.55">${esc(draftText)}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="perm-copy-draft">Copy Request Draft</button>
          <button type="button" class="btn btn-primary" id="perm-download-draft">Download Draft (.txt)</button>
        </div>
      `;
      draftCard.hidden = false;

      $('perm-copy-draft').addEventListener('click', async (e) => {
        const bodyText = $('perm-draft-body').value;
        try {
          await navigator.clipboard.writeText(bodyText);
          e.target.textContent = 'Copied!';
        } catch (_) {
          e.target.textContent = 'Copy failed – use Download';
        }
        setTimeout(() => (e.target.textContent = 'Copy Request Draft'), 2000);
      });

      $('perm-download-draft').addEventListener('click', () => {
        const bodyText = $('perm-draft-body').value;
        download('permission-request-draft.txt', bodyText, 'text/plain;charset=utf-8');
      });
    } else {
      draftCard.hidden = true;
    }

    smoothScroll(resCard);
  }

  // ---------- corrections: review & export ----------
  function stagedChanges() {
    const out = [];
    for (const i of state.analysis.issues) {
      const d = state.decisions[i.id];
      if (!d) continue;
      let to = null;
      if (d.status === 'applied') to = i.replacement;
      if (d.status === 'edited') to = d.text;
      if (to === null || to === i.fragment) continue;
      out.push({ issue: i, to });
    }
    return out;
  }
  function updateReviewButton() {
    const n = stagedChanges().length;
    const b = $('open-review');
    b.textContent = `Review changes (${n})`;
    b.disabled = n === 0;
  }

  function buildCorrected(changes) {
    const text = state.analysis.text;
    const sorted = [...changes].sort((a, b) => a.issue.start - b.issue.start || a.issue.end - b.issue.end);
    const applied = [];
    const conflicts = [];
    let lastEnd = -1;
    for (const c of sorted) {
      if (c.issue.start < lastEnd) conflicts.push(c);
      else {
        applied.push(c);
        lastEnd = c.issue.end;
      }
    }
    let out = text;
    for (const c of [...applied].reverse()) out = out.slice(0, c.issue.start) + c.to + out.slice(c.issue.end);
    return { text: out, applied, conflicts };
  }

  $('open-review').addEventListener('click', () => {
    renderReview();
    $('review-dialog').showModal();
  });
  function renderReview() {
    const ch = stagedChanges();
    $('review-list').innerHTML = ch
      .map(
        ({ issue: i, to }) => `<li class="review-item"><input type="checkbox" id="inc-${i.id}" data-inc="${i.id}" ${state.included[i.id] !== false ? 'checked' : ''} aria-label="Include this change" />
        <div><div><strong>${esc(TYPE_LABELS[i.type] || i.type)}</strong> <span class="muted">· ${i.location === 'reference' ? 'Reference list' : 'In-text'}</span></div>
        <div class="muted" style="font-size:13px;margin:2px 0 6px">${esc(i.problem)}</div>
        <div class="diff"><div class="old">${esc(i.fragment) || '(nothing)'}</div><div class="new">${esc(to) || '(remove)'}</div></div></div></li>`
      )
      .join('');
    const sel = ch.filter((c) => state.included[c.issue.id] !== false);
    const { conflicts } = buildCorrected(sel);
    $('review-conflicts').hidden = !conflicts.length;
    $('review-conflicts').textContent = conflicts.length ? `${conflicts.length} change(s) overlap another change and will be skipped: ${conflicts.map((c) => TYPE_LABELS[c.issue.type]).join(', ')}. Apply them one at a time or edit manually.` : '';
  }
  $('review-list').addEventListener('change', (e) => {
    if (e.target.dataset.inc) {
      state.included[e.target.dataset.inc] = e.target.checked;
      renderReview();
    }
  });
  function correctedText() {
    const sel = stagedChanges().filter((c) => state.included[c.issue.id] !== false);
    return buildCorrected(sel).text;
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('download-corrected').addEventListener('click', () => download('citesure-corrected.txt', correctedText(), 'text/plain;charset=utf-8'));
  $('copy-corrected').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(correctedText());
      e.target.textContent = 'Copied';
    } catch (_) {
      e.target.textContent = 'Copy failed – use Download';
    }
    setTimeout(() => (e.target.textContent = 'Copy corrected text'), 1800);
  });

  // ---------- report ----------
  function reportData() {
    const a = state.analysis;
    const items = evidenceItems();
    const claims = items.filter((i) => i.kind === 'claim');
    const verdictCounts = { Supported: 0, 'Weakly Supported': 0, Mismatched: 0, Unverifiable: 0 };
    let unchecked = 0;
    claims.forEach((i) => (i.verdict ? verdictCounts[i.verdict]++ : unchecked++));
    return { a, claims, verdictCounts, unchecked, uncited: items.filter((i) => i.kind === 'uncited') };
  }

  function renderReport() {
    if (!state.analysis) return;
    const { a, claims, verdictCounts, unchecked, uncited } = reportData();
    const llm = a.llm.enabled ? `${a.llm.provider} (${a.llm.model})` : 'keyword/number check only (no LLM configured)';
    $('report-meta').textContent = `${STYLE_LABELS[a.style]} · generated ${new Date().toLocaleString()}`;
    const fmtRows = a.issues
      .map((i) => `<tr><td>${esc(i.severity)}</td><td>${esc(TYPE_LABELS[i.type] || i.type)}<br><span class="muted">${i.location === 'reference' ? 'Reference list' : 'In-text'}</span></td><td>${esc(i.fragment)}</td><td>${esc(i.problem)}</td><td>${esc(i.replacement !== null ? i.replacement || '(remove)' : i.suggestion)}</td><td>${esc(DECISION_LABEL[decisionOf(i.id)])}</td></tr>`)
      .join('');
    const problems = claims.filter((c) => c.verdict && c.verdict !== 'Supported');
    const evRows = problems
      .map((i) => {
        const r = i.v.result;
        return `<tr><td>${esc(r.verdict)}<br><span class="muted">${esc(r.confidence)} confidence</span></td><td>${esc(i.claim.sentence)}<br><span class="muted">${esc(i.claim.citation)}</span></td><td>${r.source.link ? `<a href="${esc(r.source.link)}">${esc(r.source.title || r.source.doi || r.source.link)}</a>` : esc(r.source.title || '—')}<br><span class="muted">${esc(ACCESS_LABELS[r.source.accessLevel])}</span></td><td>${(r.evidence || []).map((x) => `“${esc(x.text)}”`).join('<br>') || '<span class="muted">No excerpt</span>'}</td><td>${esc(r.explanation)}</td></tr>`;
      })
      .join('');
    const okRows = claims
      .filter((c) => c.verdict === 'Supported')
      .map((i) => `<tr><td>${esc(i.claim.sentence)}<br><span class="muted">${esc(i.claim.citation)}</span></td><td>${esc(i.v.result.source.title || '—')}</td><td>${esc(i.v.result.confidence)}</td></tr>`)
      .join('');
    $('report-body').innerHTML = `
      <h2>Overview</h2>
      <p>${a.citations.length} in-text citation(s), ${a.references.length} reference(s), ${claims.length} cited claim(s) checked${unchecked ? ` (${unchecked} not yet checked)` : ''}.</p>
      <p><strong>Formatting issues:</strong> ${a.issues.length} · <strong>Evidence verdicts:</strong> ${Object.entries(verdictCounts).map(([k, v]) => `${k} ${v}`).join(', ')} · <strong>Uncited claims:</strong> ${uncited.length} · <strong>Safety findings:</strong> ${((a.safety && a.safety.findings) || []).length}</p>
      <p class="caveat">Claim comparison method: ${esc(llm)}. Sources behind paywalls are marked Unverifiable, never Mismatched. A found DOI alone is not treated as evidence.</p>

      <h2>Part 1 · Formatting errors (${a.issues.length})</h2>
      ${a.issues.length ? `<table><thead><tr><th>Severity</th><th>Type</th><th>Original</th><th>Problem</th><th>Suggestion</th><th>Decision</th></tr></thead><tbody>${fmtRows}</tbody></table>` : '<p class="muted">No formatting issues detected.</p>'}

      <h2>Part 2 · Evidence problems (${problems.length + uncited.length})</h2>
      ${problems.length ? `<table><thead><tr><th>Verdict</th><th>Claim</th><th>Source</th><th>Evidence excerpt</th><th>Explanation</th></tr></thead><tbody>${evRows}</tbody></table>` : '<p class="muted">No evidence problems among the claims checked so far.</p>'}
      ${uncited.length ? `<h3>Uncited claims (not checked against any source)</h3><ul>${uncited.map((u) => `<li>${esc(u.claim.sentence)} <span class="muted">(${esc(u.claim.reason)})</span></li>`).join('')}</ul>` : ''}
      ${okRows ? `<h3>Supported claims (${claims.filter((c) => c.verdict === 'Supported').length})</h3><table><thead><tr><th>Claim</th><th>Source</th><th>Confidence</th></tr></thead><tbody>${okRows}</tbody></table>` : ''}

      <h2>Part 3 · Copyright &amp; citation safety (${((a.safety && a.safety.findings) || []).length})</h2>
      ${((a.safety && a.safety.findings) || []).length ? `<table><thead><tr><th>Severity</th><th>Classification</th><th>Category &amp; Location</th><th>Finding snippet</th><th>Explanation</th><th>Recommended next action</th></tr></thead><tbody>${((a.safety && a.safety.findings) || []).map((f) => `<tr><td>${esc(f.severity)}</td><td>${esc(f.classification)}</td><td>${esc(CATEGORY_LABELS[f.category] || f.category)}<br><span class="muted">${esc(f.location)}</span></td><td>${esc(f.snippet)}</td><td>${esc(f.explanation)}</td><td>${esc(f.recommendation)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No copyright or citation safety issues detected.</p>'}
      <p class="caveat">Guidance notice: Text similarity and automated licence scans are academic guidance rather than a legal guarantee. Text similarity alone does not constitute proof of plagiarism or copyright infringement. Open-access or online availability does not eliminate attribution or reuse permissions requirements.</p>
    `;
  }
  $('report-print').addEventListener('click', () => window.print());
  $('report-download').addEventListener('click', () => {
    const { a, claims, verdictCounts, uncited } = reportData();
    const sFindings = (a.safety && a.safety.findings) || [];
    const L = [];
    L.push(`# CiteSure report (${STYLE_LABELS[a.style]})`, '');
    L.push(`Claim comparison: ${a.llm.enabled ? `${a.llm.provider} (${a.llm.model})` : 'keyword/number check only'}`, '');
    L.push(`## Part 1 · Formatting errors (${a.issues.length})`, '');
    for (const i of a.issues) {
      L.push(`- **[${i.severity}] ${TYPE_LABELS[i.type] || i.type}** (${i.location}): ${i.problem}`);
      L.push(`  - Original: \`${i.fragment.replace(/`/g, "'")}\``);
      L.push(`  - Suggestion: ${i.replacement !== null ? '`' + (i.replacement || '(remove)').replace(/`/g, "'") + '`' : i.suggestion}`);
      L.push(`  - Decision: ${DECISION_LABEL[decisionOf(i.id)]}`);
    }
    L.push('', `## Part 2 · Evidence problems`, '', `Verdicts: ${Object.entries(verdictCounts).map(([k, v]) => `${k} ${v}`).join(', ')}; uncited claims ${uncited.length}`, '');
    for (const i of claims.filter((c) => c.verdict && c.verdict !== 'Supported')) {
      const r = i.v.result;
      L.push(`- **${r.verdict}** (${r.confidence} confidence) – ${i.claim.sentence} ${i.claim.citation}`);
      L.push(`  - Source: ${r.source.title || 'unknown'}${r.source.link ? ' – ' + r.source.link : ''} [${ACCESS_LABELS[r.source.accessLevel]}]`);
      (r.evidence || []).forEach((x) => L.push(`  - Excerpt: "${x.text}"`));
      L.push(`  - ${r.explanation}`);
    }
    for (const u of uncited) L.push(`- **Uncited claim** – ${u.claim.sentence} (${u.claim.reason})`);

    L.push('', `## Part 3 · Copyright & Citation Safety (${sFindings.length})`, '');
    L.push('Guidance notice: Text similarity alone is never proof of infringement or plagiarism. Results are guidance rather than a legal guarantee.', '');
    for (const f of sFindings) {
      L.push(`- **[${f.severity.toUpperCase()}] ${f.classification}** (${CATEGORY_LABELS[f.category] || f.category} · ${f.location})`);
      L.push(`  - Snippet: "${f.snippet}"`);
      L.push(`  - Explanation: ${f.explanation}`);
      L.push(`  - Recommended action: ${f.recommendation.replace(/\n/g, ' ')}`);
      if (f.source && (f.source.title || f.source.doi)) {
        L.push(`  - Source: ${f.source.title || ''}${f.source.doi ? ' (DOI: ' + f.source.doi + ')' : ''}${f.source.license ? ' [' + f.source.license.name + ']' : ''}`);
      }
    }

    download('citesure-report.md', L.join('\n'), 'text/markdown;charset=utf-8');
  });

  loadConfig();
})();
