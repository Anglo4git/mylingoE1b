/*!
 * Mylingo — Gamification module (Agent 2 relay)
 *
 * Adds streaks + XP on top of the existing progress system without touching
 * the frozen `mylingo.progress.v1` schema. Everything here lives under its
 * own storage key so it is purely additive: if this file fails to load for
 * any reason, quiz-taking and progress-saving are completely unaffected.
 *
 * Exposed as `window.MylingoGamification` in the browser and as a normal
 * CommonJS module under Node (used by the Vitest unit tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MylingoGamification = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'mylingo.gamification.v1';
  var XP_PER_CORRECT = 10;
  var PERFECT_BONUS = 20;
  var REPEAT_XP = 0;
  var IMPROVEMENT_XP_PER_CORRECT = 5;
  var MAX_IMPROVEMENT_BONUS_XP = 20;
  var SESSION_HISTORY_LIMIT = 20;


  // ---- pure functions (unit-tested directly, no DOM/localStorage) ----

  /** XP earned for a single finished quiz. */
  function calculateXp(correct, total) {
    correct = Math.max(0, Number(correct) || 0);
    total = Math.max(0, Number(total) || 0);
    if (total === 0) return 0;
    var xp = correct * XP_PER_CORRECT;
    if (correct === total) xp += PERFECT_BONUS;
    return xp;
  }

  /** Days between two YYYY-MM-DD date strings (b - a), in whole days. */
  function daysBetween(a, b) {
    var msPerDay = 24 * 60 * 60 * 1000;
    var da = new Date(a + 'T00:00:00Z').getTime();
    var db = new Date(b + 'T00:00:00Z').getTime();
    return Math.round((db - da) / msPerDay);
  }

  /**
   * Given the last active date, today's date, and the streak count going
   * into today, returns the updated streak count.
   *  - same day as last activity  -> streak unchanged (already counted)
   *  - exactly one day later      -> streak + 1
   *  - any bigger gap (or none)   -> streak resets to 1
   */
  function updateStreak(lastActiveDate, today, currentStreak) {
    currentStreak = Math.max(0, Number(currentStreak) || 0);
    if (!lastActiveDate) return 1;
    var gap = daysBetween(lastActiveDate, today);
    if (gap === 0) return Math.max(1, currentStreak);
    if (gap === 1) return currentStreak + 1;
    return 1;
  }

  function todayStr(date, timeZone) {
    var d = date || new Date();
    if (timeZone) {
      try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      } catch (e) { /* fall through to learner-local browser time */ }
    }
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // ---- storage-backed API (browser only) ----

  function safeGet() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '{}');
      return (v && typeof v === 'object') ? v : {};
    } catch (e) {
      return {};
    }
  }

  function safeSet(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* private mode / quota exceeded — fail silently, same policy as progress.js */
    }
  }

  function migrateRewardLedger(rewardedSessions) {
    var ledger = {};
    if (!Array.isArray(rewardedSessions)) return ledger;
    rewardedSessions.forEach(function (entry) {
      var parts = String(entry || '').split('|');
      if (parts.length !== 3 || !parts[0]) return;
      var quizId = parts[0];
      var score = Math.max(0, Number(parts[1]) || 0);
      var key = quizId + '|1';
      var current = ledger[key];
      if (!current || score > current.bestScore) {
        ledger[key] = { bestScore: score, fullRewarded: true, improvementBonusXp: 0 };
      }
    });
    return ledger;
  }

  function rewardKey(quizId, quizVersion) {
    return quizId + '|' + quizVersion;
  }

  function getState() {
    var s = safeGet();
    return {
      xpTotal: Number(s.xpTotal) || 0,
      streak: Number(s.streak) || 0,
      longestStreak: Number(s.longestStreak) || 0,
      lastActiveDate: s.lastActiveDate || null,
      rewardedSessions: Array.isArray(s.rewardedSessions) ? s.rewardedSessions.slice(-SESSION_HISTORY_LIMIT) : [],
      rewardLedger: isPlainObject(s.rewardLedger) ? s.rewardLedger : migrateRewardLedger(s.rewardedSessions)
    };
  }

  /**
   * Call once per completed quiz. Returns a summary for the UI to render
   * (e.g. "+40 XP · 5 day streak"), and persists the new totals.
   */
  function recordSession(correct, total, now, meta) {
    meta = (meta && typeof meta === 'object') ? meta : {};
    var state = getState();
    var today = todayStr(now);
    var isPlacement = String(meta.mode || '').toLowerCase() === 'placement';
    var quizId = meta.quizId == null ? '' : String(meta.quizId).trim();
    var quizVersion = meta.quizVersion == null ? '1' : String(meta.quizVersion).trim() || '1';
    var score = Math.max(0, Number(correct) || 0);
    var questionTotal = Math.max(0, Number(total) || 0);
    var ledger = isPlainObject(state.rewardLedger) ? state.rewardLedger : {};
    var rewardId = quizId ? rewardKey(quizId, quizVersion) : '';
    var entry = rewardId ? ledger[rewardId] : null;
    var repeated = false;
    var xpEarned = 0;
    var rewardType = 'none';

    if (!isPlacement && quizId && quizVersion && questionTotal > 0) {
      if (!entry) {
        entry = { bestScore: score, fullRewarded: true, improvementBonusXp: 0 };
        ledger[rewardId] = entry;
        xpEarned = calculateXp(score, questionTotal);
        rewardType = 'completion';
      } else if (score > Number(entry.bestScore || 0)) {
        var gain = score - Number(entry.bestScore || 0);
        var remaining = Math.max(0, MAX_IMPROVEMENT_BONUS_XP - Number(entry.improvementBonusXp || 0));
        var improvement = Math.min(remaining, gain * IMPROVEMENT_XP_PER_CORRECT);
        entry.bestScore = score;
        entry.improvementBonusXp = Number(entry.improvementBonusXp || 0) + improvement;
        xpEarned = improvement;
        rewardType = improvement > 0 ? 'improvement' : 'improvement-capped';
      } else {
        repeated = true;
      }
    } else if (!isPlacement && questionTotal > 0) {
      // A completion without stable quiz identity/version is not rewardable.
      // This prevents callers from bypassing the once-per-version policy.
      repeated = true;
    }

    var wasNewDay = !isPlacement && xpEarned > 0 && state.lastActiveDate !== today;
    var newStreak = isPlacement ? state.streak : (xpEarned > 0 ? updateStreak(state.lastActiveDate, today, state.streak) : state.streak);

    var history = Array.isArray(state.rewardedSessions) ? state.rewardedSessions.slice(-SESSION_HISTORY_LIMIT) : [];
    if (!isPlacement && quizId && xpEarned > 0) history.push(rewardId);
    var next = {
      xpTotal: state.xpTotal + xpEarned,
      streak: newStreak,
      longestStreak: Math.max(state.longestStreak, newStreak),
      lastActiveDate: isPlacement ? state.lastActiveDate : (xpEarned > 0 ? today : state.lastActiveDate),
      rewardedSessions: history.slice(-SESSION_HISTORY_LIMIT),
      rewardLedger: ledger
    };
    safeSet(next);

    return {
      xpEarned: xpEarned,
      xpTotal: next.xpTotal,
      streak: next.streak,
      longestStreak: next.longestStreak,
      isNewStreakDay: wasNewDay,
      isRepeat: repeated,
      rewardType: rewardType,
      isPlacement: isPlacement
    };
  }

  function reset() {
    safeSet({ xpTotal: 0, streak: 0, longestStreak: 0, lastActiveDate: null, rewardedSessions: [], rewardLedger: {} });
  }



  // ---- learner state backup/restore (browser only) ----
  // Storage keys remain frozen; only the portable envelope evolves.
  var PROGRESS_KEY = 'mylingo.progress.v1';
  // The runtime (quiz.html) stores sessions keyed by quizId in a single multi-session
  // envelope, not one session per key. LEGACY_SESSION_KEY is the pre-multi-session
  // format the runtime itself migrates away from on read.
  var SESSION_KEY = 'mylingo.sessions.v2';
  var LEGACY_SESSION_KEY = 'mylingo.session.v1';
  var SESSION_SHARD_PREFIX = 'mylingo.sessions.v3.';
  var SESSION_INDEX_KEY = 'mylingo.sessions.v3.index';
  var SKILL_MASTERY_KEY = 'mylingo.skill-mastery.v1';
  var REVIEW_KEY = 'mylingo.review-scheduling.v1';
  var PLACEMENT_KEY = 'mylingo.assessment.v1';
  var PLACEMENT_PENDING_KEY = 'mylingo.assessment.pending.v1';
  var ORIENTATION_KEY = 'mylingo.orientation.v1';
  var BACKUP_SCHEMA = 'mylingo.backup.v2';
  var BACKUP_VERSION = 2;
  var BACKUP_SECTIONS = [
    'progress', 'session', 'gamification', 'skillMastery', 'reviewScheduling',
    'placement', 'placementPending', 'orientation'
  ];

  function rawStorage(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function readObject(key, fallback) {
    var raw = rawStorage(key);
    if (raw === null) return fallback;
    try {
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function validLevel(value) { return ['a1','a2','b1','b2','c1','c2'].indexOf(String(value || '').toLowerCase()) >= 0; }
  function validSkill(value) { return ['grammar','vocabulary','reading','listening','writing','usage'].indexOf(String(value || '').toLowerCase()) >= 0; }

  function validProgressEntry(entry, id) {
    if (!isPlainObject(entry) || typeof id !== 'string' || !id) return false;
    if (entry.id != null && String(entry.id) !== id) return false;
    if (entry.level != null && !validLevel(entry.level)) return false;
    if (entry.status != null && entry.status !== 'completed' && entry.status !== 'in-progress') return false;
    if (entry.best != null && (!isFiniteNumber(Number(entry.best)) || Number(entry.best) < 0 || Number(entry.best) > 100)) return false;
    if (entry.latest != null && (!isFiniteNumber(Number(entry.latest)) || Number(entry.latest) < 0 || Number(entry.latest) > 100)) return false;
    if (entry.attempts != null && (!Number.isInteger(Number(entry.attempts)) || Number(entry.attempts) < 0)) return false;
    if (entry.current != null && (!Number.isInteger(Number(entry.current)) || Number(entry.current) < 0)) return false;
    if (entry.totalQuestions != null && (!Number.isInteger(Number(entry.totalQuestions)) || Number(entry.totalQuestions) < 0)) return false;
    if (entry.lastAccess != null && !isFiniteNumber(Number(entry.lastAccess))) return false;
    return true;
  }

  function validateProgress(progress) {
    if (!isPlainObject(progress)) return false;
    return Object.keys(progress).every(function (id) { return validProgressEntry(progress[id], id); });
  }

  // Validates a single in-progress quiz session entry (the per-quizId value inside
  // the multi-session store, or the legacy single-session envelope's own shape).
  function validateSessionEntry(session) {
    if (session == null) return true;
    if (!isPlainObject(session) || session.version !== 1 || session.status !== 'in-progress') return false;
    if (typeof session.quizId !== 'string' || typeof session.quizVersion !== 'string') return false;
    if (!Number.isInteger(session.questionIndex) || session.questionIndex < 0) return false;
    if (!Array.isArray(session.answers) || session.questionIndex >= session.answers.length) return false;
    if (!isFiniteNumber(session.score) || session.score < 0) return false;
    if (!isFiniteNumber(session.startedAt) || !isFiniteNumber(session.updatedAt)) return false;
    return session.answers.every(function (answer) {
      if (answer == null) return true;
      if (!isPlainObject(answer)) return false;
      if (typeof answer.response !== 'string' && answer.response != null && typeof answer.response !== 'number') return false;
      if (typeof answer.correct !== 'boolean') return false;
      if (typeof answer.correctText !== 'string') return false;
      return answer.submittedAt == null || isFiniteNumber(answer.submittedAt);
    });
  }

  // Validates the section as backed up/restored: either the current multi-session
  // store ({version:2, sessions:{quizId: entry}}) or the legacy single-session shape
  // (accepted so older exports/imports still round-trip).
  function validateSession(store) {
    if (store == null) return true;
    if (!isPlainObject(store)) return false;
    if (store.version === 1 && typeof store.quizId === 'string') return validateSessionEntry(store);
    if ((store.version !== 2 && store.version !== 3) || !isPlainObject(store.sessions)) return false;
    return Object.keys(store.sessions).every(function (quizId) {
      return !!quizId && validateSessionEntry(store.sessions[quizId]);
    });
  }

  // Normalizes any accepted 'session' section shape into the canonical
  // {version:2, sessions:{...}} form, silently dropping any entry that fails
  // per-session validation (assumed already checked valid overall by validateSession).
  function normalizeSessionStore(raw) {
    var out = { version: 2, sessions: {} };
    if (raw == null || !isPlainObject(raw)) return out;
    if (raw.version === 1 && typeof raw.quizId === 'string') {
      if (validateSessionEntry(raw)) out.sessions[raw.quizId] = raw;
      return out;
    }
    if (isPlainObject(raw.sessions)) {
      Object.keys(raw.sessions).forEach(function (quizId) {
        var entry = raw.sessions[quizId];
        if (quizId && validateSessionEntry(entry)) out.sessions[quizId] = entry;
      });
    }
    return out;
  }

  // Reads the session section for a backup: prefers the live multi-session store,
  // falling back to the legacy single-session key if the runtime hasn't migrated yet.
  function sessionShardKey(quizId) {
    return SESSION_SHARD_PREFIX + encodeURIComponent(String(quizId || ''));
  }

  function readShardedSessionStore() {
    var index = readObject(SESSION_INDEX_KEY, null);
    if (!isPlainObject(index) || Number(index.version) !== 1 || !Array.isArray(index.quizIds)) return null;
    var sessions = {};
    index.quizIds.forEach(function (quizId) {
      if (typeof quizId !== 'string' || !quizId) return;
      var entry = readObject(sessionShardKey(quizId), null);
      if (validateSessionEntry(entry)) sessions[quizId] = entry;
    });
    return { version: 3, sessions: sessions };
  }

  function readSessionSectionForBackup() {
    var sharded = readShardedSessionStore();
    if (sharded) return sharded;
    var current = readObject(SESSION_KEY, null);
    if (isPlainObject(current) && current.version === 2 && isPlainObject(current.sessions)) return current;
    var legacy = readObject(LEGACY_SESSION_KEY, null);
    if (legacy) return normalizeSessionStore(legacy);
    return { version: 2, sessions: {} };
  }

  function validateGamification(state) {
    if (!isPlainObject(state)) return false;
    if (state.xpTotal != null && (!isFiniteNumber(Number(state.xpTotal)) || Number(state.xpTotal) < 0)) return false;
    if (state.streak != null && (!Number.isInteger(Number(state.streak)) || Number(state.streak) < 0)) return false;
    if (state.longestStreak != null && (!Number.isInteger(Number(state.longestStreak)) || Number(state.longestStreak) < 0)) return false;
    if (state.lastActiveDate != null && typeof state.lastActiveDate !== 'string') return false;
    if (state.rewardedSessions != null && !Array.isArray(state.rewardedSessions)) return false;
    return true;
  }

  function validateSkillMastery(store) {
    if (!isPlainObject(store) || Number(store.version) !== 1) return false;
    if (store.updated_at != null && !isFiniteNumber(Number(store.updated_at))) return false;
    if (store.skills != null && !isPlainObject(store.skills)) return false;
    return Object.keys(store.skills || {}).every(function (skill) {
      var item = store.skills[skill];
      if (!validSkill(skill) || !isPlainObject(item)) return false;
      if (!Number.isInteger(Number(item.question_count)) || item.question_count < 0) return false;
      if (!Number.isInteger(Number(item.correct_count)) || item.correct_count < 0 || item.correct_count > item.question_count) return false;
      if (!Number.isInteger(Number(item.attempt_count)) || item.attempt_count < 0) return false;
      if (item.accuracy != null && (!isFiniteNumber(Number(item.accuracy)) || Number(item.accuracy) < 0 || Number(item.accuracy) > 100)) return false;
      if (item.level_counts != null && !isPlainObject(item.level_counts)) return false;
      if (item.last_level != null && !validLevel(item.last_level)) return false;
      if (item.last_quiz_id != null && typeof item.last_quiz_id !== 'string') return false;
      return item.last_attempt_at == null || isFiniteNumber(Number(item.last_attempt_at));
    });
  }

  function validateReviewScheduling(store) {
    if (!isPlainObject(store) || Number(store.version) !== 1) return false;
    if (store.updated_at != null && !isFiniteNumber(Number(store.updated_at))) return false;
    if (store.skills != null && !isPlainObject(store.skills)) return false;
    return Object.keys(store.skills || {}).every(function (skill) {
      var card = store.skills[skill];
      if (!validSkill(skill) || !isPlainObject(card)) return false;
      if (!isFiniteNumber(Number(card.interval_days)) || Number(card.interval_days) < 0 || Number(card.interval_days) > 30) return false;
       if (card.interval_hours != null && (!isFiniteNumber(Number(card.interval_hours)) || Number(card.interval_hours) < 0 || Number(card.interval_hours) > 30 * 24)) return false;
       if (card.interval_hours != null && Math.abs(Number(card.interval_days) * 24 - Number(card.interval_hours)) > 1e-9) return false;
      if (!Number.isInteger(Number(card.consecutive_successes)) || Number(card.consecutive_successes) < 0) return false;
      if (card.last_accuracy != null && (!isFiniteNumber(Number(card.last_accuracy)) || Number(card.last_accuracy) < 0 || Number(card.last_accuracy) > 100)) return false;
      if (card.last_quiz_id != null && typeof card.last_quiz_id !== 'string') return false;
      if (card.last_level != null && !validLevel(card.last_level)) return false;
      if (card.last_review_at != null && !isFiniteNumber(Number(card.last_review_at))) return false;
      return card.due_at == null || isFiniteNumber(Number(card.due_at));
    });
  }

  function validateEvidenceEntry(entry) {
    if (!isPlainObject(entry) || typeof entry.question_id !== 'string' || !entry.question_id) return false;
    if (entry.skill != null && !validSkill(entry.skill)) return false;
    if (typeof entry.correct !== 'boolean') return false;
    if (entry.stage != null && typeof entry.stage !== 'string') return false;
    if (entry.quiz_id != null && typeof entry.quiz_id !== 'string') return false;
    if (entry.quiz_ids != null && (!Array.isArray(entry.quiz_ids) || !entry.quiz_ids.every(function (x) { return typeof x === 'string'; }))) return false;
    if (entry.stages != null && (!Array.isArray(entry.stages) || !entry.stages.every(function (x) { return typeof x === 'string'; }))) return false;
    return true;
  }

  function validatePlacement(result) {
    if (result == null) return true;
    if (!isPlainObject(result)) return false;
    if (!validLevel(result.recommended_level) || !validLevel(result.assessed_level)) return false;
    if (!isFiniteNumber(Number(result.score)) || Number(result.score) < 0 || Number(result.score) > 100) return false;
    if (result.estimated_level != null && !validLevel(result.estimated_level)) return false;
    if (result.evidence != null && (!Array.isArray(result.evidence) || !result.evidence.every(validateEvidenceEntry))) return false;
    if (result.evidence_question_count != null && (!Number.isInteger(Number(result.evidence_question_count)) || Number(result.evidence_question_count) < 0)) return false;
    if (result.evidence_correct_count != null && (!Number.isInteger(Number(result.evidence_correct_count)) || Number(result.evidence_correct_count) < 0)) return false;
    if (result.assessment_quiz_ids != null && (!Array.isArray(result.assessment_quiz_ids) || !result.assessment_quiz_ids.every(function (x) { return typeof x === 'string'; }))) return false;
    return true;
  }

  function validatePlacementPending(pending) {
    if (pending == null) return true;
    if (!isPlainObject(pending) || Number(pending.version) !== 1) return false;
    if (!validLevel(pending.estimated_level) || !validLevel(pending.primary_level) || !validLevel(pending.verification_level)) return false;
    if (!isFiniteNumber(Number(pending.primary_score)) || Number(pending.primary_score) < 0 || Number(pending.primary_score) > 100) return false;
    if (typeof pending.primary_quiz_id !== 'string') return false;
    if (!Array.isArray(pending.primary_evidence) || !pending.primary_evidence.every(validateEvidenceEntry)) return false;
    return pending.timestamp == null || isFiniteNumber(Number(pending.timestamp));
  }

  function validateOrientation(state) {
    if (state == null) return true;
    if (!isPlainObject(state) || Number(state.version) !== 1) return false;
    if (!Array.isArray(state.answers) || state.answers.length > 10) return false;
    if (!state.answers.every(function (x) { return Number.isInteger(Number(x)) && Number(x) >= 0 && Number(x) <= 4; })) return false;
    if (!isFiniteNumber(Number(state.score)) || !isFiniteNumber(Number(state.maxScore))) return false;
    if (state.recommendedLevel != null && !validLevel(state.recommendedLevel)) return false;
    if (state.completedAt != null && typeof state.completedAt !== 'string') return false;
    return true;
  }

  function sectionValidators() {
    return {
      progress: validateProgress,
      session: validateSession,
      gamification: validateGamification,
      skillMastery: validateSkillMastery,
      reviewScheduling: validateReviewScheduling,
      placement: validatePlacement,
      placementPending: validatePlacementPending,
      orientation: validateOrientation
    };
  }

  function buildBackup() {
    return {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      sections: {
        progress: readObject(PROGRESS_KEY, {}),
        session: readSessionSectionForBackup(),
        gamification: readObject(KEY, {}),
        skillMastery: readObject(SKILL_MASTERY_KEY, { version: 1, updated_at: null, skills: {} }),
        reviewScheduling: readObject(REVIEW_KEY, { version: 1, updated_at: null, skills: {} }),
        placement: readObject(PLACEMENT_KEY, null),
        placementPending: readObject(PLACEMENT_PENDING_KEY, null),
        orientation: readObject(ORIENTATION_KEY, null)
      }
    };
  }

  function normalizeBackup(pkg) {
    if (!isPlainObject(pkg)) return { ok: false, reason: 'Malformed backup.' };
    if (pkg.schema === 'mylingo.backup.v1') {
      if (typeof pkg.exportedAt !== 'string' || !pkg.exportedAt) return { ok: false, reason: 'Missing export timestamp.' };
      return {
        ok: true,
        version: 1,
        exportedAt: pkg.exportedAt,
        sections: {
          progress: pkg.progress,
          session: pkg.session,
          gamification: pkg.gamification
        },
        legacy: true
      };
    }
    if (pkg.schema !== BACKUP_SCHEMA || Number(pkg.version) !== BACKUP_VERSION) return { ok: false, reason: 'Unsupported backup version.' };
    if (typeof pkg.exportedAt !== 'string' || !pkg.exportedAt) return { ok: false, reason: 'Missing export timestamp.' };
    if (!isPlainObject(pkg.sections)) return { ok: false, reason: 'Missing backup sections.' };
    return { ok: true, version: BACKUP_VERSION, exportedAt: pkg.exportedAt, sections: pkg.sections, legacy: false };
  }

  function validateBackup(pkg) {
    var normalized = normalizeBackup(pkg);
    if (!normalized.ok) return normalized;
    var validators = sectionValidators();
    var valid = [], invalid = [], present = [];
    BACKUP_SECTIONS.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(normalized.sections, name)) return;
      present.push(name);
      var ok = validators[name](normalized.sections[name]);
      (ok ? valid : invalid).push(name);
    });
    // A legacy backup has only the three fields that existed in v1; new sections are optional.
    if (normalized.legacy && present.length !== 3) return { ok: false, reason: 'Malformed legacy backup.' };
    if (!present.length) return { ok: false, reason: 'Backup contains no recognized learner state.' };
    return { ok: true, legacy: normalized.legacy, valid_sections: valid, invalid_sections: invalid };
  }

  function restoreBackup(pkg) {
    var normalized = normalizeBackup(pkg);
    if (!normalized.ok) return normalized;
    var check = validateBackup(pkg);
    if (!check.ok) return check;
    var validators = sectionValidators();
    var restored = [], rejected = [], failed = [];
    var keyBySection = {
      progress: PROGRESS_KEY,
      session: SESSION_KEY,
      gamification: KEY,
      skillMastery: SKILL_MASTERY_KEY,
      reviewScheduling: REVIEW_KEY,
      placement: PLACEMENT_KEY,
      placementPending: PLACEMENT_PENDING_KEY,
      orientation: ORIENTATION_KEY
    };
    var sections = normalized.sections;

    BACKUP_SECTIONS.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(sections, name)) return;
      var value = sections[name];
      if (!validators[name](value)) { rejected.push(name); return; }
      try {
        if (name === 'session') {
          // Merge by quizId into the live multi-session store rather than overwriting
          // it wholesale: a backup only describes the sessions it captured, and other
          // in-progress sessions for quizzes outside the backup must survive restore.
          if (value != null) {
            var incoming = normalizeSessionStore(value);
            var sharded = readShardedSessionStore();
            var existing = sharded || normalizeSessionStore(readObject(SESSION_KEY, null));
            var ids = Object.keys(existing.sessions || {});
            Object.keys(incoming.sessions).forEach(function (quizId) {
              localStorage.setItem(sessionShardKey(quizId), JSON.stringify(incoming.sessions[quizId]));
              if (ids.indexOf(quizId) < 0) ids.push(quizId);
            });
            Object.keys(existing.sessions || {}).forEach(function (quizId) {
              if (ids.indexOf(quizId) < 0) ids.push(quizId);
              if (incoming.sessions[quizId] == null) localStorage.setItem(sessionShardKey(quizId), JSON.stringify(existing.sessions[quizId]));
            });
            localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify({ version: 1, quizIds: ids }));
            localStorage.removeItem(SESSION_KEY);
          }
          restored.push(name);
          return;
        }
        if ((name === 'placement' || name === 'placementPending' || name === 'orientation') && value == null) localStorage.removeItem(keyBySection[name]);
        else localStorage.setItem(keyBySection[name], JSON.stringify(value));
        restored.push(name);
      } catch (e) {
        failed.push(name);
      }
    });

    if (!restored.length && (rejected.length || failed.length)) {
      return {
        ok: false,
        reason: 'No valid learner state could be restored.',
        restored_sections: [],
        rejected_sections: rejected.concat(failed)
      };
    }
    return {
      ok: true,
      legacy: normalized.legacy,
      restored_sections: restored,
      rejected_sections: rejected,
      failed_sections: failed,
      partial: rejected.length > 0 || failed.length > 0
    };
  }

  function exportProgress() {
    var pkg = buildBackup();
    var json = JSON.stringify(pkg, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'mylingo-learner-backup-v2.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    return pkg;
  }

  function installBackupUi() {
    if (typeof document === 'undefined' || !document.getElementById('resetWrap')) return;
    if (document.getElementById('progressBackupWrap')) return;
    var wrap = document.getElementById('resetWrap');
    var box = document.createElement('div');
    box.id = 'progressBackupWrap';
    box.style.cssText = 'margin-top:14px;padding-top:14px;border-top:1px solid #e5e7eb;text-align:left';
    box.innerHTML = '<div style="font-size:12px;font-weight:800;color:#6b7280;margin-bottom:8px">Backup & restore</div>' +
      '<button id="exportProgressBtn" type="button" style="margin-right:8px;border:1px solid #e5e7eb;background:#fff;color:#17212b;padding:9px 14px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;min-height:40px">Export learner backup</button>' +
      '<button id="importProgressBtn" type="button" style="border:1px solid #e5e7eb;background:#fff;color:#17212b;padding:9px 14px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;min-height:40px">Import learner backup</button>' +
      '<input id="progressBackupInput" type="file" accept="application/json,.json" hidden>' +
      '<div id="progressBackupStatus" aria-live="polite" style="margin-top:8px;font-size:12px;color:#6b7280"></div>';
    wrap.appendChild(box);

    document.getElementById('exportProgressBtn').addEventListener('click', function () {
      try {
        exportProgress();
        document.getElementById('progressBackupStatus').textContent = 'Learner backup exported.';
      } catch (e) {
        document.getElementById('progressBackupStatus').textContent = 'Could not export learner backup.';
      }
    });
    document.getElementById('importProgressBtn').addEventListener('click', function () {
      document.getElementById('progressBackupInput').click();
    });
    document.getElementById('progressBackupInput').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var status = document.getElementById('progressBackupStatus');
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var pkg = JSON.parse(String(reader.result || ''));
          var result = restoreBackup(pkg);
          if (!result.ok) {
            status.textContent = result.reason;
            return;
          }
          status.textContent = result.partial
            ? 'Backup restored with some malformed sections skipped. Reloading…'
            : 'Learner backup restored. Reloading…';
          setTimeout(function () { location.reload(); }, 120);
        } catch (e) {
          status.textContent = 'Invalid backup file. Nothing was changed.';
        } finally {
          event.target.value = '';
        }
      };
      reader.onerror = function () {
        status.textContent = 'Could not read that backup file. Nothing was changed.';
        event.target.value = '';
      };
      reader.readAsText(file);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installBackupUi);
    else installBackupUi();
  }

  return {
    KEY: KEY,
    PROGRESS_KEY: PROGRESS_KEY,
    SESSION_KEY: SESSION_KEY,
    LEGACY_SESSION_KEY: LEGACY_SESSION_KEY,
    SKILL_MASTERY_KEY: SKILL_MASTERY_KEY,
    REVIEW_KEY: REVIEW_KEY,
    PLACEMENT_KEY: PLACEMENT_KEY,
    PLACEMENT_PENDING_KEY: PLACEMENT_PENDING_KEY,
    ORIENTATION_KEY: ORIENTATION_KEY,
    BACKUP_SCHEMA: BACKUP_SCHEMA,
    BACKUP_VERSION: BACKUP_VERSION,
    BACKUP_SECTIONS: BACKUP_SECTIONS.slice(),
    buildBackup: buildBackup,
    validateBackup: validateBackup,
    restoreBackup: restoreBackup,
    exportProgress: exportProgress,
    XP_PER_CORRECT: XP_PER_CORRECT,
    PERFECT_BONUS: PERFECT_BONUS,
    // pure (unit-testable without a DOM)
    calculateXp: calculateXp,
    REPEAT_XP: REPEAT_XP,
    IMPROVEMENT_XP_PER_CORRECT: IMPROVEMENT_XP_PER_CORRECT,
    MAX_IMPROVEMENT_BONUS_XP: MAX_IMPROVEMENT_BONUS_XP,
    updateStreak: updateStreak,
    daysBetween: daysBetween,
    todayStr: todayStr,
    // stateful (browser)
    getState: getState,
    recordSession: recordSession,
    reset: reset
  };
});
