/*! Mylingo Offline Content Packs — Agent 25 */
(function (global) {
  'use strict';
  var CACHE_PREFIX = 'mylingo-offline-pack-v1-';
  var CACHE_PREFIX_PATTERN = /^mylingo-offline-pack-v\d+-/;
  var CACHE_META_KEY = 'mylingo-offline-pack-cache-meta-v1';
  var MAX_INSTALLED_PACKS = 4;
  // Bound simultaneous Cache Storage writes so a large pack cannot fan out
  // one promise/request per asset and spike browser memory/network pressure.
  var INSTALL_CONCURRENCY = 4;
  var BASE_URL = (function () {
    try {
      var script = document.currentScript && document.currentScript.src;
      return script ? new URL('../../', script).href : new URL('../../', location.href).href;
    } catch (e) { return './'; }
  })();
  function assetUrl(path) { return new URL(String(path).replace(/^\.\//, ''), BASE_URL).href; }
  function getIndex() {
    return fetch(assetUrl('offline/packs.json'), { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('Unable to load offline pack index');
      return response.json();
    });
  }
  function findPack(index, id) {
    var packs = index && Array.isArray(index.packs) ? index.packs : [];
    return packs.find(function (pack) { return pack && String(pack.id) === String(id); }) || null;
  }
  function cacheFor(id) { return global.caches ? caches.open(CACHE_PREFIX + String(id)) : Promise.resolve(null); }
  function readMeta() {
    try { return JSON.parse(global.localStorage.getItem(CACHE_META_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function writeMeta(meta) {
    try { global.localStorage.setItem(CACHE_META_KEY, JSON.stringify(meta)); } catch (e) {}
  }
  function touch(id) {
    var meta = readMeta();
    meta[String(id)] = Date.now();
    writeMeta(meta);
  }
  function cleanupOldCacheVersions() {
    if (!global.caches) return Promise.resolve();
    return caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return CACHE_PREFIX_PATTERN.test(key) && key.indexOf(CACHE_PREFIX) !== 0;
      }).map(function (key) { return caches.delete(key); }));
    });
  }
  function evictIfNeeded(exceptId) {
    if (!global.caches) return Promise.resolve();
    return caches.keys().then(function (keys) {
      var ids = keys.filter(function (key) { return key.indexOf(CACHE_PREFIX) === 0; })
        .map(function (key) { return key.slice(CACHE_PREFIX.length); })
        .filter(function (id) { return id && String(id) !== String(exceptId); });
      if (ids.length < MAX_INSTALLED_PACKS) return;
      var meta = readMeta();
      ids.sort(function (a, b) { return (meta[a] || 0) - (meta[b] || 0); });
      var remove = ids.slice(0, ids.length - MAX_INSTALLED_PACKS + 1);
      return Promise.all(remove.map(function (id) { delete meta[id]; return caches.delete(CACHE_PREFIX + id); }))
        .then(function () { writeMeta(meta); });
    });
  }
  function isInstalled(id) {
    if (!global.caches) return Promise.resolve(false);
    return cleanupOldCacheVersions().then(function () { return getIndex(); }).then(function (index) {
      var pack = findPack(index, id);
      if (!pack || !Array.isArray(pack.files) || !pack.files.length) return false;
      var deps = Array.isArray(pack.dependencies) ? pack.dependencies : [];
      return Promise.all(deps.map(function (dep) { return isInstalled(dep); })).then(function (ready) {
        if (!ready.every(Boolean)) return false;
        return caches.open(CACHE_PREFIX + String(id)).then(function (cache) {
          return Promise.all(pack.files.map(function (file) {
            return cache.match(assetUrl(file), { ignoreSearch: true });
          })).then(function (matches) {
            var installed = matches.every(Boolean);
            if (installed) touch(pack.id);
            return installed;
          });
        });
      });
    }).catch(function () { return false; });
  }
  function installPack(id, onProgress, dependencyStack) {
    dependencyStack = dependencyStack || {};
    if (dependencyStack[String(id)]) return Promise.reject(new Error('Offline pack dependency cycle: ' + id));
    dependencyStack[String(id)] = true;
    return cleanupOldCacheVersions().then(function () { return getIndex(); }).then(function (index) {
      var pack = findPack(index, id);
      if (!pack || !Array.isArray(pack.files)) throw new Error('Unknown offline pack: ' + id);
      if (!global.caches) throw new Error('Offline packs require Cache Storage support');
      var deps = Array.isArray(pack.dependencies) ? pack.dependencies : [];
      return deps.reduce(function (chain, dep) {
        return chain.then(function () { return installPack(dep, null, dependencyStack); });
      }, Promise.resolve()).then(function () { return evictIfNeeded(pack.id); }).then(function () {
        return caches.open(CACHE_PREFIX + String(id));
      }).then(function (cache) {
        var files = pack.files.slice();
        var total = files.length;
        var done = 0;
        var next = 0;
        var installed = new Array(total);
        var concurrency = Math.min(INSTALL_CONCURRENCY, total || 1);
        if (typeof onProgress === 'function') onProgress({ id: pack.id, done: 0, total: total });

        function worker() {
          var index = next;
          next += 1;
          if (index >= total) return Promise.resolve();
          var file = files[index];
          return cache.add(assetUrl(file)).then(function () {
            done += 1;
            installed[index] = file;
            if (typeof onProgress === 'function') onProgress({ id: pack.id, done: done, total: total, file: file });
            return worker();
          });
        }

        return Promise.all(Array.from({ length: concurrency }, worker)).then(function () {
          touch(pack.id);
          return { id: pack.id, files: installed, total: installed.length, dependencies: deps.slice() };
        }).catch(function (error) {
          return caches.delete(CACHE_PREFIX + String(id)).then(function () { throw error; });
        });
      });
    }).then(function (result) {
      delete dependencyStack[String(id)];
      return result;
    }, function (error) {
      delete dependencyStack[String(id)];
      throw error;
    });
  }
  function removePack(id) {
    if (!global.caches) return Promise.resolve(false);
    return getIndex().then(function (index) {
      var dependents = (index.packs || []).filter(function (pack) {
        return pack && Array.isArray(pack.dependencies) && pack.dependencies.indexOf(id) !== -1;
      });
      return Promise.all(dependents.map(function (pack) { return isInstalled(pack.id); })).then(function (installed) {
        if (installed.some(Boolean)) throw new Error('Cannot remove offline pack ' + id + ': installed packs depend on it');
        var meta = readMeta();
        delete meta[String(id)];
        writeMeta(meta);
        return caches.delete(CACHE_PREFIX + String(id));
      });
    });
  }
  global.MylingoOfflinePacks = {
    VERSION: 1,
    INSTALL_CONCURRENCY: INSTALL_CONCURRENCY,
    MAX_INSTALLED_PACKS: MAX_INSTALLED_PACKS,
    getIndex: getIndex,
    findPack: findPack,
    isInstalled: isInstalled,
    installPack: installPack,
    removePack: removePack,
    assetUrl: assetUrl
  };
})(window);
