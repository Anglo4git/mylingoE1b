(function(global){'use strict';
var PROGRESS_KEY='mylingo.progress.v1',SESSION_INDEX='mylingo.sessions.v3.index',SESSION_PREFIX='mylingo.sessions.v3.';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch(e){return fallback}}
function progress(){return read(PROGRESS_KEY,{})}
function sessionFor(id){try{return read(SESSION_PREFIX+encodeURIComponent(id),null)}catch(e){return null}}
function sessionRatio(id,total){var s=sessionFor(id);if(!s||s.status!=='in-progress'||!Number.isInteger(s.questionIndex)||!total)return 0;return Math.max(0,Math.min(99,Math.round((s.questionIndex/total)*100)))}
function lessonPercent(lesson,p){var ids=lesson.exercise_quiz_ids||[];if(!ids.length)return 0;var done=ids.filter(function(id){return p[id]&&p[id].status==='completed'}).length;if(done===ids.length)return 100;var partial=ids.find(function(id){return p[id]&&p[id].status==='in-progress'});if(partial)return Math.round(((done+sessionRatio(partial,p[partial].totalQuestions||0)/100)/ids.length)*100);return Math.round(done/ids.length*100)}
function fetchJson(url){return fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok)throw Error(String(r.status));return r.json()})}
function resolveHomepageState(){return Promise.all([fetchJson('../course_content/courses.json'),fetchJson('../course_content/units.json'),fetchJson('../course_content/lessons.json')]).then(function(a){var courses=a[0],units=a[1],lessons=a[2],p=progress(),flat=[];courses.filter(function(c){return c.status==='published'}).forEach(function(c){units.filter(function(u){return u.course_id===c.course_id}).forEach(function(u){lessons.filter(function(l){return l.unit_id===u.unit_id&&l.status==='published'}).sort(function(x,y){return x.order-y.order}).forEach(function(l){flat.push({course:c,unit:u,lesson:l,percent:lessonPercent(l,p)})})})});var active=flat.find(function(x){return x.percent>0&&x.percent<100});if(!active)active=flat.find(function(x){return x.percent===100?false:(x.lesson.exercise_quiz_ids||[]).some(function(id){return p[id]})});return active||null})}
global.MylingoCourseProgress={readProgress:progress,lessonPercent:lessonPercent,resolveHomepageState:resolveHomepageState,esc:esc};
})(window);
