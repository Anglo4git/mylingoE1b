/*
 * Mylingo Authoring Scale + Incremental Validation
 *
 * Before this module, the authoring app's live-edit path re-validated the
 * ENTIRE dataset (every row's field checks, plus a full rebuild of every
 * quiz_id's row grouping and cross-row consistency checks) on every single
 * keystroke. That cost is O(total rows in the authoring session), so typing
 * gets progressively slower as the authored dataset grows toward production
 * scale (hundreds of quizzes / thousands of rows).
 *
 * This module keeps the exact same validation RULES (ported verbatim, same
 * messages, same order) but restructures HOW they are recomputed:
 *
 *   - Per-row field checks (getRowIssues) are already a pure function of one
 *     row, so an edit only ever needs to recompute the ONE row that changed.
 *   - Cross-row, per-quiz checks (computeQuizGroupIssues) are recomputed only
 *     for the quiz_id group(s) actually touched by an edit (at most two: the
 *     row's previous quiz_id and its new one, if quiz_id itself changed) —
 *     never by rebuilding a fresh grouping of the whole dataset.
 *   - Summary counters (rows/quizzes with issues) are maintained as running
 *     totals updated on each transition, not recomputed by rescanning every
 *     row/quiz on every call.
 *
 * A full dataset rescan (fullRecompute) is still provided and is the right
 * tool after genuinely bulk operations (import, pack, bulk delete, undo/
 * redo, initial load) where every row is already being touched anyway. The
 * win is specifically on the single-field-edit hot path.
 *
 * Loaded as a plain browser global (window.MylingoAuthoringValidation), same
 * pattern as quiz-packer.js / review-scheduler.js / skill-mastery.js, so it
 * works both from the standalone authoring HTML file (no fetch/bundler) and
 * from a Node `vm` context in unit tests.
 */
