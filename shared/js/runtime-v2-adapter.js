/* Mylingo Runtime v2 Adapter
 *
 * A compatibility boundary between authored/legacy quiz payloads and the
 * production quiz runtime. The adapter is intentionally dependency-free and
 * does not mutate its input. Existing v1 payloads remain valid; v2/legacy
 * aliases are normalized into the fields consumed by quiz.html.
 */
(function (global) {
  'use strict';

  var LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  var QUESTION_TYPE_ALIASES = {
    comparison: 'matching',
    reorganizer: 'ranking',
    reorganizer_task: 'ranking',
    complete_question: 'fill_in_the_blank',
    'complete-question': 'fill_in_the_blank'
  };

  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function firstDefined(obj, keys, fallback) {
    for (var i = 0; i < keys.length; i += 1) {
      if (obj && obj[keys[i]] !== undefined && obj[keys[i]] !== null) return obj[keys[i]];
    }
    return fallback;
  }

  function stringValue(value) {
    return value == null ? '' : String(value).trim();
  }

  function numberValue(value, fallback) {
    if (value === '' || value == null) return fallback;
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizedLevel(value, fallback) {
    var level = stringValue(value).toLowerCase();
    return LEVELS.indexOf(level) >= 0 ? level : fallback || '';
  }

  function normalizedType(value) {
    var type = stringValue(value || 'radio').toLowerCase().replace(/[\s-]+/g, '_');
    return QUESTION_TYPE_ALIASES[type] || type || 'radio';
  }

  function normalizeAnswer(value) {
    if (isObject(value)) {
      return stringValue(firstDefined(value, ['text', 'label', 'value'], ''));
    }
    return stringValue(value);
  }

  function answerList(question) {
    var source = Array.isArray(question.answers)
      ? question.answers
      : Array.isArray(question.options)
        ? question.options
        : null;

    if (!source) {
      source = [];
      for (var i = 1; i <= 9; i += 1) {
        if (question['answer_' + i] !== undefined && question['answer_' + i] !== null) {
          source.push(question['answer_' + i]);
        }
      }
    }
    return source.map(normalizeAnswer);
  }

  function normalizeCorrectIndex(question, answers) {
    // Legacy authoring exports used option_0..option_3 with a zero-based
    // correct_index. Apply the offset only when that explicit legacy shape is
    // present; ordinary `correct_index` remains canonical 1-based.
    if (Array.isArray(question.options) && question.correct_index != null &&
        question.answer_1 === undefined && question.option_0 !== undefined) {
      var legacy = numberValue(question.correct_index, null);
      if (Number.isInteger(legacy)) return legacy + 1;
    }

    var direct = firstDefined(question, ['correctIndex', 'correct_index', 'correctAnswerIndex', 'correct_answer_index'], null);
    if (direct != null) {
      var n = numberValue(direct, null);
      if (Number.isInteger(n)) return n;
    }

    if (Array.isArray(question.answers)) {
      for (var i = 0; i < question.answers.length; i += 1) {
        var item = question.answers[i];
        if (isObject(item) && (item.is_correct === true || item.isCorrect === true)) return i + 1;
      }
    }

    return null;
  }

  function normalizeAcceptedAnswers(question) {
    var value = firstDefined(question,
      ['acceptedAnswers', 'accepted_answers', 'correctAnswer', 'correct_answer', 'answer'],
      null);
    if (value == null && Array.isArray(question.answers) && !Number.isInteger(numberValue(question.correctIndex, null))) {
      value = question.answers;
    }
    if (value == null) return undefined;
    return Array.isArray(value) ? value.slice() : [value];
  }

  function normalizeMedia(question) {
    var media = isObject(question.media) ? question.media : null;
    if (!media && (question.imageUrl != null || question.audioUrl != null)) {
      media = {};
      if (question.imageUrl != null) media.image = { src: question.imageUrl, alt: question.imageAlt || '' };
      if (question.audioUrl != null) media.audio = { src: question.audioUrl, label: question.audioLabel || '' };
    }
    if (!media) return undefined;

    function one(key) {
      var value = media[key];
      if (value == null) return undefined;
      if (typeof value === 'string') return { src: value };
      if (isObject(value)) {
        return {
          src: stringValue(firstDefined(value, ['src', 'url'], '')),
          alt: stringValue(firstDefined(value, ['alt', 'label'], '')),
          label: stringValue(value.label || '')
        };
      }
      return undefined;
    }

    var out = {};
    var image = one('image');
    var audio = one('audio');
    if (image && image.src) out.image = image;
    if (audio && audio.src) out.audio = audio;
    return Object.keys(out).length ? out : undefined;
  }

  function copyOptional(target, source, key) {
    if (source[key] !== undefined) target[key] = source[key];
  }

  function normalizeQuestion(input) {
    if (!isObject(input)) throw new Error('Question must be an object.');

    var answers = answerList(input);
    var out = {
      question: stringValue(firstDefined(input, ['question', 'question_text', 'prompt', 'content'], '')),
      category: stringValue(firstDefined(input, ['category', 'question_category'], '')),
      tags: stringValue(firstDefined(input, ['tags', 'question_tags'], '')),
      explanation: stringValue(firstDefined(input, ['explanation', 'question_explanation'], '')),
      correctIndex: normalizeCorrectIndex(input, answers),
      answers: answers
    };

    var canonical = global.MylingoCanonicalMetadata;
    if (canonical) {
      var metadata = canonical.normalize(input, out.category);
      Object.keys(metadata).forEach(function (key) { out[key] = metadata[key]; });
    }

    var type = normalizedType(firstDefined(input, ['question_type', 'questionType', 'type'], 'radio'));
    if (type !== 'radio') out.question_type = type;

    var media = normalizeMedia(input);
    if (media) out.media = media;

    var accepted = normalizeAcceptedAnswers(input);
    if (accepted !== undefined) out.acceptedAnswers = accepted;

    ['subprompt', 'correctIndices', 'pairs', 'matches', 'items', 'correctOrder',
     'skill', 'subskill', 'difficulty', 'cefr', 'estimated_time_seconds'].forEach(function (key) {
      copyOptional(out, input, key);
    });

    if (out.correctIndex == null && input.correctIndices !== undefined) delete out.correctIndex;
    if (out.question_type === 'radio') delete out.question_type;
    return out;
  }

  function normalizeQuiz(input, options) {
    if (!isObject(input)) throw new Error('Quiz payload must be an object.');
    options = options || {};

    var questionSource = Array.isArray(input.questions)
      ? input.questions
      : Array.isArray(input.items)
        ? input.items
        : Array.isArray(input.data)
          ? input.data
          : [];

    var out = {
      id: stringValue(firstDefined(input, ['id', 'quiz_id', 'quizId'], '')),
      title: stringValue(firstDefined(input, ['title', 'name'], '')),
      description: stringValue(firstDefined(input, ['description', 'summary'], '')),
      brand: stringValue(firstDefined(input, ['brand'], 'Mylingo')) || 'Mylingo',
      category: stringValue(firstDefined(input, ['category', 'quiz_category'], '')),
      tags: stringValue(firstDefined(input, ['tags', 'quiz_tags'], '')),
      level: normalizedLevel(firstDefined(input, ['level', 'cefr_level'], options.level || ''), options.level || ''),
      version: numberValue(firstDefined(input, ['version'], 1), 1),
      questions: questionSource.map(normalizeQuestion)
    };

    // Runtime metadata is intentionally additive: it may be supplied by a v2
    // producer without becoming part of the learner-visible v1 contract.
    ['date_added', 'date_updated', 'dateAdded', 'dateUpdated'].forEach(function (key) {
      copyOptional(out, input, key);
    });
    return out;
  }

  function canonicalId(value, fallback) {
    var id = stringValue(value);
    return id || stringValue(fallback);
  }

  function normalizeHierarchy(input) {
    if (!isObject(input)) throw new Error('Content hierarchy must be an object.');

    var course = isObject(input.course) ? input.course : input;
    var units = Array.isArray(input.units) ? input.units : (Array.isArray(course.units) ? course.units : []);
    var normalizedUnits = units.map(function (unit, unitIndex) {
      unit = isObject(unit) ? unit : {};
      var unitId = canonicalId(unit.id || unit.unit_id, 'unit-' + (unitIndex + 1));
      var lessons = Array.isArray(unit.lessons) ? unit.lessons : [];

      return {
        id: unitId,
        title: stringValue(firstDefined(unit, ['title', 'name'], '')),
        course_id: canonicalId(unit.course_id || unit.courseId, course.id || course.course_id),
        lessons: lessons.map(function (lesson, lessonIndex) {
          lesson = isObject(lesson) ? lesson : {};
          var lessonId = canonicalId(lesson.id || lesson.lesson_id, unitId + '-lesson-' + (lessonIndex + 1));
          var activities = Array.isArray(lesson.activities) ? lesson.activities : [];

          return {
            id: lessonId,
            title: stringValue(firstDefined(lesson, ['title', 'name'], '')),
            unit_id: unitId,
            activities: activities.map(function (activity, activityIndex) {
              activity = isObject(activity) ? activity : {};
              var activityId = canonicalId(activity.id || activity.activity_id, lessonId + '-activity-' + (activityIndex + 1));
              var rawQuestions = Array.isArray(activity.questions) ? activity.questions : [];
              var questions = rawQuestions.map(function (question) {
                var normalized = normalizeQuestion(question);
                // Hierarchy is a source-side contract, so keep an explicitly
                // authored type (including `radio`) visible here. The legacy
                // quiz runtime still omits `radio` when flattened below.
                normalized.question_type = normalizedType(firstDefined(question, ['question_type', 'questionType', 'type'], 'radio'));
                return normalized;
              });
              return {
                id: activityId,
                title: stringValue(firstDefined(activity, ['title', 'name'], '')),
                lesson_id: lessonId,
                activity_type: normalizedType(firstDefined(activity, ['activity_type', 'activityType', 'type'], 'quiz')),
                questions: questions
              };
            })
          };
        })
      };
    });

    return {
      course: {
        id: canonicalId(course.id || course.course_id, ''),
        title: stringValue(firstDefined(course, ['title', 'name'], '')),
        units: normalizedUnits
      }
    };
  }

  function flattenActivityToQuiz(input) {
    if (!isObject(input) || !isObject(input.course)) throw new Error('Activity bridge requires a course object.');
    var hierarchy = normalizeHierarchy(input);
    var course = hierarchy.course;
    var matches = [];
    course.units.forEach(function (unit) {
      unit.lessons.forEach(function (lesson) {
        lesson.activities.forEach(function (activity) {
          matches.push({ unit: unit, lesson: lesson, activity: activity });
        });
      });
    });
    if (matches.length !== 1) throw new Error('Activity bridge requires exactly one activity.');

    var match = matches[0];
    var activity = match.activity;
    return normalizeQuiz({
      id: canonicalId(activity.id, match.lesson.id + '-activity-1'),
      title: activity.title || match.lesson.title || course.title,
      category: firstDefined(input, ['category'], ''),
      level: firstDefined(input, ['level'], ''),
      version: firstDefined(input, ['version'], 1),
      questions: activity.questions
    });
  }

  function normalizeManifest(input) {
    if (!Array.isArray(input)) return [];
    return input.filter(isObject).map(function (entry) {
      var out = {
        file: stringValue(firstDefined(entry, ['file', 'path'], '')),
        id: stringValue(firstDefined(entry, ['id', 'quiz_id', 'quizId'], '')),
        title: stringValue(firstDefined(entry, ['title', 'name'], '')),
        topic: stringValue(firstDefined(entry, ['topic'], '')),
        description: stringValue(firstDefined(entry, ['description', 'summary'], '')),
        category: stringValue(firstDefined(entry, ['category', 'quiz_category'], '')),
        tags: stringValue(firstDefined(entry, ['tags', 'quiz_tags'], '')),
        level: normalizedLevel(entry.level),
        questions: numberValue(entry.questions, 0),
        version: numberValue(entry.version, 1)
      };
      if (entry.date !== undefined) out.date = entry.date;
      if (entry.date_added !== undefined) out.date_added = entry.date_added;
      if (entry.date_updated !== undefined) out.date_updated = entry.date_updated;
      return out;
    });
  }

  global.MylingoRuntimeV2 = Object.freeze({
    VERSION: '2.0',
    LEVELS: LEVELS.slice(),
    normalizeQuiz: normalizeQuiz,
    normalizeQuestion: normalizeQuestion,
    normalizeHierarchy: normalizeHierarchy,
    flattenActivityToQuiz: flattenActivityToQuiz,
    normalizeManifest: normalizeManifest
  });
}(window));
