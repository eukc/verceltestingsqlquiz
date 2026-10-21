/* ------------------------------------------------------------------
   UI logic. Questions live in js/problems.js, grading in js/engine.js.
   ------------------------------------------------------------------ */
(function () {
    'use strict';

    const STORAGE_KEY = 'sqlPractice.solved.v2';
    const $ = id => document.getElementById(id);

    let currentCategory = 'all';
    let currentList = PROBLEMS;
    let currentProblem = PROBLEMS[0];
    let solved = loadSolved();

    /* ---------- progress (saved in this browser) ---------- */

    function loadSolved() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(arr) ? arr : []);
        } catch (e) {
            return new Set();
        }
    }

    function saveSolved() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(solved))); } catch (e) { /* storage blocked, progress just won't persist */ }
    }

    function updateProgress() {
        const total = PROBLEMS.length;
        const done = PROBLEMS.filter(p => solved.has(p.id)).length;
        $('progress-text').textContent = `${done} / ${total}`;
        $('progress-bar').style.width = `${total ? (done / total) * 100 : 0}%`;
        refreshDropdownLabels();
    }

    /* ---------- small render helpers ---------- */

    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function fmt(v) {
        if (typeof v === 'number' && !Number.isInteger(v)) return String(Math.round(v * 10000) / 10000);
        return String(v);
    }

    function resultTable(result, label) {
        if (!result) return '';
        const head = result.columns.map(c => `<th>${esc(c)}</th>`).join('');
        const body = result.values.length
            ? result.values.map(row => '<tr>' + row.map(v => v === null ? '<td class="null-cell">NULL</td>' : `<td>${esc(fmt(v))}</td>`).join('') + '</tr>').join('')
            : `<tr><td class="empty-cell" colspan="${Math.max(result.columns.length, 1)}">0 rows</td></tr>`;
        return `<div class="mt-3">
            <div class="text-xs font-semibold text-gray-500 mb-1">${esc(label)}</div>
            <div class="result-wrap"><table class="result-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
        </div>`;
    }

    function box(tone, title, bodyHtml) {
        const tones = {
            success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
            error:   'bg-red-50 border-red-200 text-red-900',
            warn:    'bg-amber-50 border-amber-200 text-amber-900',
            info:    'bg-indigo-50 border-indigo-200 text-indigo-900'
        };
        return `<div class="p-3 border rounded-lg ${tones[tone]}"><strong>${title}</strong>${bodyHtml}</div>`;
    }

    function setOutput(html) {
        $('output-box').innerHTML = html;
    }

    function avgFootnote(sql) {
        return /\bAVG\s*\(/i.test(sql)
            ? '<p class="text-xs text-gray-500 mt-3">Note: this practice database shows decimals for AVG. SQL Server returns a whole number when you average an INT column.</p>'
            : '';
    }

    function showIntro() {
        setOutput('<p class="text-gray-400 italic">Type your query above, then click "Run Query" to see its output or "Check Answer" to be graded.</p>');
    }

    /* ---------- category tabs + dropdown ---------- */

    function buildTabs() {
        const wrap = $('category-tabs');
        wrap.innerHTML = '';
        const items = [{ id: 'all', label: 'All' }].concat(CATEGORIES);
        items.forEach(c => {
            const count = c.id === 'all' ? PROBLEMS.length : PROBLEMS.filter(p => p.category === c.id).length;
            const btn = document.createElement('button');
            btn.dataset.cat = c.id;
            btn.className = 'cat-btn px-3 py-1.5 rounded font-medium transition';
            btn.textContent = `${c.label} (${count})`;
            btn.addEventListener('click', () => filterCategory(c.id));
            wrap.appendChild(btn);
        });
        paintTabs();
    }

    function paintTabs() {
        document.querySelectorAll('.cat-btn').forEach(btn => {
            const active = btn.dataset.cat === currentCategory;
            btn.classList.toggle('bg-indigo-600', active);
            btn.classList.toggle('text-white', active);
            btn.classList.toggle('shadow-sm', active);
            btn.classList.toggle('bg-white', !active);
            btn.classList.toggle('text-gray-700', !active);
            btn.classList.toggle('border', !active);
            btn.classList.toggle('border-gray-300', !active);
            btn.classList.toggle('hover:bg-gray-100', !active);
        });
    }

    function optionLabel(p) {
        return `${solved.has(p.id) ? '✓ ' : ''}#${p.id}: ${p.title}`;
    }

    function populateDropdown(list) {
        const select = $('problem-select');
        select.innerHTML = '';
        list.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = optionLabel(p);
            select.appendChild(opt);
        });
    }

    function refreshDropdownLabels() {
        const select = $('problem-select');
        Array.from(select.options).forEach(opt => {
            const p = PROBLEMS.find(x => x.id == opt.value);
            if (p) opt.textContent = optionLabel(p);
        });
    }

    function filterCategory(cat) {
        currentCategory = cat;
        currentList = cat === 'all' ? PROBLEMS : PROBLEMS.filter(p => p.category === cat);
        paintTabs();
        populateDropdown(currentList);
        if (currentList.length) loadProblem(currentList[0].id);
    }

    /* ---------- loading a question ---------- */

    function loadProblem(id) {
        currentProblem = PROBLEMS.find(p => p.id == id) || PROBLEMS[0];
        $('problem-select').value = currentProblem.id;
        $('task-id').textContent = `Question #${currentProblem.id} of ${PROBLEMS.length}`;
        $('task-badge').textContent = currentProblem.topic;
        $('task-title').textContent = currentProblem.title;
        $('task-desc').textContent = currentProblem.desc;

        // Blank editor: no code visible before you type it yourself
        $('sql-editor').value = '';
        showIntro();
    }

    function step(delta) {
        const i = currentList.findIndex(p => p.id === currentProblem.id);
        const next = currentList[(i + delta + currentList.length) % currentList.length];
        loadProblem(next.id);
    }

    function randomProblem() {
        const pool = currentList.filter(p => p.id !== currentProblem.id && !solved.has(p.id));
        const source = pool.length ? pool : currentList.filter(p => p.id !== currentProblem.id);
        if (!source.length) return;
        loadProblem(source[Math.floor(Math.random() * source.length)].id);
    }

    /* ---------- sample data preview ---------- */

    function renderSampleData() {
        $('sample-data').innerHTML = resultTable({ columns: SAMPLE_COLUMNS, values: SAMPLE_STUDENTS }, '');
    }

    /* ---------- actions ---------- */

    function showHint() {
        setOutput(box('warn', '💡 Hint', `<pre class="mt-1 text-xs whitespace-pre-wrap">${esc(buildHint(currentProblem))}</pre>`));
    }

    function showSolution() {
        const note = currentProblem.note ? `<p class="text-xs mt-2 text-gray-700">${esc(currentProblem.note)}</p>` : '';
        setOutput(box('error', '🔑 Model Solution', `<pre class="mt-1 text-xs whitespace-pre-wrap">${esc(currentProblem.solution)}</pre>${note}`));
    }

    function getCode() {
        return $('sql-editor').value.trim();
    }

    function warnEmpty() {
        setOutput(box('warn', '⚠️ Nothing to run', '<p class="text-xs mt-1">Please type your SQL answer in the box first!</p>'));
    }

    function runQuery() {
        const code = getCode();
        if (code.length < 3) return warnEmpty();

        const r = Engine.run(code);
        if (!r.ok) {
            return setOutput(box('error', '❌ SQL error', `<p class="text-xs mt-1">${esc(r.error)}</p>`));
        }
        if (r.tableState) {
            const msg = r.tableMissing
                ? '<p class="text-xs mt-1">The Students table does not exist anymore after this statement.</p>'
                : resultTable(r.result, 'Statement ran. The Students table now looks like this:');
            return setOutput(box('info', 'Statement executed', msg));
        }
        const n = r.result.values.length;
        setOutput(r.zeroRows
            ? box('info', 'Query ran', '<p class="text-xs mt-1">0 rows returned.</p>')
            : resultTable(r.result, `Output (${n} row${n === 1 ? '' : 's'})`) + avgFootnote(code));
    }

    function checkAnswer() {
        const code = getCode();
        if (code.length < 3) return warnEmpty();

        const r = Engine.grade(currentProblem, code);

        if (r.status === 'error') {
            return setOutput(box('error', '❌ SQL error', `<p class="text-xs mt-1">${esc(r.message)}</p>`));
        }

        const yourLabel = r.tableState ? 'Your Students table after the statement' : 'Your output';
        const expectedLabel = r.tableState ? 'Expected Students table' : 'Expected output';

        if (r.status === 'pass') {
            solved.add(currentProblem.id);
            saveSolved();
            updateProgress();
            const note = currentProblem.note ? `<p class="text-xs mt-2 text-emerald-800">${esc(currentProblem.note)}</p>` : '';
            return setOutput(box('success', '✅ Correct! Excellent job!', `<p class="text-xs mt-1">${esc(r.message)}</p>${note}`)
                + (r.userResult && !r.tableState ? resultTable(r.userResult, yourLabel) : '')
                + avgFootnote(code));
        }

        setOutput(box('error', '❌ Not quite', `<p class="text-xs mt-1">${esc(r.message)}</p>`)
            + (r.userResult ? resultTable(r.userResult, yourLabel) : '')
            + (r.expectedResult ? resultTable(r.expectedResult, expectedLabel) : '')
            + avgFootnote(code));
    }

    function resetProgress() {
        if (!confirm('Clear all solved marks?')) return;
        solved = new Set();
        saveSolved();
        updateProgress();
    }

    /* ---------- engine status chip ---------- */

    function setEngineChip(state) {
        const chip = $('engine-status');
        const styles = {
            loading: ['Loading SQL engine...', 'bg-amber-100 text-amber-800 border-amber-300'],
            ready:   ['SQL engine ready',       'bg-emerald-100 text-emerald-800 border-emerald-300'],
            offline: ['Offline: exact-match mode', 'bg-red-100 text-red-800 border-red-300']
        };
        chip.className = 'text-xs px-3 py-1.5 rounded-full font-mono border ' + styles[state][1];
        chip.textContent = styles[state][0];
    }

    /* ---------- wiring ---------- */

    function wireEvents() {
        $('problem-select').addEventListener('change', e => loadProblem(e.target.value));
        $('btn-prev').addEventListener('click', () => step(-1));
        $('btn-next').addEventListener('click', () => step(1));
        $('btn-random').addEventListener('click', randomProblem);
        $('btn-hint').addEventListener('click', showHint);
        $('btn-solution').addEventListener('click', showSolution);
        $('btn-run').addEventListener('click', runQuery);
        $('btn-check').addEventListener('click', checkAnswer);
        $('btn-clear').addEventListener('click', () => { $('sql-editor').value = ''; $('sql-editor').focus(); });
        $('btn-reset-progress').addEventListener('click', resetProgress);

        $('sql-editor').addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                checkAnswer();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                const ta = e.target;
                const s = ta.selectionStart;
                ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(ta.selectionEnd);
                ta.selectionStart = ta.selectionEnd = s + 4;
            }
        });
    }

    async function start() {
        buildTabs();
        populateDropdown(currentList);
        renderSampleData();
        wireEvents();
        loadProblem(PROBLEMS[0].id);
        updateProgress();

        setEngineChip('loading');
        const state = await Engine.init();
        setEngineChip(state);
    }

    window.addEventListener('load', start);
})();
