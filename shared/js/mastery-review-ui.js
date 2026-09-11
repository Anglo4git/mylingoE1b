/*! Mylingo Mastery + Review Dashboard UI — Agent 40 */
(function (global) {
  'use strict';

  var mastery = global.MylingoSkillMastery;
  var scheduler = global.MylingoReviewScheduler;
  var SKILLS = mastery && mastery.SKILLS ? mastery.SKILLS.slice() : ['grammar', 'vocabulary', 'reading', 'listening', 'writing', 'usage'];

  var STYLE = [
    '.mr-section{margin:24px 0;background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:20px;padding:18px;box-shadow:0 8px 24px rgba(23,33,43,.06)}',
    '.mr-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}',
    '.mr-head h2{font-size:18px;margin:0 0 4px}',
    '.mr-head p{margin:0;color:var(--muted,#6b7280);font-size:13px;line-height:1.45;max-width:650px}',
    '.mr-count{font-size:12px;font-weight:800;border-radius:999px;padding:6px 10px;background:var(--brand-soft,#eaf1fc);color:var(--brand,#1959d1);white-space:nowrap}',
    '.mr-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:14px 0}',
    '.mr-kpi{border:1px solid var(--line,#e5e7eb);border-radius:14px;padding:12px}',
    '.mr-kpi .n{font-size:20px;font-weight:900}',
    '.mr-kpi .l{font-size:11px;color:var(--muted,#6b7280);margin-top:2px}',
    '.mr-list{display:grid;gap:8px}',
    '.mr-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid var(--line,#e5e7eb);border-radius:15px;padding:12px 14px}',
    '.mr-main{min-width:0}',
    '.mr-title{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-weight:850}',
    '.mr-title span:first-child{text-transform:capitalize}',
    '.mr-sub{display:block;color:var(--muted,#6b7280);font-size:11px;line-height:1.4;margin-top:3px}',
    '.mr-meter{height:8px;background:#edf0f3;border-radius:99px;overflow:hidden;margin-top:8px}',
    '.mr-meter i{display:block;height:100%;background:var(--brand,#1959d1)}',
    '.mr-chip{font-size:10px;font-weight:800;border-radius:999px;padding:3px 8px;white-space:nowrap;background:#f1f3f5;color:var(--muted,#6b7280)}',
    '.mr-chip.due{background:#fff7e0;color:#8a6100}',
    '.mr-chip.needs-support{background:#ffe9e7;color:#b23b34}',
    '.mr-chip.developing{background:#fff7e0;color:#8a6100}',
    '.mr-chip.secure{background:#eaf1fc;color:var(--brand,#1959d1)}',
    '.mr-chip.mastered{background:#e9f8df;color:#3e8f08}',
    '.mr-action{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:9px 13px;border-radius:999px;border:1px solid var(--brand,#1959d1);background:var(--brand,#1959d1);color:#fff;text-decoration:none;font-weight:800;font-size:12px;white-space:nowrap}',
    '.mr-empty{padding:16px 0 2px;color:var(--muted,#6b7280);font-size:13px;line-height:1.5}',
    '.mr-next{margin-top:14px;padding:14px;border-radius:15px;background:var(--brand-soft,#eaf1fc);display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}',
    '.mr-next b{display:block;font-size:13px;margin-bottom:2px}',
    '.mr-next span{display:block;color:var(--muted,#6b7280);font-size:11px;line-height:1.4}',
    '.mr-note{margin:10px 0 0;color:var(--muted,#6b7280);font-size:11px;line-height:1.45}',
    '@media(max-width:560px){.mr-row{grid-template-columns:1fr}.mr-action{justify-self:start}}'
  ].join('');

  function ensureStyle() {
    if (!global.document || document.getElementById('mylingo-mastery-review-style')) return;
    var style = document.createElement('style');
    style.id = 'mylingo-mastery-review-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  function labelForSkill(skill) {
    return String(skill || '').replace(/_/g, ' ');
  }

  function bandLabel(skillData) {
    if (!skillData || skillData.accuracy == null) return 'Not started';
    var key = skillData.mastery_band;
    var bands = mastery && mastery.MASTERY_BANDS ? mastery.MASTERY_BANDS : [];
    for (var i = 0; i < bands.length; i++) {
      if (bands[i].key === key) return bands[i].label;
    }
    return key ? String(key).replace(/_/g, ' ') : 'Tracked';
  }

  function bandClass(skillData) {
    return skillData && skillData.mastery_band ? String(skillData.mastery_band).replace(/_/g, '-') : '';
  }

  function buildSummary(masterStore, reviewStore, now) {
    masterStore = masterStore || { skills: {} };
    reviewStore = reviewStore || { skills: {} };
    var skills = masterStore.skills || {};
    var due = scheduler ? scheduler.getDueSkills(reviewStore, now) : [];
    var tracked = Object.keys(skills).filter(function (skill) { return skills[skill] && skills[skill].question_count > 0; });
    var totalQuestions = tracked.reduce(function (sum, skill) { return sum + Number(skills[skill].question_count || 0); }, 0);
    var totalCorrect = tracked.reduce(function (sum, skill) { return sum + Number(skills[skill].correct_count || 0); }, 0);
    var average = totalQuestions ? Math.round(totalCorrect / totalQuestions * 100) : null;
    var weakest = tracked.slice().sort(function (a, b) {
      return Number(skills[a].accuracy == null ? 101 : skills[a].accuracy) - Number(skills[b].accuracy == null ? 101 : skills[b].accuracy);
    })[0] || null;
    return {
      due: due,
      tracked: tracked,
      average: average,
      weakest: weakest,
      skillCount: tracked.length,
      dueCount: due.length,
      skills: skills,
      next: scheduler ? scheduler.getNextReview(reviewStore) : null
    };
  }

  function dueReason(item, skillData) {
    var accuracy = skillData && skillData.accuracy != null ? Math.round(skillData.accuracy) + '% accuracy' : 'limited evidence';
    var dueAt = item && item.card && item.card.due_at != null ? new Date(item.card.due_at) : null;
    var dateLabel = dueAt && !isNaN(dueAt.getTime()) ? dueAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'now';
    return accuracy + ' · review due ' + dateLabel;
  }

  function actionUrl(level) {
    return './index.html';
  }

  function compute(model) {
    model = model || {};
    var now = Number.isFinite(Number(model.now)) ? Number(model.now) : Date.now();
    var summary = buildSummary(model.masteryStore || { skills: {} }, model.reviewStore || { skills: {} }, now);
    var rows = summary.due.map(function (item) {
      var data = summary.skills[item.skill] || {};
      return { kind: 'due', skill: item.skill, accuracy: data.accuracy, mastery_band: data.mastery_band, card: item.card, reason: dueReason(item, data) };
    });
    var dueNames = {};
    rows.forEach(function (row) { dueNames[row.skill] = true; });
    summary.tracked.slice().sort(function (a, b) {
      var aa = Number(summary.skills[a].accuracy == null ? 101 : summary.skills[a].accuracy);
      var bb = Number(summary.skills[b].accuracy == null ? 101 : summary.skills[b].accuracy);
      return aa - bb;
    }).forEach(function (skill) {
      if (dueNames[skill]) return;
      var data = summary.skills[skill];
      rows.push({ kind: 'mastery', skill: skill, accuracy: data.accuracy, mastery_band: data.mastery_band, card: summary.next && summary.next.skill === skill ? summary.next.card : null, reason: bandLabel(data) + ' · ' + Math.round(data.accuracy) + '% accuracy' });
    });
    return { summary: summary, rows: rows, nextAction: summary.due[0] ? { skill: summary.due[0].skill, reason: rows[0].reason, url: actionUrl(model.level) } : (summary.weakest ? { skill: summary.weakest, reason: 'Lowest current mastery · ' + Math.round(summary.skills[summary.weakest].accuracy) + '% accuracy', url: actionUrl(model.level) } : null) };
  }

  function render(target, model) {
    if (!target) return null;
    ensureStyle();
    var out = compute(model || {});
    var summary = out.summary;
    var level = String((model || {}).level || '').toLowerCase();
    var titleId = 'mastery-review-title-' + Math.random().toString(36).slice(2);
    var actionHref = actionUrl(level);
    var html = '<section class="mr-section" aria-labelledby="' + titleId + '">' +
      '<div class="mr-head"><div><h2 id="' + titleId + '">Today’s Review</h2><p>See the skills due now, your current mastery, and the best next practice action.</p></div>' +
      '<span class="mr-count">' + (summary.dueCount ? summary.dueCount + ' due now' : 'Nothing due') + '</span></div>';

    if (!summary.skillCount && !summary.dueCount) {
      html += '<div class="mr-empty">Your mastery profile will appear after you complete a graded quiz. Review scheduling starts from that same quiz evidence automatically.</div>' +
        '<div class="mr-next"><div><b>Start your first review</b><span>Complete a practice quiz to create mastery and review data for this level.</span></div><a class="mr-action" href="' + esc(actionHref) + '">Practice ' + esc(level ? level.toUpperCase() : 'level') + '</a></div>' +
        '</section>';
      target.innerHTML = html;
      return out;
    }

    html += '<div class="mr-summary">' +
      '<div class="mr-kpi"><div class="n">' + summary.dueCount + '</div><div class="l">Due today</div></div>' +
      '<div class="mr-kpi"><div class="n">' + summary.skillCount + '</div><div class="l">Tracked skills</div></div>' +
      '<div class="mr-kpi"><div class="n">' + (summary.average == null ? '—' : summary.average + '%') + '</div><div class="l">Overall accuracy</div></div>' +
      '<div class="mr-kpi"><div class="n">' + (summary.weakest ? labelForSkill(summary.weakest) : '—') + '</div><div class="l">Priority skill</div></div>' +
      '</div>';

    if (summary.dueCount) {
      html += '<div class="mr-list">';
      summary.due.forEach(function (item) {
        var data = summary.skills[item.skill] || {};
        var pct = data.accuracy == null ? 0 : Math.max(0, Math.min(100, Number(data.accuracy)));
        html += '<div class="mr-row"><div class="mr-main"><div class="mr-title"><span>' + esc(labelForSkill(item.skill)) + '</span><span class="mr-chip due">Due now</span></div>' +
          '<small class="mr-sub">' + esc(dueReason(item, data)) + '</small>' +
          '<div class="mr-meter" aria-hidden="true"><i style="width:' + pct + '%"></i></div></div>' +
          '<a class="mr-action" href="' + esc(actionHref) + '">Review ' + esc(labelForSkill(item.skill)) + '</a></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="mr-empty">Nothing is due right now. Your next scheduled review is based on the review state already stored for this learner.</div>';
    }

    if (summary.skillCount) {
      html += '<p class="section-title" style="margin-top:18px">Mastery</p><div class="mr-list">';
      summary.tracked.slice().sort(function (a, b) {
        return Number(summary.skills[a].accuracy == null ? 101 : summary.skills[a].accuracy) - Number(summary.skills[b].accuracy == null ? 101 : summary.skills[b].accuracy);
      }).forEach(function (skill) {
        var data = summary.skills[skill];
        var pct = data.accuracy == null ? 0 : Math.max(0, Math.min(100, Number(data.accuracy)));
        html += '<div class="mr-row"><div class="mr-main"><div class="mr-title"><span>' + esc(labelForSkill(skill)) + '</span><span class="mr-chip ' + esc(bandClass(data)) + '">' + esc(bandLabel(data)) + '</span></div>' +
          '<small class="mr-sub">' + Math.round(data.accuracy) + '% accuracy · ' + Number(data.question_count || 0) + ' graded question' + (Number(data.question_count || 0) === 1 ? '' : 's') + '</small>' +
          '<div class="mr-meter" aria-hidden="true"><i style="width:' + pct + '%"></i></div></div>' +
          '<span class="mr-chip">' + esc(data.confidence || 'low') + ' confidence</span></div>';
      });
      html += '</div>';
    }

    if (out.nextAction) {
      html += '<div class="mr-next"><div><b>Next recommended action: review ' + esc(labelForSkill(out.nextAction.skill)) + '</b><span>' + esc(out.nextAction.reason) + '</span></div><a class="mr-action" href="' + esc(out.nextAction.url) + '">Practice now</a></div>';
    }
    html += '<p class="mr-note">Mastery is calculated from graded skill evidence; review dates come directly from the saved review scheduler.</p></section>';
    target.innerHTML = html;
    return out;
  }

  function mount(target, options) {
    options = options || {};
    var masteryStore = mastery ? mastery.readStored() : { skills: {} };
    var reviewStore = scheduler ? scheduler.readStored() : { skills: {} };
    return render(target, { level: options.level, masteryStore: masteryStore, reviewStore: reviewStore, now: options.now });
  }

  global.MylingoMasteryReviewUI = {
    VERSION: 1,
    buildSummary: buildSummary,
    compute: compute,
    render: render,
    mount: mount
  };
})(window);
