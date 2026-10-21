/* ------------------------------------------------------------------
   Grading engine
   Runs the student's SQL against a real (SQLite) in-browser database
   seeded with the Students table, then compares the RESULT with the
   result of the model solution. So any correct way of writing the query
   passes, and a query that only looks right but returns wrong data fails.

   Limits: this is SQLite, not SQL Server. Normal SELECT / UPDATE / INSERT /
   DELETE behave the same for these exercises. SQL Server-only statements
   (IDENTITY, CREATE DATABASE, USE) are graded by pattern matching instead.
   ------------------------------------------------------------------ */
const Engine = (() => {
    const SQLJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/';
    let SQL = null;
    let status = 'loading'; // 'loading' | 'ready' | 'offline'

    async function init(options) {
        const opts = options || {};
        try {
            if (typeof initSqlJs !== 'function') throw new Error('sql.js script did not load');
            SQL = await initSqlJs({ locateFile: opts.locateFile || (file => SQLJS_BASE + file) });
            status = 'ready';
        } catch (err) {
            console.warn('SQL engine unavailable, falling back to exact-match grading:', err);
            status = 'offline';
        }
        return status;
    }

    function getStatus() { return status; }

    /* ---------- database helpers ---------- */

    function freshDb() {
        const db = new SQL.Database();
        // COLLATE NOCASE makes text comparisons case-insensitive, like SQL Server's default.
        db.run(`CREATE TABLE Students (
            StudentID INTEGER PRIMARY KEY,
            FirstName TEXT COLLATE NOCASE,
            LastName  TEXT COLLATE NOCASE,
            Course    TEXT COLLATE NOCASE,
            YearLevel INTEGER,
            Age       INTEGER,
            Grades    INTEGER,
            Tuition   INTEGER
        )`);
        const stmt = db.prepare('INSERT INTO Students VALUES (?,?,?,?,?,?,?,?)');
        SAMPLE_STUDENTS.forEach(row => stmt.run(row));
        stmt.free();
        return db;
    }

    function stripComments(sql) {
        return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
    }

    function lastStatement(sql) {
        const parts = stripComments(sql).split(';').map(s => s.trim()).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    function isSelect(sql) {
        return /^(SELECT|WITH)\b/i.test(lastStatement(sql));
    }

    // Result of the last statement that returned rows, or an empty result for a SELECT with 0 rows.
    function queryResult(db, sql) {
        const res = db.exec(sql);
        if (res.length) return res[res.length - 1];
        return { columns: [], values: [] };
    }

    // Current content of the Students table, or null if it no longer exists.
    function tableState(db) {
        try {
            const res = db.exec('SELECT * FROM Students ORDER BY StudentID');
            return res.length ? res[0] : { columns: SAMPLE_COLUMNS.slice(), values: [] };
        } catch (e) {
            return null;
        }
    }

    /* ---------- comparison ---------- */

    function normValue(v) {
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return 'n:' + (Math.round(v * 1e6) / 1e6);
        return 's:' + String(v);
    }

    function normRows(rows, ordered) {
        const list = rows.map(r => JSON.stringify(r.map(normValue)));
        return ordered ? list : list.slice().sort();
    }

    function compare(expected, actual, opts) {
        if (!actual) return { ok: false, msg: 'Nothing was returned.' };
        if (actual.values.length === 0 && expected.values.length > 0) {
            return { ok: false, msg: 'Your query returned no rows, but rows were expected. Check your WHERE condition and spelling.' };
        }
        if (actual.columns.length !== expected.columns.length) {
            return { ok: false, msg: `Expected ${expected.columns.length} column(s) but your query returned ${actual.columns.length}.` };
        }
        if (opts.checkNames) {
            for (let i = 0; i < expected.columns.length; i++) {
                if (expected.columns[i].toLowerCase() !== actual.columns[i].toLowerCase()) {
                    return { ok: false, msg: `Column ${i + 1} should be named "${expected.columns[i]}" but it is "${actual.columns[i]}". Check your alias spelling.` };
                }
            }
        }
        if (actual.values.length !== expected.values.length) {
            return { ok: false, msg: `Expected ${expected.values.length} row(s) but your query returned ${actual.values.length}.` };
        }
        const a = normRows(actual.values, opts.ordered);
        const e = normRows(expected.values, opts.ordered);
        for (let i = 0; i < e.length; i++) {
            if (a[i] !== e[i]) return { ok: false, msg: 'The right number of rows came back, but the values are different from what is expected.' };
        }
        return { ok: true };
    }

    /* ---------- requirements that must literally appear in the answer ---------- */

    function requiredPatterns(p) {
        const req = [];
        ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].forEach(fn => {
            if (new RegExp('\\b' + fn + '\\s*\\(', 'i').test(p.solution)) {
                req.push([new RegExp('\\b' + fn + '\\s*\\(', 'i'), fn + '()']);
            }
        });
        (p.must || []).forEach(m => req.push(m));
        return req;
    }

    function missingRequirements(p, code) {
        const clean = stripComments(code);
        return requiredPatterns(p).filter(([re]) => !re.test(clean)).map(([, label]) => label);
    }

    /* ---------- text normalising (offline mode and T-SQL-only questions) ---------- */

    function normText(sql) {
        return stripComments(sql).toUpperCase().replace(/\s+/g, '').replace(/;/g, '');
    }

    /* ---------- grading ---------- */

    function gradeText(p, code) {
        const n = normText(code);
        let ok;
        if (p.equals) ok = n === p.equals;
        else ok = (p.contains || []).every(piece => n.includes(piece));
        return ok
            ? { status: 'pass', mode: 'pattern', message: 'Correct. (This one uses SQL Server syntax, so it is checked by pattern, not run.)' }
            : { status: 'fail', mode: 'pattern', message: 'Not quite. (This one uses SQL Server syntax, so it is checked by pattern, not run.) Check the statement and column definitions against the question.' };
    }

    function gradeOffline(p, code) {
        const ok = normText(code) === normText(p.solution);
        return ok
            ? { status: 'pass', mode: 'offline', message: 'Matches the model answer. (Offline mode: only the exact model answer is accepted.)' }
            : { status: 'fail', mode: 'offline', message: 'Does not match the model answer. (Offline mode: the SQL engine could not load, so only an exact match counts. Reconnect and reload for full checking.)' };
    }

    function gradeQuery(p, code) {
        const expDb = freshDb();
        const usrDb = freshDb();
        try {
            const expected = queryResult(expDb, p.solution);
            let actual;
            try {
                actual = queryResult(usrDb, code);
            } catch (err) {
                return { status: 'error', mode: 'run', message: err.message };
            }
            const cmp = compare(expected, actual, {
                checkNames: /\bAS\b/i.test(p.solution),
                ordered: /\bORDER\s+BY\b/i.test(p.solution)
            });
            const result = { mode: 'run', userResult: actual, expectedResult: expected };
            if (!cmp.ok) return Object.assign(result, { status: 'fail', message: cmp.msg });

            const missing = missingRequirements(p, code);
            if (missing.length) {
                return Object.assign(result, {
                    status: 'fail',
                    message: `Your output is right, but the question wants you to use ${missing.join(', ')}. Write the query the way it asks.`
                });
            }
            return Object.assign(result, { status: 'pass', message: 'Your query returns exactly the expected result.' });
        } finally {
            expDb.close();
            usrDb.close();
        }
    }

    function gradeDml(p, code) {
        const expDb = freshDb();
        const usrDb = freshDb();
        try {
            expDb.exec(p.solution);
            try {
                usrDb.exec(code);
            } catch (err) {
                return { status: 'error', mode: 'run', message: err.message };
            }
            const expected = tableState(expDb);
            const actual = tableState(usrDb);
            const result = { mode: 'run', userResult: actual, expectedResult: expected, tableState: true };
            if (!actual) {
                return Object.assign(result, { status: 'fail', message: 'The Students table no longer exists after your statement. Did you drop it instead of changing its rows?' });
            }
            const cmp = compare(expected, actual, { checkNames: false, ordered: true });
            if (!cmp.ok) {
                return Object.assign(result, { status: 'fail', message: 'After your statement the Students table does not look the way it should. Check your WHERE condition and the values you set.' });
            }
            return Object.assign(result, { status: 'pass', message: 'After your statement the Students table matches what is expected.' });
        } finally {
            expDb.close();
            usrDb.close();
        }
    }

    function grade(p, code) {
        const sql = code.trim();
        if (p.type === 'text') return gradeText(p, sql);
        if (status === 'loading') return { status: 'error', mode: 'run', message: 'The SQL engine is still loading. Try again in a moment.' };
        if (status !== 'ready') return gradeOffline(p, sql);
        return p.type === 'dml' ? gradeDml(p, sql) : gradeQuery(p, sql);
    }

    /* Run a query without grading it (the "Run Query" button). */
    function run(code) {
        if (status === 'loading') return { ok: false, error: 'The SQL engine is still loading. Try again in a moment.' };
        if (status !== 'ready') return { ok: false, error: 'The SQL engine could not load (check your internet connection and reload). Check Answer still works in exact-match mode.' };
        const db = freshDb();
        try {
            const res = db.exec(code);
            if (res.length) return { ok: true, result: res[res.length - 1] };
            if (isSelect(code)) return { ok: true, result: { columns: [], values: [] }, zeroRows: true };
            const state = tableState(db);
            return { ok: true, result: state, tableState: true, tableMissing: state === null };
        } catch (err) {
            return { ok: false, error: err.message };
        } finally {
            db.close();
        }
    }

    return { init, getStatus, grade, run };
})();
