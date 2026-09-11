(function (global) {
  'use strict';

  var VERSION = 1;
  var STORAGE_KEY = 'mylingo.skill-mastery.v1';
  var LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  var SKILLS = ['grammar', 'vocabulary', 'reading', 'listening', 'writing', 'usage'];
  var MASTERY_BANDS = [
    { min: 0, key: 'needs_support', label: 'Needs support' },
    { min: 60, key: 'developing', label: 'Developing' },
    { min: 80, key: 'secure', label: 'Secure' },
    { min: 90, key: 'mastered', label: 'Mastered' }
  ];

  function normalizeSkill(skill) {
    skill = String(skill || '').toLowerCase();
    return SKILLS.indexOf(skill) >= 0 ? skill : null;
  }
  function normalizeLevel(level) {
    level = String(level || '').toLowerCase();
    return LEVELS.indexOf(level) >= 0 ? level : null;
  }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function masteryBand(accuracy) {
    var n = clamp(Number(accuracy) || 0, 0, 100);
    var result = MASTERY_BANDS[0];
    for (var i = 0; i < MASTERY_BANDS.length; i++) {
      if (n >= MASTERY_BANDS[i].min) result = MASTERY_BANDS[i];
    }
    return result;
  }
  function confidenceFor(questionCount, attemptCount) {
    var q = Number(questionCount) || 0;
    var a = Number(attemptCount) || 0;
    if (q < 5 || a < 2) return 'low';
    if (q < 10 || a < 5) return 'medium';
    return 'high';
  }

  function emptySkill() {
    return {
      question_count: 0,
      correct_count: 0,
      attempt_count: 0,
      accuracy: null,
      mastery_band: null,
      confidence: 'low',
      level_counts: {},
      last_level: null,
      last_quiz_id: null,
      last_attempt_at: null
    };
  }

  function emptyStore() {
    return { version: VERSION, updated_at: null, skills: {} };
  }

  function sanitizeSkill(raw) {
    var skill = emptySkill();
    if (!raw || typeof raw !== 'object') return skill;
    skill.question_count = Math.max(0, Math.floor(Number(raw.question_count) || 0));
    skill.correct_count = clamp(Math.floor(Number(raw.correct_count) || 0), 0, skill.question_count);
    skill.attempt_count = Math.max(0, Math.floor(Number(raw.attempt_count) || 0));
    if (skill.question_count > 0) {
      skill.accuracy = Math.round(skill.correct_count / skill.question_count * 10000) / 100;
      skill.mastery_band = masteryBand(skill.accuracy).key;
    }
    skill.confidence = confidenceFor(skill.question_count, skill.attempt_count);
    if (raw.level_counts && typeof raw.level_counts === 'object') {
      Object.keys(raw.level_counts).forEach(function (level) {
        var normalized = normalizeLevel(level);
        var count = Math.floor(Number(raw.level_counts[level]) || 0);
        if (normalized && count > 0) skill.level_counts[normalized] = count;
      });
    }
    skill.last_level = normalizeLevel(raw.last_level);
    skill.last_quiz_id = raw.last_quiz_id == null ? null : String(raw.last_quiz_id);
    skill.last_attempt_at = Number.isFinite(Number(raw.last_attempt_at)) ? Number(raw.last_attempt_at) : null;
    return skill;
  }

  function sanitizeStore(raw) {
    if (!raw || typeof raw !== 'object' || Number(raw.version) !== VERSION) return emptyStore();
    var result = emptyStore();
    result.updated_at = Number.isFinite(Number(raw.updated_at)) ? Number(raw.updated_at) : null;
    if (raw.skills && typeof raw.skills === 'object') {
      Object.keys(raw.skills).forEach(function (name) {
        var skill = normalizeSkill(name);
        if (skill) result.skills[skill] = sanitizeSkill(raw.skills[name]);
      });
    }
    return result;
  }

  function readStored() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      return sanitizeStore(JSON.parse(raw));
    } catch (e) {
      return emptyStore();
    }
  }

  function writeStored(store) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeStore(store)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // Records one completed quiz attempt. A skill contributes only from questions
  // explicitly tagged with a supported skill and a boolean correctness result.
  // This keeps the model additive and prevents untagged legacy content from
  // inventing mastery evidence.
  function recordAttempt(input, store) {
    input = input || {};
    var target = sanitizeStore(store || readStored());
    var questions = Array.isArray(input.questions) ? input.questions : [];
    var correctMap = input.correctMap && typeof input.correctMap === 'object' ? input.correctMap : {};
    var quizId = input.quiz_id == null ? null : String(input.quiz_id);
    var level = normalizeLevel(input.level);
    var now = Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Date.now();
    var changed = false;
    var contributed = {};

    questions.forEach(function (question, index) {
      var skill = normalizeSkill(question && question.skill);
      var type = String(question && question.question_type || 'radio').toLowerCase().replace(/[\s-]+/g, '_');
      if (!skill || type === 'banner' || typeof correctMap[index] !== 'boolean') return;
      if (!target.skills[skill]) target.skills[skill] = emptySkill();
      var item = target.skills[skill];
      item.question_count += 1;
      if (correctMap[index]) item.correct_count += 1;
      if (level) item.level_counts[level] = (item.level_counts[level] || 0) + 1;
      item.last_level = level || item.last_level;
      item.last_quiz_id = quizId || item.last_quiz_id;
      item.last_attempt_at = now;
      contributed[skill] = true;
      changed = true;
    });

    Object.keys(contributed).forEach(function (skill) {
      var item = target.skills[skill];
      item.attempt_count += 1;
      item.accuracy = item.question_count ? Math.round(item.correct_count / item.question_count * 10000) / 100 : null;
      item.mastery_band = item.accuracy == null ? null : masteryBand(item.accuracy).key;
      item.confidence = confidenceFor(item.question_count, item.attempt_count);
    });

    if (changed) target.updated_at = now;
    return target;
  }

  function recordAndPersist(input) {
    var store = recordAttempt(input, readStored());
    writeStored(store);
    return store;
  }

  function getSkill(store, skill) {
    var normalized = normalizeSkill(skill);
    if (!normalized) return null;
    return sanitizeSkill((store && store.skills && store.skills[normalized]) || null);
  }

  function validateStore(store) {
    if (!store || typeof store !== 'object' || Number(store.version) !== VERSION) return false;
    var s = sanitizeStore(store);
    if (s.version !== VERSION) return false;
    return SKILLS.every(function (skill) {
      if (!s.skills[skill]) return true;
      var item = s.skills[skill];
      return item.correct_count >= 0 && item.correct_count <= item.question_count &&
        item.attempt_count >= 0 && (item.accuracy == null || (item.accuracy >= 0 && item.accuracy <= 100)) &&
        LEVELS.every(function (level) { return !(level in item.level_counts) || item.level_counts[level] >= 0; });
    });
  }

  global.MylingoSkillMastery = {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    LEVELS: LEVELS.slice(),
    SKILLS: SKILLS.slice(),
    MASTERY_BANDS: MASTERY_BANDS.map(function (x) { return { min: x.min, key: x.key, label: x.label }; }),
    normalizeSkill: normalizeSkill,
    normalizeLevel: normalizeLevel,
    masteryBand: masteryBand,
    confidenceFor: confidenceFor,
    readStored: readStored,
    writeStored: writeStored,
    recordAttempt: recordAttempt,
    recordAndPersist: recordAndPersist,
    getSkill: getSkill,
    validateStore: validateStore,
    clone: clone
  };
})(window);
