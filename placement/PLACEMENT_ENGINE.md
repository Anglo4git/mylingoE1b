# Adaptive placement engine

`site/shared/js/placement.js` separates orientation estimates from measured placement.

## Score bands
- 90–100: Strong
- 80–89: Secure
- 60–79: Developing
- 40–59: Weak
- 0–39: Very weak

These are Mylingo product thresholds, not official CEFR certification.

## Boundary rules
A primary assessment is anchored to the orientation estimate. High-confidence estimates stay on the primary level; medium/low confidence creates an adjacent verification path and never skips more than one CEFR level.

For a completed primary assessment with enough evidence:
- 85–100% → recommend one level up (unless already C2).
- 50–84% → recommend the assessed level.
- 0–49% → recommend one level down (unless already A1).

Scores below 5 graded questions or incomplete attempts are `insufficient_evidence` and produce low confidence.

## Confidence
- **High:** at least 8 graded questions, complete attempt, and score is not in a boundary zone.
- **Medium:** 5–7 graded questions, or a near-boundary / upper-boundary score.
- **Low:** incomplete attempt, fewer than 5 graded questions, or conflicting signals.

## Skill metadata
Allowed `skill` values are `grammar`, `vocabulary`, `reading`, `listening`, `writing`, and `usage`. `difficulty` is 1–5. `estimated_time_seconds` is a positive number. `cefr` is one of A1–C2. These fields are internal metadata only.
