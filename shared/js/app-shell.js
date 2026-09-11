/* Mylingo App Shell — shared bottom navigation component (Agent 87)
 *
 * Single injectable bottom nav: Home / Courses / Practice / Progress.
 * Every page in the app lives exactly one directory below the site root
 * (main/, courses/, a1../c2, shared/), so a hardcoded '../' root prefix
 * resolves correctly from anywhere this script is included.
 *
 * Usage: include this file (and shared/css/app-shell.css) on any page.
 * It self-mounts on DOMContentLoaded and exposes window.MylingoAppShell:
 *   - mount(): idempotent, called automatically
 *   - setVisible(bool): show/hide the bar (used by shared/quiz.html to
 *     hide the nav during an active question and show it on
 *     start/end/error/loading overlays)
 *   - activeKey(): which tab is considered "active" for the current page
 *
 * Does not wire itself into any page's layout beyond appending itself to
 * <body> and adding a body class that reserves bottom padding — no other
 * page markup is required.
 */
(function(){
  'use strict';
  if(window.MylingoAppShell) return;

  var ROOT='../';

  var ICONS={
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5a1 1 0 0 0 1 1H9.5v-6h5v6H17.5a1 1 0 0 0 1-1V10"/></svg>',
    courses:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    practice:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    progress:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15v3"/><path d="M12 10v8"/><path d="M17 6v12"/></svg>'
  };

  var TABS=[
    {key:'home',     label:'Home',     href:ROOT+'main/index.html'},
    {key:'courses',  label:'Courses',  href:ROOT+'courses/index.html'},
    {key:'practice', label:'Practice', href:ROOT+'main/practice.html'},
    {key:'progress', label:'Progress', href:ROOT+'main/progress.html'}
  ];

  // Route-matching regexes. Order matters — first match wins.
  var ROUTES=[
    {key:'practice', re:/\/main\/practice\.html(?:$|[?#])/},
    {key:'progress', re:/\/main\/progress\.html(?:$|[?#])/},
    {key:'progress', re:/\/(a1|a2|b1|b2|c1|c2)\/dashboard\.html(?:$|[?#])/},
    {key:'practice', re:/\/(a1|a2|b1|b2|c1|c2)\/index\.html(?:$|[?#])/},
    {key:'courses',  re:/\/courses\//},
    {key:'home',     re:/\/main\/index\.html(?:$|[?#])/},
    {key:'home',     re:/\/site\/?(?:$|[?#])/},
    {key:'home',     re:/\/(?:$|[?#])/}
  ];

  function activeKey(){
    var path=(location.pathname||'').replace(/\\/g,'/');
    for(var i=0;i<ROUTES.length;i++){
      if(ROUTES[i].re.test(path)) return ROUTES[i].key;
    }
    return null;
  }

  function build(){
    var active=activeKey();
    var nav=document.createElement('nav');
    nav.id='mylingoAppShell';
    nav.className='mylingo-appshell';
    nav.setAttribute('role','navigation');
    nav.setAttribute('aria-label','Primary');
    nav.innerHTML=TABS.map(function(t){
      var isActive=t.key===active;
      return '<a class="as-tab'+(isActive?' active':'')+'" href="'+t.href+'"'+(isActive?' aria-current="page"':'')+'>'+
        '<span class="as-icon">'+ICONS[t.key]+'</span>'+
        '<span class="as-label">'+t.label+'</span>'+
      '</a>';
    }).join('');
    return nav;
  }

  function mount(){
    if(document.getElementById('mylingoAppShell')) return;
    if(!document.body) return;
    document.body.appendChild(build());
    document.body.classList.add('has-mylingo-appshell');
  }

  function setVisible(visible){
    var el=document.getElementById('mylingoAppShell');
    if(!el) return;
    el.setAttribute('data-hidden',visible?'false':'true');
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',mount);
  }else{
    mount();
  }

  window.MylingoAppShell={mount:mount,setVisible:setVisible,activeKey:activeKey};
})();
