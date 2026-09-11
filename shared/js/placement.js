(function (global) {
  'use strict';

  var LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  var SKILLS = ['grammar', 'vocabulary', 'reading', 'listening', 'writing', 'usage'];
  var DIFFICULTY = { min: 1, max: 5 };
  var SCORE_BANDS = [
    { min: 90, max: 100, key: 'strong', label: 'Strong' },
    { min: 80, max: 89.999, key: 'secure', label: 'Secure' },
    { min: 60, max: 79.999, key: 'developing', label: 'Developing' },
    { min: 40, max: 59.999, key: 'weak', label: 'Weak' },
    { min: 0, max: 39.999, key: 'very_weak', label: 'Very weak' }
  ];
  var STORAGE_KEY = 'mylingo.assessment.v1';

  // Placement Blueprint v2 is an explicit, versioned decision contract layered
  // on top of the original deterministic helpers below. It keeps the current
  // compact 10-question banks compatible while making the state machine and
  // evidence limits testable before richer banks are introduced.
  var PLACEMENT_BLUEPRINT_V2 = {
    version: 2,
    levels: LEVELS.slice(),
    orientation: {
      question_count: 10,
      output: 'estimated_level',
      confidence_field: 'estimate_confidence',
      not_final_placement: true
    },
    primary_assessment: {
      target_questions: 10,
      min_graded_questions: 5,
      score_method: 'graded_item_percentage',
      upper_boundary: 85,
      lower_boundary_exclusive: 50
    },
    verification: {
      max_adjacent_hops: 1,
      one_pass_only: true,
      unresolved_upper_recommendation: 'verification_level',
      unresolved_lower_recommendation: 'verification_level'
    },
    confidence: {
      high_min_graded: 8,
      medium_min_graded: 5,
      near_boundary_margin: 5,
      boundary_is_medium: true,
      incomplete_or_conflicting_is_low: true
    },
    skill_reporting: {
      min_questions_per_skill: 2,
      sparse_skill_value: null
    },
    coverage: {
      claim_basis: 'explicit_skill_coverage',
      minimums: { grammar: 4, vocabulary: 1, reading: 1, listening: 0, writing: 0, usage: 0 },
      required_compound_skills: [{ key: 'writing_or_usage', minimum: 1, skills: ['writing', 'usage'] }],
      unavailable_skills: { listening: 'No language-audio placement items are shipped in the current runtime banks.' }
    },
    persistence: {
      result_key: STORAGE_KEY,
      pending_key: 'mylingo.assessment.pending.v1'
    }
  };

  function normalizeLevel(level) {
    level = String(level || '').toLowerCase();
    return LEVELS.indexOf(level) >= 0 ? level : 'a1';
  }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function adjacentLevel(level, direction) {
    var idx = LEVELS.indexOf(normalizeLevel(level));
    return LEVELS[clamp(idx + direction, 0, LEVELS.length - 1)];
  }
  function scoreBand(score) {
    var n = clamp(Number(score) || 0, 0, 100);
    for (var i = 0; i < SCORE_BANDS.length; i++) {
      if (n >= SCORE_BANDS[i].min && n <= SCORE_BANDS[i].max) return SCORE_BANDS[i];
    }
    return SCORE_BANDS[SCORE_BANDS.length - 1];
  }

  // Decision path is intentionally deterministic: orientation is an estimate,
  // never a measured CEFR result. Medium/low estimate confidence adds one
  // adjacent verification level, but a single verification step never jumps
  // more than one CEFR level.
  function decideAssessmentPath(input) {
    var estimated = normalizeLevel(input && input.estimated_level);
    var confidence = String((input && input.confidence) || (input && input.estimate_confidence) || 'medium').toLowerCase();
    var secondary = confidence === 'high' ? null : adjacentLevel(estimated, 1);
    if (confidence !== 'high' && secondary === estimated) secondary = adjacentLevel(estimated, -1);
    return {
      primary_level: estimated,
      secondary_level: secondary,
      reason: confidence === 'high' ? 'direct_measurement' : 'boundary_check'
    };
  }

  // Boundary policy is product logic, not official CEFR certification.
  // 85+ is an upper-boundary signal, below 50 is a lower-boundary signal.
  // Scores from 50–84 stay at the assessed level unless evidence quality is low.
  function decideVerificationPath(input) {
    var assessed = normalizeLevel(input && input.assessed_level);
    var score = clamp(Number(input && input.score) || 0, 0, 100);
    if (score >= 85 && assessed !== 'c2') return { level: adjacentLevel(assessed, 1), direction: 'upper', reason: 'upper_boundary' };
    if (score < 50 && assessed !== 'a1') return { level: adjacentLevel(assessed, -1), direction: 'lower', reason: 'lower_boundary' };
    return { level: assessed, direction: 'none', reason: 'no_boundary_check' };
  }

  function finalizeVerification(input) {
    var verification = decideFromPerformance({ assessed_level: input && input.verification_level, score: input && input.verification_score, graded_questions: input && input.graded_questions, complete: input && input.complete });
    return {
      recommended_level: verification.recommended_level,
      reason: verification.reason === 'score_in_band' ? 'verified_boundary' : verification.reason,
      confidence: confidenceFor({ graded_questions: input && input.graded_questions, score: input && input.verification_score, complete: input && input.complete }),
      primary_level: normalizeLevel(input && input.primary_level),
      primary_score: clamp(Number(input && input.primary_score) || 0, 0, 100),
      verification_level: normalizeLevel(input && input.verification_level),
      verification_score: clamp(Number(input && input.verification_score) || 0, 0, 100)
    };
  }

  function decideFromPerformance(input) {
    var assessed = normalizeLevel(input && input.assessed_level);
    var score = clamp(Number(input && input.score) || 0, 0, 100);
    var evidence = Number(input && input.graded_questions) || 0;
    var complete = input && input.complete !== false;
    var margin = score >= 85 || score < 50 ? 'boundary' : 'clear';
    var recommended = assessed;
    var reason = 'score_in_band';
    if (!complete || evidence < 5) {
      return { recommended_level: assessed, reason: 'insufficient_evidence', boundary_check: false };
    }
    if (score >= 85 && assessed !== 'c2') {
      recommended = adjacentLevel(assessed, 1);
      reason = 'upper_boundary';
    } else if (score < 50 && assessed !== 'a1') {
      recommended = adjacentLevel(assessed, -1);
      reason = 'lower_boundary';
    }
    return { recommended_level: recommended, reason: reason, boundary_check: margin === 'boundary' };
  }

  // Confidence is driven off the versioned blueprint thresholds so the
  // "near-boundary buffer" isn't a hidden magic number: any score within
  // `near_boundary_margin` points of either boundary is treated as
  // boundary-adjacent for confidence purposes, even if it doesn't cross the
  // boundary itself (e.g. 82 doesn't trigger upper-boundary verification,
  // but it's close enough to the 85 line that confidence is capped at
  // medium). This is a confidence-only caution zone; it never changes the
  // recommended level, only how much the caller should trust the score.
  function confidenceFor(input) {
    var c = PLACEMENT_BLUEPRINT_V2.confidence;
    var pa = PLACEMENT_BLUEPRINT_V2.primary_assessment;
    var evidence = Number(input && input.graded_questions) || 0;
    var score = clamp(Number(input && input.score) || 0, 0, 100);
    var complete = input && input.complete !== false;
    var conflicting = !!(input && input.conflicting_signals);
    if (!complete || evidence < c.medium_min_graded || conflicting) return 'low';
    var nearUpperBoundary = score >= (pa.upper_boundary - c.near_boundary_margin);
    var nearLowerBoundary = score < (pa.lower_boundary_exclusive + c.near_boundary_margin);
    if (evidence < c.high_min_graded || nearUpperBoundary || nearLowerBoundary) return 'medium';
    return 'high';
  }

  function buildEvidence(questions, correctMap, quizId, stage) {
    var sourceQuizId = String(quizId || '').trim();
    var sourceStage = String(stage || 'primary').toLowerCase();
    var map = correctMap && typeof correctMap === 'object' ? correctMap : {};
    return (Array.isArray(questions) ? questions : []).reduce(function (out, q, index) {
      var type = String(q && q.question_type || 'radio').toLowerCase().replace(/[\s-]+/g, '_');
      if (type === 'banner' || typeof map[index] !== 'boolean') return out;
      var questionId = String(q && q.id || (sourceQuizId + ':' + index)).trim();
      if (!questionId) return out;
      out.push({
        question_id: questionId,
        quiz_id: sourceQuizId || null,
        skill: SKILLS.indexOf(String(q && q.skill || '').toLowerCase()) >= 0 ? String(q.skill).toLowerCase() : null,
        correct: !!map[index],
        stage: sourceStage
      });
      return out;
    }, []);
  }

  function mergePlacementEvidence(primary, verification) {
    var merged = [];
    var byId = {};
    function add(entry) {
      if (!entry || typeof entry !== 'object') return;
      var id = String(entry.question_id || '').trim();
      if (!id) return;
      var incomingStages = Array.isArray(entry.stages) && entry.stages.length ? entry.stages.map(function (stage) { return String(stage).toLowerCase(); }) : [String(entry.stage || 'primary').toLowerCase()];
      var incomingQuizIds = Array.isArray(entry.quiz_ids) && entry.quiz_ids.length ? entry.quiz_ids.map(String) : (entry.quiz_id ? [String(entry.quiz_id)] : []);
      if (!byId[id]) {
        var copy = {
          question_id: id,
          quiz_id: entry.quiz_id || incomingQuizIds[0] || null,
          quiz_ids: incomingQuizIds.slice(),
          skill: entry.skill || null,
          correct: !!entry.correct,
          stages: incomingStages.slice()
        };
        byId[id] = copy; merged.push(copy); return;
      }
      var existing = byId[id];
      incomingQuizIds.forEach(function (quizId) { if (existing.quiz_ids.indexOf(quizId) < 0) existing.quiz_ids.push(quizId); });
      if (entry.skill && !existing.skill) existing.skill = entry.skill;
      incomingStages.forEach(function (stage) { if (existing.stages.indexOf(stage) < 0) existing.stages.push(stage); });
      // Keep the original correctness value for a duplicate question ID; duplicates
      // represent the same evidence item and must never inflate totals.
    }
    (Array.isArray(primary) ? primary : []).forEach(add);
    (Array.isArray(verification) ? verification : []).forEach(add);
    return merged;
  }

  function calculateEvidenceSkillProfile(evidence) {
    var totals = {};
    var counts = {};
    (Array.isArray(evidence) ? evidence : []).forEach(function (entry) {
      var skill = String(entry && entry.skill || '').toLowerCase();
      if (SKILLS.indexOf(skill) < 0) return;
      counts[skill] = (counts[skill] || 0) + 1;
      totals[skill] = (totals[skill] || 0) + (entry.correct ? 1 : 0);
    });
    var profile = {};
    SKILLS.forEach(function (skill) {
      profile[skill] = counts[skill] >= 2 ? Math.round(totals[skill] / counts[skill] * 100) : null;
    });
    return { skills: profile, counts: counts };
  }

  function coverageReport(questions) {
    var counts = {};
    SKILLS.forEach(function (skill) { counts[skill] = 0; });
    (Array.isArray(questions) ? questions : []).forEach(function (q) {
      var skill = String(q && q.skill || '').toLowerCase();
      if (SKILLS.indexOf(skill) >= 0 && String(q && q.question_type || 'radio').toLowerCase().replace(/[\s-]+/g, '_') !== 'banner') counts[skill] += 1;
    });
    var b = PLACEMENT_BLUEPRINT_V2.coverage;
    var missing = [];
    Object.keys(b.minimums).forEach(function (skill) {
      if ((counts[skill] || 0) < b.minimums[skill]) missing.push(skill);
    });
    var compound = b.required_compound_skills.map(function (rule) {
      var total = rule.skills.reduce(function (sum, skill) { return sum + (counts[skill] || 0); }, 0);
      return { key: rule.key, minimum: rule.minimum, count: total, meets: total >= rule.minimum, skills: rule.skills.slice() };
    });
    compound.forEach(function (rule) { if (!rule.meets) missing.push(rule.key); });
    return {
      total_questions: Object.keys(counts).reduce(function (sum, skill) { return sum + counts[skill]; }, 0),
      skill_counts: counts,
      minimums: JSON.parse(JSON.stringify(b.minimums)),
      compound_requirements: compound,
      unavailable_skills: JSON.parse(JSON.stringify(b.unavailable_skills)),
      missing: missing,
      meets_blueprint: missing.length === 0,
      claimable_cefr_evidence: missing.length === 0
    };
  }

  function calculateSkillProfile(questions, correctMap) {
    var totals = {};
    var counts = {};
    (questions || []).forEach(function (q, index) {
      var skill = String(q && q.skill || '').toLowerCase();
      if (SKILLS.indexOf(skill) < 0) return;
      totals[skill] = (totals[skill] || 0) + (correctMap[index] ? 1 : 0);
      counts[skill] = (counts[skill] || 0) + 1;
    });
    var profile = {};
    SKILLS.forEach(function (skill) {
      profile[skill] = counts[skill] >= 2 ? Math.round(totals[skill] / counts[skill] * 100) : null;
    });
    return { skills: profile, counts: counts };
  }

  function calculateResult(input) {
    var questions = Array.isArray(input && input.questions) ? input.questions : [];
    var correctMap = input && input.correctMap && typeof input.correctMap === 'object' ? input.correctMap : {};
    var graded = Number(input && input.graded_questions) || questions.filter(function (q) { return String(q && q.question_type || 'radio') !== 'banner'; }).length;
    var score = clamp(Number(input && input.score) || 0, 0, 100);
    var evidence = Array.isArray(input && input.evidence) ? mergePlacementEvidence(input.evidence, []) : buildEvidence(questions, correctMap, input && input.quiz_id, input && input.stage);
    var skill = evidence.length ? calculateEvidenceSkillProfile(evidence) : calculateSkillProfile(questions, correctMap);
    var coverage = coverageReport(questions);
    var confidence = confidenceFor({ graded_questions: graded, score: score, complete: input && input.complete !== false, conflicting_signals: input && input.conflicting_signals });
    var decision = decideFromPerformance({ assessed_level: input && input.assessed_level, score: score, graded_questions: graded, complete: input && input.complete !== false });
    var evidenceCorrect = evidence.reduce(function (sum, entry) { return sum + (entry.correct ? 1 : 0); }, 0);
    var evidenceQuizIds = [];
    evidence.forEach(function (entry) {
      (Array.isArray(entry.quiz_ids) ? entry.quiz_ids : [entry.quiz_id]).forEach(function (quizId) {
        if (quizId && evidenceQuizIds.indexOf(String(quizId)) < 0) evidenceQuizIds.push(String(quizId));
      });
    });
    return {
      estimated_level: normalizeLevel(input && input.estimated_level),
      assessed_level: normalizeLevel(input && input.assessed_level),
      recommended_level: decision.recommended_level,
      score: Math.round(score * 100) / 100,
      score_band: scoreBand(score).label,
      confidence: confidence,
      skills: skill.skills,
      skill_counts: skill.counts,
      assessment_quiz_ids: Array.isArray(input && input.assessment_quiz_ids) ? input.assessment_quiz_ids.slice() : [],
      evidence: evidence,
      evidence_question_count: evidence.length,
      evidence_correct_count: evidenceCorrect,
      evidence_skill_counts: skill.counts,
      evidence_quiz_ids: evidenceQuizIds,
      evidence_stages: Array.from(new Set(evidence.reduce(function (out, entry) { return out.concat(entry.stages || [entry.stage]); }, []))),
      coverage: coverage,
      boundary_reason: decision.reason,
      boundary_check: decision.boundary_check,
      graded_questions: graded,
      complete: input && input.complete !== false,
      timestamp: Number(input && input.timestamp) || Date.now()
    };
  }

  function readStored() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var value = JSON.parse(raw);
      if (!value || typeof value !== 'object') return null;
      if (LEVELS.indexOf(String(value.recommended_level || value.assessed_level || '').toLowerCase()) < 0) return null;
      if (!Number.isFinite(Number(value.score))) return null;
      return value;
    } catch (e) { return null; }
  }

  function writeStored(result) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      return true;
    } catch (e) { return false; }
  }


  function validatePlacementBlueprint() {
    var b = PLACEMENT_BLUEPRINT_V2;
    if (b.version !== 2) return false;
    if (b.levels.join(',') !== LEVELS.join(',')) return false;
    if (b.orientation.question_count !== 10) return false;
    if (b.primary_assessment.min_graded_questions < 1) return false;
    if (b.primary_assessment.upper_boundary <= b.primary_assessment.lower_boundary_exclusive) return false;
    if (b.verification.max_adjacent_hops !== 1 || b.verification.one_pass_only !== true) return false;
    if (b.confidence.high_min_graded <= b.confidence.medium_min_graded) return false;
    if (b.confidence.near_boundary_margin < 0) return false;
    if (b.skill_reporting.min_questions_per_skill !== 2) return false;
    if (b.coverage.minimums.grammar < 1 || b.coverage.minimums.vocabulary < 1 || b.coverage.minimums.reading < 1) return false;
    if (b.coverage.minimums.listening !== 0) return false;
    if (!Array.isArray(b.coverage.required_compound_skills) || !b.coverage.required_compound_skills.length) return false;
    return b.persistence.result_key === STORAGE_KEY;
  }

  function resolvePlacement(input) {
    input = input || {};
    var estimated = normalizeLevel(input.estimated_level);
    var assessed = normalizeLevel(input.assessed_level || estimated);
    var score = clamp(Number(input.score) || 0, 0, 100);
    var graded = Number(input.graded_questions) || 0;
    var complete = input.complete !== false;
    var stage = String(input.stage || 'primary').toLowerCase();
    var confidence = confidenceFor({ graded_questions: graded, score: score, complete: complete, conflicting_signals: input.conflicting_signals });
    var result = {
      blueprint_version: PLACEMENT_BLUEPRINT_V2.version,
      stage: stage,
      estimated_level: estimated,
      assessed_level: assessed,
      score: Math.round(score * 100) / 100,
      score_band: scoreBand(score).key,
      graded_questions: graded,
      complete: complete,
      confidence: confidence,
      action: 'complete',
      reason: 'score_in_band',
      verification_level: null,
      recommended_level: assessed,
      finality: 'final'
    };

    if (!complete || graded < PLACEMENT_BLUEPRINT_V2.primary_assessment.min_graded_questions) {
      result.action = stage === 'verification' ? 'repeat_verification_or_choose_level' : 'complete_more_questions';
      result.reason = 'insufficient_evidence';
      result.finality = 'provisional';
      return result;
    }

    if (stage === 'primary') {
      var boundary = decideVerificationPath({ assessed_level: assessed, score: score });
      if (boundary.direction !== 'none') {
        result.action = 'verify_boundary';
        result.reason = boundary.reason;
        result.verification_level = boundary.level;
        result.recommended_level = assessed;
        result.finality = 'provisional';
      }
      return result;
    }

    // A single boundary verification can move one level from the verification
    // target, but it cannot silently chain into a second verification.
    // Therefore scores beyond the verified bank's own boundary stay at the
    // verified level and are surfaced as an unresolved edge, rather than
    // auto-jumping another CEFR level.
    if (score >= 85 || score < 50) {
      result.recommended_level = assessed;
      result.reason = score >= 85 ? 'verification_upper_edge' : 'verification_lower_edge';
      result.action = 'continue_at_verified_level';
      result.finality = 'final_with_edge_signal';
    }
    return result;
  }

  function validateQuestionMetadata(question) {
    if (!question || typeof question !== 'object') return false;
    if (question.skill != null && SKILLS.indexOf(String(question.skill).toLowerCase()) < 0) return false;
    if (question.difficulty != null) {
      var d = Number(question.difficulty);
      if (!Number.isInteger(d) || d < DIFFICULTY.min || d > DIFFICULTY.max) return false;
    }
    if (question.estimated_time_seconds != null) {
      var t = Number(question.estimated_time_seconds);
      if (!Number.isFinite(t) || t <= 0) return false;
    }
    if (question.cefr != null && LEVELS.indexOf(String(question.cefr).toLowerCase()) < 0) return false;
    return true;
  }

  global.MylingoPlacement = {
    LEVELS: LEVELS.slice(),
    SKILLS: SKILLS.slice(),
    DIFFICULTY: { min: DIFFICULTY.min, max: DIFFICULTY.max },
    SCORE_BANDS: SCORE_BANDS.map(function (x) { return { min: x.min, max: x.max, key: x.key, label: x.label }; }),
    STORAGE_KEY: STORAGE_KEY,
    normalizeLevel: normalizeLevel,
    adjacentLevel: adjacentLevel,
    scoreBand: scoreBand,
    decideAssessmentPath: decideAssessmentPath,
    decideVerificationPath: decideVerificationPath,
    decideFromPerformance: decideFromPerformance,
    finalizeVerification: finalizeVerification,
    confidenceFor: confidenceFor,
    buildEvidence: buildEvidence,
    mergePlacementEvidence: mergePlacementEvidence,
    calculateEvidenceSkillProfile: calculateEvidenceSkillProfile,
    coverageReport: coverageReport,
    calculateSkillProfile: calculateSkillProfile,
    calculateResult: calculateResult,
    validateQuestionMetadata: validateQuestionMetadata,
    PLACEMENT_BLUEPRINT_V2: JSON.parse(JSON.stringify(PLACEMENT_BLUEPRINT_V2)),
    validatePlacementBlueprint: validatePlacementBlueprint,
    resolvePlacement: resolvePlacement,
    readStored: readStored,
    writeStored: writeStored
  };
})(window);
