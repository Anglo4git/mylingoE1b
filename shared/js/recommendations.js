(function (global) {
  'use strict';

  var LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  var SKILLS = ['grammar', 'vocabulary', 'reading', 'listening', 'writing', 'usage'];
  var CATEGORY_BY_SKILL = {
    grammar: 'Grammar',
    vocabulary: 'Vocabulary',
    reading: 'Reading',
    listening: 'Listening',
    writing: 'Writing',
    usage: 'Grammar'
  };
  var SCORE_BANDS = [
    { min: 0, key: 'needs_support', label: 'Needs support' },
    { min: 60, key: 'developing', label: 'Developing' },
    { min: 80, key: 'secure', label: 'Secure' },
    { min: 90, key: 'strong', label: 'Strong' }
  ];

  // Skill recommendations are deliberately separate from overall placement:
  // the learner can be placed at B1 while, for example, grammar practice is
  // targeted at A2 and vocabulary is stretched toward B2.
  var RULES = {
    min_reported_questions: 2,
    max_recommendations: 3,
    support_below: 60,
    stretch_at_or_above: 90,
    developing_from: 60,
    secure_from: 80
  };

  function normalizeLevel(level) {
    level = String(level || '').toLowerCase();
    return LEVELS.indexOf(level) >= 0 ? level : 'a1';
  }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function levelAt(level, offset) {
    var idx = LEVELS.indexOf(normalizeLevel(level));
    return LEVELS[clamp(idx + Number(offset || 0), 0, LEVELS.length - 1)];
  }
  function scoreBand(score) {
    var n = clamp(Number(score) || 0, 0, 100);
    var result = SCORE_BANDS[0];
    for (var i = 0; i < SCORE_BANDS.length; i++) {
      if (n >= SCORE_BANDS[i].min) result = SCORE_BANDS[i];
    }
    return result;
  }

  function recommendationForSkill(skill, score, baseLevel, availableLevels) {
    skill = String(skill || '').toLowerCase();
    if (SKILLS.indexOf(skill) < 0 || score == null || !Number.isFinite(Number(score))) return null;
    var n = clamp(Number(score), 0, 100);
    var level = normalizeLevel(baseLevel);
    var reason = 'practice';
    var label = 'Practice at your level';

    if (n < RULES.support_below) {
      level = levelAt(level, -1);
      reason = 'support';
      label = 'Build foundations';
    } else if (n >= RULES.stretch_at_or_above) {
      level = levelAt(level, 1);
      reason = 'stretch';
      label = 'Stretch your skills';
    } else if (n >= RULES.secure_from) {
      reason = 'reinforce';
      label = 'Reinforce your skills';
    } else if (n >= RULES.developing_from) {
      reason = 'practice';
      label = 'Targeted practice';
    }

    // Do not recommend a level that isn't represented by the supplied catalog.
    // `availableLevels` can be omitted when the caller only needs the target.
    if (availableLevels && Array.isArray(availableLevels) && availableLevels.length) {
      var normalized = availableLevels.map(normalizeLevel);
      if (normalized.indexOf(level) < 0) {
        var candidates = [level, levelAt(level, -1), levelAt(level, 1)];
        for (var i = 0; i < candidates.length; i++) {
          if (normalized.indexOf(candidates[i]) >= 0) { level = candidates[i]; break; }
        }
        if (normalized.indexOf(level) < 0) return null;
      }
    }

    return {
      skill: skill,
      category: CATEGORY_BY_SKILL[skill],
      score: Math.round(n * 100) / 100,
      score_band: scoreBand(n).key,
      level: level,
      reason: reason,
      label: label
    };
  }

  function rank(a, b) {
    if (a.score !== b.score) return a.score - b.score;
    return SKILLS.indexOf(a.skill) - SKILLS.indexOf(b.skill);
  }

  function recommendSkillLevels(profile, options) {
    options = options || {};
    profile = profile || {};
    var skills = profile.skills && typeof profile.skills === 'object' ? profile.skills : {};
    var counts = profile.skill_counts && typeof profile.skill_counts === 'object' ? profile.skill_counts : {};
    var baseLevel = normalizeLevel(options.base_level || profile.recommended_level || profile.assessed_level);
    var availableLevels = options.available_levels;
    var items = [];

    SKILLS.forEach(function (skill) {
      var score = skills[skill];
      var count = Number(counts[skill]) || 0;
      if (score == null || count < RULES.min_reported_questions) return;
      var item = recommendationForSkill(skill, score, baseLevel, availableLevels);
      if (item) {
        item.question_count = count;
        items.push(item);
      }
    });

    items.sort(rank);
    var limit = Number(options.max_recommendations) || RULES.max_recommendations;
    return items.slice(0, Math.max(0, limit));
  }

  function groupManifestByLevel(manifestByLevel) {
    var result = {};
    Object.keys(manifestByLevel || {}).forEach(function (key) {
      var level = normalizeLevel(key);
      var list = manifestByLevel[key];
      result[level] = Array.isArray(list) ? list.slice() : [];
    });
    return result;
  }

  function resolveQuizPicks(recommendations, manifestByLevel) {
    var manifests = groupManifestByLevel(manifestByLevel);
    return (recommendations || []).map(function (recommendation) {
      var list = manifests[recommendation.level] || [];
      var category = String(recommendation.category || '').toLowerCase();
      var item = list.find(function (quiz) {
        return String(quiz && quiz.category || '').toLowerCase() === category;
      });
      if (!item) return null;
      return {
        skill: recommendation.skill,
        score: recommendation.score,
        score_band: recommendation.score_band,
        level: recommendation.level,
        reason: recommendation.reason,
        label: recommendation.label,
        quiz: item
      };
    }).filter(Boolean);
  }

  function validateProfile(profile) {
    var recommendations = recommendSkillLevels(profile, { max_recommendations: RULES.max_recommendations });
    return recommendations.every(function (item) {
      return SKILLS.indexOf(item.skill) >= 0 &&
        LEVELS.indexOf(item.level) >= 0 &&
        Number.isFinite(item.score) && item.question_count >= RULES.min_reported_questions;
    });
  }

  global.MylingoRecommendations = {
    LEVELS: LEVELS.slice(),
    SKILLS: SKILLS.slice(),
    CATEGORY_BY_SKILL: Object.assign({}, CATEGORY_BY_SKILL),
    RULES: Object.assign({}, RULES),
    normalizeLevel: normalizeLevel,
    levelAt: levelAt,
    scoreBand: scoreBand,
    recommendationForSkill: recommendationForSkill,
    recommendSkillLevels: recommendSkillLevels,
    resolveQuizPicks: resolveQuizPicks,
    validateProfile: validateProfile
  };
})(window);