(function (global) {
  "use strict";

  const DEFAULT_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const DEFAULT_VALID_STATUSES = [
    "draft",
    "in_review",
    "approved",
    "published",
    "retired"
  ];
  const DEFAULT_ANSWER_FIELDS = Array.from(
    { length: 9 },
    (_, index) => `answer_${index + 1}`
  );
  const DEFAULT_MIN_QUESTIONS_PER_QUIZ = 5;
  const DEFAULT_MAX_QUESTIONS_PER_QUIZ = 150;

  function resolveConfig(config) {
    const cfg = config || {};
    return {
      LEVELS:
        Array.isArray(cfg.LEVELS) && cfg.LEVELS.length
          ? cfg.LEVELS
          : DEFAULT_LEVELS,
      VALID_STATUSES:
        Array.isArray(cfg.VALID_STATUSES) && cfg.VALID_STATUSES.length
          ? cfg.VALID_STATUSES
          : DEFAULT_VALID_STATUSES,
      ANSWER_FIELDS:
        Array.isArray(cfg.ANSWER_FIELDS) && cfg.ANSWER_FIELDS.length
          ? cfg.ANSWER_FIELDS
          : DEFAULT_ANSWER_FIELDS,
      MIN_QUESTIONS_PER_QUIZ: Number.isFinite(cfg.MIN_QUESTIONS_PER_QUIZ)
        ? cfg.MIN_QUESTIONS_PER_QUIZ
        : DEFAULT_MIN_QUESTIONS_PER_QUIZ,
      MAX_QUESTIONS_PER_QUIZ: Number.isFinite(cfg.MAX_QUESTIONS_PER_QUIZ)
        ? cfg.MAX_QUESTIONS_PER_QUIZ
        : DEFAULT_MAX_QUESTIONS_PER_QUIZ
    };
  }

  function normalizeLevelWith(levels, value) {
    const normalized = String(value ?? "")
      .trim()
      .toUpperCase();
    if (levels.includes(normalized)) {
      return normalized;
    }
    return normalized || "A1";
  }

  function quizIdOf(row) {
    return String(row && row.quiz_id != null ? row.quiz_id : "").trim();
  }

  /*
   * Ported verbatim from the pre-Milestone-23 authoring app's per-row
   * getRowIssues(): identical rules, identical message text, identical
   * order. A pure function of a single row — never needs any other row's
   * data, so it is always safe (and cheap) to call for just one row.
   */
  function getRowIssues(row, config) {
    const cfg = resolveConfig(config);
    const issues = [];

    [
      "quiz_id",
      "level",
      "title",
      "description",
      "quiz_category",
      "quiz_tags",
      "version",
      "status",
      "question_number",
      "question_text",
      "question_category",
      "question_tags",
      "explanation",
      "correct_index"
    ].forEach(field => {
      if (String(row[field] ?? "").trim() === "") {
        issues.push(`Missing ${field}`);
      }
    });

    if (
      row.level &&
      !cfg.LEVELS.includes(normalizeLevelWith(cfg.LEVELS, row.level))
    ) {
      issues.push(`Unrecognized level "${row.level}"`);
    }

    const version = Number(row.version);
    if (!Number.isInteger(version) || version < 1) {
      issues.push("version must be a positive integer");
    }

    const status = String(row.status || "").trim().toLowerCase();
    if (!cfg.VALID_STATUSES.includes(status)) {
      issues.push(`Unrecognized status "${row.status}"`);
    }

    const questionNumber = Number(row.question_number);
    if (!Number.isInteger(questionNumber) || questionNumber < 1) {
      issues.push("question_number must be a positive integer");
    }

    const answers = [];
    let gapFound = false;
    cfg.ANSWER_FIELDS.forEach((field, index) => {
      const value = String(row[field] ?? "").trim();
      if (!value) {
        gapFound = true;
        return;
      }
      if (gapFound) {
        issues.push(`Gap before answer_${index + 1}`);
      }
      answers.push(value);
    });

    if (answers.length < 2) {
      issues.push("At least 2 answer options are required");
    }

    const correctIndex = Number(row.correct_index);
    if (
      !Number.isInteger(correctIndex) ||
      correctIndex < 1 ||
      correctIndex > answers.length
    ) {
      issues.push(
        `correct_index must be 1-${Math.max(answers.length, 2)} and 1-based`
      );
    }

    const normalizedAnswers = answers.map(answer => answer.toLowerCase());
    if (new Set(normalizedAnswers).size !== normalizedAnswers.length) {
      issues.push("Duplicate answer options within one question");
    }

    if (String(row.explanation || "").trim().length < 10) {
      issues.push("Explanation should be at least 10 characters");
    }

    return issues;
  }

  /*
   * Ported verbatim from the pre-Milestone-23 per-quiz block inside
   * computeValidation(): identical cross-row consistency checks. The only
   * change from the original is that it now takes just the rows for ONE
   * quiz_id (via the caller's index) instead of being handed a byQuiz Map
   * that was rebuilt from the entire dataset on every call. Cost is O(rows
   * in this one quiz), independent of total dataset size.
   *
   * Canonical v2 source fields are used throughout: question numbering comes
   * from `question_number`, and quiz-level category consistency comes from
   * `quiz_category`. `question_category` is intentionally not required to be
   * uniform because it can vary by question within one quiz.
   */
  function computeQuizGroupIssues(rows, config) {
    const cfg = resolveConfig(config);
    const issues = [];
    const count = rows.length;

    if (count < cfg.MIN_QUESTIONS_PER_QUIZ) {
      issues.push(
        `Only ${count} question(s) — needs at least ${cfg.MIN_QUESTIONS_PER_QUIZ}`
      );
    }

    if (count > cfg.MAX_QUESTIONS_PER_QUIZ) {
      issues.push(`${count} questions — maximum is ${cfg.MAX_QUESTIONS_PER_QUIZ}`);
    }

    const firstRow = rows[0];
    const quizId = quizIdOf(firstRow);

    [
      "level",
      "title",
      "description",
      "quiz_category",
      "quiz_tags",
      "version",
      "status"
    ].forEach(field => {
      const expected = String(firstRow?.[field] ?? "").trim();
      if (rows.some(row => String(row[field] ?? "").trim() !== expected)) {
        issues.push(`Inconsistent ${field} within quiz_id "${quizId}"`);
      }
    });

    const seenQuestionTexts = new Set();
    rows.forEach(row => {
      const text = String(row.question_text ?? "").trim().toLowerCase();
      if (text && seenQuestionTexts.has(text)) {
        issues.push(`Duplicate question_text in quiz_id "${quizId}"`);
      }
      if (text) seenQuestionTexts.add(text);
    });

    const seenQuestionNums = new Map();
    rows.forEach(row => {
      const key = String(row.question_number ?? "").trim();
      if (key === "") {
        return;
      }
      seenQuestionNums.set(key, (seenQuestionNums.get(key) || 0) + 1);
    });

    seenQuestionNums.forEach((occurrences, questionNum) => {
      if (occurrences > 1) {
        issues.push(`Duplicate question_number "${questionNum}" (${occurrences}x)`);
      }
    });

    const levels = new Set(
      rows.map(row => normalizeLevelWith(cfg.LEVELS, row.level))
    );
    if (levels.size > 1) {
      issues.push("Inconsistent level across this quiz's rows");
    }

    const quizCategories = new Set(
      rows.map(row => String(row.quiz_category ?? "").trim())
    );
    if (quizCategories.size > 1) {
      issues.push("Inconsistent quiz_category across this quiz's rows");
    }

    const titles = new Set(rows.map(row => String(row.title ?? "").trim()));
    if (titles.size > 1) {
      issues.push("Inconsistent title across this quiz's rows");
    }

    return {
      issues,
      level: normalizeLevelWith(cfg.LEVELS, rows[0].level),
      title: rows[0].title || "",
      category: rows[0].quiz_category || "",
      count
    };
  }

  /*
   * Incremental validation engine.
   *
   * Holds three pieces of state, all kept up to date incrementally rather
   * than being torn down and rebuilt on every call:
   *   - rowIssuesMap:  internalId -> issues[]
   *   - quizIssuesMap: quiz_id    -> { issues, level, title, category, count }
   *   - quizIndex:     quiz_id    -> Set<internalId>  (rows currently grouped
   *                    under that quiz_id; maintained on add/remove/edit
   *                    instead of being rebuilt from scratch)
   *
   * rowIssuesMap and quizIssuesMap are the SAME Map objects for the engine's
   * entire lifetime (mutated with .set()/.delete(), never reassigned), so a
   * caller can grab a reference once and it stays valid across every
   * incremental update.
   */
  function createEngine(config) {
    const cfg = resolveConfig(config);

    const rowIssuesMap = new Map();
    const quizIssuesMap = new Map();
    const quizIndex = new Map();
    const rowQuizId = new Map();
    const rowsById = new Map();

    let rowsWithIssuesCount = 0;
    let quizzesFailingCount = 0;
    let orphanCount = 0;

    function setRowIssues(internalId, issues) {
      const previous = rowIssuesMap.get(internalId);
      const hadIssues = Boolean(previous && previous.length);
      const hasIssues = Boolean(issues && issues.length);
      if (hadIssues && !hasIssues) rowsWithIssuesCount -= 1;
      if (!hadIssues && hasIssues) rowsWithIssuesCount += 1;
      rowIssuesMap.set(internalId, issues);
    }

    function clearRowIssues(internalId) {
      const previous = rowIssuesMap.get(internalId);
      if (previous && previous.length) rowsWithIssuesCount -= 1;
      rowIssuesMap.delete(internalId);
    }

    function setQuizEntry(quizId, entry) {
      const previous = quizIssuesMap.get(quizId);
      const wasFailing = Boolean(previous && previous.issues.length);
      const isFailing = Boolean(entry && entry.issues.length);
      if (wasFailing && !isFailing) quizzesFailingCount -= 1;
      if (!wasFailing && isFailing) quizzesFailingCount += 1;
      quizIssuesMap.set(quizId, entry);
    }

    function clearQuizEntry(quizId) {
      const previous = quizIssuesMap.get(quizId);
      if (previous && previous.issues.length) quizzesFailingCount -= 1;
      quizIssuesMap.delete(quizId);
    }

    function rowsForQuiz(quizId) {
      const ids = quizIndex.get(quizId);
      if (!ids || !ids.size) return [];
      const out = [];
      ids.forEach(id => {
        const row = rowsById.get(id);
        if (row) out.push(row);
      });
      return out;
    }

    function addToIndex(internalId, quizId) {
      if (!quizId) {
        orphanCount += 1;
        return;
      }
      if (!quizIndex.has(quizId)) quizIndex.set(quizId, new Set());
      quizIndex.get(quizId).add(internalId);
    }

    function removeFromIndex(internalId, quizId) {
      if (!quizId) {
        orphanCount = Math.max(0, orphanCount - 1);
        return;
      }
      const set = quizIndex.get(quizId);
      if (set) {
        set.delete(internalId);
        if (!set.size) quizIndex.delete(quizId);
      }
    }

    function revalidateRow(internalId) {
      const row = rowsById.get(internalId);
      if (!row) return;
      setRowIssues(internalId, getRowIssues(row, cfg));
    }

    function revalidateQuiz(quizId) {
      if (!quizId) return;
      const rows = rowsForQuiz(quizId);
      if (!rows.length) {
        clearQuizEntry(quizId);
        return;
      }
      setQuizEntry(quizId, computeQuizGroupIssues(rows, cfg));
    }

    /*
     * Full dataset rescan. Same end result as the original computeValidation
     * — every row's issues and every quiz group's issues are recomputed —
     * intended for bulk operations (import, pack, bulk delete, undo/redo,
     * initial load) that already touch every row.
     */
    function fullRecompute(rows) {
      rowIssuesMap.clear();
      quizIssuesMap.clear();
      quizIndex.clear();
      rowQuizId.clear();
      rowsById.clear();
      rowsWithIssuesCount = 0;
      quizzesFailingCount = 0;
      orphanCount = 0;

      (Array.isArray(rows) ? rows : []).forEach(row => {
        const internalId = row.__internalId;
        if (internalId === undefined || internalId === null) return;
        const qid = quizIdOf(row);
        rowsById.set(internalId, row);
        rowQuizId.set(internalId, qid);
        addToIndex(internalId, qid);
        setRowIssues(internalId, getRowIssues(row, cfg));
      });

      quizIndex.forEach((ids, quizId) => revalidateQuiz(quizId));
    }

    /* One new row (e.g. Add Row, duplicate, raw-import append of one row). */
    function onRowAdded(row) {
      const internalId = row && row.__internalId;
      if (internalId === undefined || internalId === null) return;
      const qid = quizIdOf(row);
      rowsById.set(internalId, row);
      rowQuizId.set(internalId, qid);
      addToIndex(internalId, qid);
      revalidateRow(internalId);
      revalidateQuiz(qid);
    }

    /* One row removed. Only its (former) quiz group is re-checked. */
    function onRowRemoved(internalId) {
      if (!rowsById.has(internalId)) return;
      const qid = rowQuizId.get(internalId) || "";
      removeFromIndex(internalId, qid);
      rowQuizId.delete(internalId);
      rowsById.delete(internalId);
      clearRowIssues(internalId);
      if (qid) revalidateQuiz(qid);
    }

    /*
     * A single field on an already-indexed row changed (the live-edit hot
     * path). Always re-checks just that row. Re-checks its quiz group too —
     * and, if the edited field was quiz_id itself, re-checks BOTH the old
     * and new quiz groups and moves the row's index entry between them.
     * Never touches any row outside of at most two quiz groups.
     *
     * Returns the quiz_id(s) whose validation entry may have changed, so a
     * caller (e.g. the validation panel renderer) can patch just those
     * instead of redrawing everything.
     */
    function onFieldChanged(internalId) {
      const row = rowsById.get(internalId);
      if (!row) return [];

      const previousQuizId = rowQuizId.get(internalId) || "";
      const currentQuizId = quizIdOf(row);

      revalidateRow(internalId);

      if (currentQuizId === previousQuizId) {
        revalidateQuiz(currentQuizId);
        return currentQuizId ? [currentQuizId] : [];
      }

      removeFromIndex(internalId, previousQuizId);
      addToIndex(internalId, currentQuizId);
      rowQuizId.set(internalId, currentQuizId);

      revalidateQuiz(previousQuizId);
      revalidateQuiz(currentQuizId);

      const touched = [];
      if (previousQuizId) touched.push(previousQuizId);
      if (currentQuizId) touched.push(currentQuizId);
      return touched;
    }

    function isRowValid(internalId) {
      const issues = rowIssuesMap.get(internalId);
      return !issues || issues.length === 0;
    }

    /* O(1) — running totals, never recomputed by rescanning. */
    function getSummary() {
      return {
        totalRows: rowsById.size,
        rowsWithIssues: rowsWithIssuesCount,
        totalQuizzes: quizIndex.size,
        quizzesFailing: quizzesFailingCount,
        orphanRows: orphanCount
      };
    }

    return {
      config: cfg,
      fullRecompute,
      onRowAdded,
      onRowRemoved,
      onFieldChanged,
      isRowValid,
      getSummary,
      getRowIssuesMap: () => rowIssuesMap,
      getQuizIssuesMap: () => quizIssuesMap,
      getQuizIndexSnapshot: () => {
        const snapshot = new Map();
        quizIndex.forEach((set, key) => snapshot.set(key, Array.from(set)));
        return snapshot;
      }
    };
  }

  global.MylingoAuthoringValidation = {
    getRowIssues,
    computeQuizGroupIssues,
    createEngine
  };
})(window);
