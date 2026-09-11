(function (global) {
  'use strict';

  var VERSION = 1;
  var STORAGE_KEY = 'mylingo.review-scheduling.v1';
  var DAY_MS = 86400000;
  var SKILLS = ['grammar', 'vocabulary', 'reading', 'listening', 'writing', 'usage'];
  var MAX_INTERVAL_DAYS = 30;
  var INTERVAL_BY_ACCURACY = [
    { max: 39, hours: 6 },
    { max: 59, hours: 24 },
    { max: 79, hours: 72 },
    { max: 89, hours: 168 },
    { max: 100, hours: 336 }
  ];

  function normalizeSkill(skill) {
    skill = String(skill || '').toLowerCase();
    return SKILLS.indexOf(skill) >= 0 ? skill : null;
  }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function accuracyBandHours(n) {
    n = clamp(Number(n) || 0, 0, 100);
    for (var i = 0; i < INTERVAL_BY_ACCURACY.length; i++) {
      if (n <= INTERVAL_BY_ACCURACY[i].max) return INTERVAL_BY_ACCURACY[i].hours;
    }
    return 336;
  }
  function accuracyBand(n) { return accuracyBandHours(n) / 24; }
  function emptyCard() {
    return {
      interval_hours: 0,
      interval_days: 0,
      consecutive_successes: 0,
      last_accuracy: null,
      last_review_at: null,
      due_at: null,
      last_quiz_id: null,
      last_level: null
    };
  }
  function emptyStore() { return { version: VERSION, updated_at: null, skills: {} }; }

  function sanitizeCard(raw) {
    var card = emptyCard();
    if (!raw || typeof raw !== 'object') return card;
    var legacyDays = clamp(Number(raw.interval_days) || 0, 0, MAX_INTERVAL_DAYS);
    card.interval_hours = clamp(Math.floor(Number(raw.interval_hours) || legacyDays * 24), 0, MAX_INTERVAL_DAYS * 24);
    card.interval_days = card.interval_hours / 24;
    card.consecutive_successes = Math.max(0, Math.floor(Number(raw.consecutive_successes) || 0));
    card.last_accuracy = raw.last_accuracy == null ? null : clamp(Math.round(Number(raw.last_accuracy) * 100) / 100, 0, 100);
    card.last_review_at = Number.isFinite(Number(raw.last_review_at)) ? Number(raw.last_review_at) : null;
    card.due_at = Number.isFinite(Number(raw.due_at)) ? Number(raw.due_at) : null;
    card.last_quiz_id = raw.last_quiz_id == null ? null : String(raw.last_quiz_id);
    card.last_level = raw.last_level == null ? null : String(raw.last_level).toLowerCase();
    return card;
  }
  function sanitizeStore(raw) {
    if (!raw || typeof raw !== 'object' || Number(raw.version) !== VERSION) return emptyStore();
    var result = emptyStore();
    result.updated_at = Number.isFinite(Number(raw.updated_at)) ? Number(raw.updated_at) : null;
    if (raw.skills && typeof raw.skills === 'object') {
      Object.keys(raw.skills).forEach(function (skill) {
        var normalized = normalizeSkill(skill);
        if (normalized) result.skills[normalized] = sanitizeCard(raw.skills[skill]);
      });
    }
    return result;
  }
  function readStored() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      return raw ? sanitizeStore(JSON.parse(raw)) : emptyStore();
    } catch (e) { return emptyStore(); }
  }
  function writeStored(store) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeStore(store)));
      return true;
    } catch (e) { return false; }
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function calculateNextIntervalHours(previous, accuracy) {
    var base = accuracyBandHours(accuracy);
    var prior = Number(previous && previous.interval_hours);
    if (!Number.isFinite(prior) || prior <= 0) prior = (Number(previous && previous.interval_days) || 0) * 24;
    var success = Number(previous && previous.consecutive_successes) || 0;
    var strong = Number(accuracy) >= 80;
    if (strong && prior > 0 && success > 0) base = Math.min(MAX_INTERVAL_DAYS * 24, Math.max(base, prior * 2));
    // The 6-hour band is same-day reinforcement for a skill with no track record
    // yet. A skill that already had a review history (an interval and/or a
    // success streak) and then fails badly should reset to a one-day review,
    // not be pushed into the same tight same-day loop as a brand-new weak skill.
    var hadHistory = prior > 0 || success > 0;
    if (Number(accuracy) < 40) return hadHistory ? 24 : 6;
    if (Number(accuracy) < 60) return 24;
    return clamp(base, 6, MAX_INTERVAL_DAYS * 24);
  }

  function calculateNextInterval(previous, accuracy) {
    var base = accuracyBand(accuracy);
    var prior = previous && Number(previous.interval_days) || 0;
    var success = Number(previous && previous.consecutive_successes) || 0;
    var strong = Number(accuracy) >= 80;
    if (strong && prior > 0 && success > 0) base = Math.min(MAX_INTERVAL_DAYS, Math.max(base, prior * 2));
    if (Number(accuracy) < 60) return 1;
    return clamp(base, 1, MAX_INTERVAL_DAYS);
  }

  function isDue(card, now) {
    if (!card || card.due_at == null) return false;
    return Number(card.due_at) <= (Number.isFinite(Number(now)) ? Number(now) : Date.now());
  }

  function recordAttempt(input, store) {
    input = input || {};
    var target = sanitizeStore(store || readStored());
    var questions = Array.isArray(input.questions) ? input.questions : [];
    var correctMap = input.correctMap && typeof input.correctMap === 'object' ? input.correctMap : {};
    var now = Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Date.now();
    var quizId = input.quiz_id == null ? null : String(input.quiz_id);
    var level = input.level == null ? null : String(input.level).toLowerCase();
    var perSkill = {};

    questions.forEach(function (question, index) {
      var skill = normalizeSkill(question && question.skill);
      var type = String(question && question.question_type || 'radio').toLowerCase().replace(/[\s-]+/g, '_');
      if (!skill || type === 'banner' || typeof correctMap[index] !== 'boolean') return;
      if (!perSkill[skill]) perSkill[skill] = { total: 0, correct: 0 };
      perSkill[skill].total += 1;
      if (correctMap[index]) perSkill[skill].correct += 1;
    });

    var changed = false;
    Object.keys(perSkill).forEach(function (skill) {
      var stats = perSkill[skill];
      if (!stats.total) return;
      var accuracy = Math.round(stats.correct / stats.total * 10000) / 100;
      var prior = target.skills[skill] || emptyCard();
      var intervalHours = calculateNextIntervalHours(prior, accuracy);
      var successful = accuracy >= 80;
      var card = emptyCard();
      card.interval_hours = intervalHours;
      card.interval_days = intervalHours / 24;
      card.consecutive_successes = successful ? prior.consecutive_successes + 1 : 0;
      card.last_accuracy = accuracy;
      card.last_review_at = now;
      card.due_at = now + intervalHours * 3600000;
      card.last_quiz_id = quizId || prior.last_quiz_id;
      card.last_level = level || prior.last_level;
      target.skills[skill] = card;
      changed = true;
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
    return sanitizeCard((store && store.skills && store.skills[normalized]) || null);
  }
  function getDueSkills(store, now) {
    var target = sanitizeStore(store || readStored());
    var when = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    return Object.keys(target.skills).filter(function (skill) {
      return isDue(target.skills[skill], when);
    }).sort(function (a, b) {
      return target.skills[a].due_at - target.skills[b].due_at;
    }).map(function (skill) {
      return { skill: skill, card: sanitizeCard(target.skills[skill]) };
    });
  }
  function getNextReview(store) {
    var target = sanitizeStore(store || readStored());
    var best = null;
    Object.keys(target.skills).forEach(function (skill) {
      var card = target.skills[skill];
      if (card.due_at == null) return;
      if (!best || card.due_at < best.due_at) best = { skill: skill, due_at: card.due_at, card: sanitizeCard(card) };
    });
    return best;
  }
  function validateStore(store) {
    if (!store || typeof store !== 'object' || Number(store.version) !== VERSION) return false;
    var s = sanitizeStore(store);
    return Object.keys(s.skills).every(function (skill) {
      var card = s.skills[skill];
      return card.interval_hours >= 0 && card.interval_hours <= MAX_INTERVAL_DAYS * 24 &&
        card.consecutive_successes >= 0 && (card.last_accuracy == null || (card.last_accuracy >= 0 && card.last_accuracy <= 100));
    });
  }

  global.MylingoReviewScheduler = {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    SKILLS: SKILLS.slice(),
    MAX_INTERVAL_DAYS: MAX_INTERVAL_DAYS,
    DAY_MS: DAY_MS,
    accuracyBand: accuracyBand,
    accuracyBandHours: accuracyBandHours,
    calculateNextInterval: calculateNextInterval,
    calculateNextIntervalHours: calculateNextIntervalHours,
    isDue: isDue,
    readStored: readStored,
    writeStored: writeStored,
    recordAttempt: recordAttempt,
    recordAndPersist: recordAndPersist,
    getSkill: getSkill,
    getDueSkills: getDueSkills,
    getNextReview: getNextReview,
    validateStore: validateStore,
    clone: clone
  };
})(window);
