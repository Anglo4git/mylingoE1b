# Mylingo production quiz schema

Top-level fields:
`id`, `title`, `description`, `brand`, `category`, `tags`, `level`, `version`, `questions`

Each question:
`question`, `category`, `tags`, `explanation`, `correctIndex` (1-based), `answers` (2–9 strings).

The uploaded Mylingo quiz pages currently use the equivalent TSV fields `Question`, `Category`, `Tags`, `Question explanation`, `Correct answer (Index)`, and `Answer 1`–`Answer 9`. This starter normalizes them into JSON.


## Authoring compatibility

The integrated authoring app lives at `authoring/mylingo-admin.html`.
Its canonical row model is identical to `master_source.csv`, including all
nine answer slots and a 1-based `correct_index`.

Legacy authoring imports are accepted and normalized at the boundary:

- `prompt` → `question_text`
- `question_num` → `question_number`
- `option_0..option_3` → `answer_1..answer_4`
- legacy `correct_index` 0-based → canonical 1-based
- `category` can populate both `quiz_category` and `question_category`

The authoring export targets the same runtime JSON schema and topic-first
path layout produced by `build.py`.

## Question experience extensions (Milestone 3)

`question_type` is optional. If omitted, a question is treated as the legacy
`radio` type, preserving existing `question` / `answers` / `correctIndex`
quizzes. `question_text` is the preferred new text field; runtime falls back
to legacy `question`.

Supported `question_type` values are `radio`, `checkbox`, `dropdown`, `text`,
`short_text`, `number`, `date`, `matching`, `ranking`, `fill_in_the_blank`,
and `banner`. Compatibility aliases map `comparison` to the closest supported
choice/matching/text type, `reorganizer` to `ranking`, and
`complete_question` to `fill_in_the_blank`.

Media may be supplied through `media.image` and `media.audio` (strings or
objects with `src`/`url`, plus optional `alt`/`label`). Legacy `imageUrl` and
`imageAlt` remain supported. Audio never autoplays.

## Milestone 5 placement metadata

Placement question files may include these optional internal metadata fields:

- `skill`: one of `grammar`, `vocabulary`, `reading`, `listening`, `writing`, `usage`.
- `subskill`: a controlled descriptive subskill string used for analysis.
- `difficulty`: integer 1–5, where 1 is easiest and 5 is hardest.
- `cefr`: one of `A1`–`C2`.
- `estimated_time_seconds`: positive number.

These fields are internal product metadata and are not official CEFR certification measurements. Legacy quiz fields remain unchanged and continue to be accepted.

## Canonical learning metadata (Milestone 64)

Learning metadata uses `skill` as the canonical top-level skill name and
`objective` as the canonical learning-objective field. `learning_objective` is
accepted only as a compatibility alias from generation metadata. The canonical
skill vocabulary is `grammar`, `vocabulary`, `reading`, `listening`, `writing`,
and `usage`; `Academic English` maps to `usage` when no explicit skill is
provided. Optional `subskill`, `difficulty`, `cefr`, and
`estimated_time_seconds` retain their existing placement semantics.

These fields are additive and optional. Legacy 23-column source files remain
valid and produce no new metadata when the fields are absent.

## Content Schema v2 (Milestone 7)

See `07_CONTENT_SCHEMA_V2.md` for the full contract. Summary: two new
**optional** `master_source.csv` columns, `date_added` and `date_updated`
(ISO 8601), plus a controlled tag vocabulary (`tag_vocabulary.json`) that
`quiz_tags`/`question_tags` values are checked against. Both are
additive — the 23 canonical columns Agent 1 locked down stay frozen and
unchanged, no column is required, and the current published dataset
produces identical `build.py validate` and `content_qa.py` results with or
without this milestone applied.


## Content architecture v2 bridge (Milestone 8)

The authoring/source model may now express content as:
`Course → Unit → Lesson → Activity → Question`. Canonical identifiers are
explicit on each level (`course.id`, `unit.id`, `lesson.id`, `activity.id`) with
parent references (`unit.course_id`, `lesson.unit_id`, `activity.lesson_id`).
Each question may declare `question_type` explicitly; omitted type remains the
legacy `radio` default. The runtime adapter exposes `normalizeHierarchy()` and
`flattenActivityToQuiz()` so a single rich activity can load through the existing
quiz runtime without changing legacy quiz IDs or the learner-facing v1 shape.
