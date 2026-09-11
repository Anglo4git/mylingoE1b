/* Mylingo Agent 64 — canonical skill/objective metadata normalization. */
(function (global) {
  'use strict';

  var SKILLS = ['grammar', 'vocabulary', 'reading', 'listening', 'writing', 'usage'];
  var CATEGORY_TO_SKILL = {
    grammar: 'grammar', vocabulary: 'vocabulary', reading: 'reading',
    listening: 'listening', writing: 'writing', usage: 'usage',
    'academic english': 'usage'
  };

  function normalizeSkill(value) {
    var key = String(value || '').trim().toLowerCase();
    return SKILLS.indexOf(key) >= 0 ? key : null;
  }

  function skillForCategory(value) {
    var key = String(value || '').trim().toLowerCase();
    return CATEGORY_TO_SKILL[key] || null;
  }

  function normalizeObjective(input) {
    if (!input || typeof input !== 'object') return null;
    var value = input.objective;
    if (value == null || String(value).trim() === '') value = input.learning_objective;
    value = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return value || null;
  }

  function normalize(input, fallbackCategory) {
    input = input && typeof input === 'object' ? input : {};
    var skill = normalizeSkill(input.skill) || skillForCategory(input.category || fallbackCategory);
    var objective = normalizeObjective(input);
    var out = {};
    if (skill) out.skill = skill;
    if (input.subskill != null && String(input.subskill).trim()) out.subskill = String(input.subskill).trim();
    if (objective) out.objective = objective;
    if (input.difficulty != null && Number.isFinite(Number(input.difficulty))) out.difficulty = Number(input.difficulty);
    if (input.cefr != null && String(input.cefr).trim()) out.cefr = String(input.cefr).trim().toUpperCase();
    if (input.estimated_time_seconds != null && Number.isFinite(Number(input.estimated_time_seconds))) out.estimated_time_seconds = Number(input.estimated_time_seconds);
    return out;
  }

  global.MylingoCanonicalMetadata = {
    VERSION: 1,
    SKILLS: SKILLS.slice(),
    CATEGORY_TO_SKILL: Object.assign({}, CATEGORY_TO_SKILL),
    normalizeSkill: normalizeSkill,
    skillForCategory: skillForCategory,
    normalizeObjective: normalizeObjective,
    normalize: normalize
  };
})(window);
