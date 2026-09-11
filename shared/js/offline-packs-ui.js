/*! Mylingo Offline Packs UI — Agent 25 */
(function (global) {
  'use strict';
  var API = global.MylingoOfflinePacks;
  if (!API) return;
  var STYLE = [
    '.offline-section{margin:24px 0 0;background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:20px;padding:18px;box-shadow:0 8px 24px rgba(23,33,43,.06)}',
    '.offline-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}',
    '.offline-head h2{font-size:18px;margin:0 0 4px}',
    '.offline-head p{margin:0;color:var(--muted,#6b7280);font-size:13px;line-height:1.45;max-width:620px}',
    '.offline-network{font-size:11px;font-weight:800;border-radius:999px;padding:6px 9px;background:#f1f3f5;color:var(--muted,#4b5563);white-space:nowrap}',
    '.offline-network.online{background:#e9f8df;color:#2f6d06}',
    '.offline-list{display:grid;gap:8px;margin-top:14px}',
    '.offline-pack{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid var(--line,#e5e7eb);border-radius:15px;padding:12px 14px}',
    '.offline-pack b{display:block;font-size:14px}',
    '.offline-pack small{display:block;color:var(--muted,#6b7280);margin-top:3px;line-height:1.35}',
    '.offline-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}',
    '.offline-btn{border:1px solid var(--line,#e5e7eb);background:#fff;color:var(--ink,#17212b);font-weight:800;border-radius:999px;padding:9px 13px;min-height:40px;cursor:pointer}',
    '.offline-btn.primary{border-color:var(--brand,#1959d1);background:var(--brand,#1959d1);color:#fff}',
    '.offline-btn[disabled]{opacity:.6;cursor:wait}',
    '.offline-status{font-size:11px;font-weight:800;color:var(--muted,#6b7280);min-width:74px;text-align:right}',
    '.offline-note{margin:12px 0 0;font-size:11px;color:var(--muted,#6b7280);line-height:1.45}',
    '@media(max-width:560px){.offline-pack{grid-template-columns:1fr}.offline-actions{justify-content:flex-start}.offline-status{text-align:left}}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById('mylingo-offline-style')) return;
    var style = document.createElement('style');
    style.id = 'mylingo-offline-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
  function sizeLabel(count) {
    return count + ' asset' + (count === 1 ? '' : 's');
  }
  function renderPack(row, pack, installed) {
    var button = row.querySelector('button');
    var status = row.querySelector('.offline-status');
    var busy = false;
    function setBusy(value, label) {
      busy = value;
      button.disabled = value;
      status.textContent = label;
    }
    function setInstalled(value) {
      row.dataset.installed = value ? '1' : '0';
      button.textContent = value ? 'Remove' : (navigator.onLine === false ? 'Connect to install' : 'Install');
      button.className = 'offline-btn' + (value ? '' : ' primary');
      status.textContent = value ? 'Installed' : 'Not installed';
    }
    setInstalled(installed);
    button.addEventListener('click', function () {
      if (busy) return;
      if (row.dataset.installed !== '1' && navigator.onLine === false) return;
      if (row.dataset.installed === '1') {
        setBusy(true, 'Removing…');
        API.removePack(pack.id).then(function () { setInstalled(false); }).catch(function () {
          status.textContent = 'Remove failed';
        }).then(function () { button.disabled = false; busy = false; });
        return;
      }
      setBusy(true, 'Starting…');
      API.installPack(pack.id, function (progress) {
        var total = progress.total || pack.files.length || 1;
        status.textContent = 'Caching ' + progress.done + '/' + total;
      }).then(function () {
        setInstalled(true);
      }).catch(function (error) {
        status.textContent = 'Install failed';
        var detail = error && error.message ? error.message : 'Please try again while online.';
        button.title = detail;
      }).then(function () { button.disabled = false; busy = false; });
    });
  }
  function mount(target, options) {
    options = options || {};
    ensureStyle();
    var section = document.createElement('section');
    section.className = 'offline-section';
    section.setAttribute('aria-labelledby', 'offline-title-' + Math.random().toString(36).slice(2));
    var titleId = section.getAttribute('aria-labelledby');
    section.innerHTML = '<div class="offline-head"><div><h2 id="' + titleId + '">Offline learning</h2><p>Install content packs to keep selected lessons available without an internet connection.</p></div><span class="offline-network">Checking connection…</span></div><div class="offline-list"><div class="offline-note">Loading available packs…</div></div><p class="offline-note">Core keeps the Mylingo shell and essential learning logic ready offline. Level packs add that level’s quizzes and dashboard assets.</p>';
    target.appendChild(section);
    var network = section.querySelector('.offline-network');
    function updateNetwork() {
      var online = navigator.onLine !== false;
      network.textContent = online ? 'Online' : 'Offline';
      network.className = 'offline-network' + (online ? ' online' : '');
      section.querySelectorAll('.offline-pack').forEach(function (row) {
        var button = row.querySelector('button');
        var installed = row.dataset.installed === '1';
        if (!button || button.disabled) return;
        if (!installed) {
          button.disabled = !online;
          button.textContent = online ? 'Install' : 'Connect to install';
        }
      });
    }
    updateNetwork();
    global.addEventListener('online', updateNetwork);
    global.addEventListener('offline', updateNetwork);
    API.getIndex().then(function (index) {
      var packs = Array.isArray(index.packs) ? index.packs : [];
      if (options.level) {
        packs.sort(function (a, b) {
          var aBoost = String(a.id).toLowerCase() === String(options.level).toLowerCase() ? -1 : 0;
          var bBoost = String(b.id).toLowerCase() === String(options.level).toLowerCase() ? -1 : 0;
          return aBoost - bBoost || (a.id === 'core' ? -1 : 1);
        });
      }
      var list = section.querySelector('.offline-list');
      list.innerHTML = '';
      return Promise.all(packs.map(function (pack) {
        return API.isInstalled(pack.id).then(function (installed) { return { pack: pack, installed: installed }; });
      })).then(function (state) {
        state.forEach(function (entry) {
          var pack = entry.pack;
          var row = document.createElement('div');
          row.className = 'offline-pack';
          row.innerHTML = '<div><b>' + esc(pack.label || pack.id) + '</b><small>' + sizeLabel(Array.isArray(pack.files) ? pack.files.length : 0) + (pack.level ? ' · ' + esc(pack.level) : '') + '</small></div><div class="offline-actions"><span class="offline-status">Checking…</span><button type="button" class="offline-btn">Install</button></div>';
          list.appendChild(row);
          renderPack(row, pack, entry.installed);
        });
        updateNetwork();
        if (!state.length) list.innerHTML = '<div class="offline-note">No content packs are available in this build.</div>';
      });
    }).catch(function (error) {
      var list = section.querySelector('.offline-list');
      list.innerHTML = '<div class="offline-note">Offline packs could not be loaded. The rest of Mylingo is still available.</div>';
      section.querySelector('.offline-note').title = error && error.message ? error.message : '';
    });
    return section;
  }
  global.MylingoOfflinePacksUI = { VERSION: 1, mount: mount };
})(window);
