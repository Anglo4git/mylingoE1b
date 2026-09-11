/* Mylingo Authoring Draft Autosave — chunked, bounded-memory v2. */
(function (global) {
  "use strict";
  const STORAGE_KEY = "mylingo.authoring-draft.v1"; // legacy snapshot
  const MANIFEST_KEY = "mylingo.authoring-draft.v2.manifest";
  const CHUNK_PREFIX = "mylingo.authoring-draft.v2.chunk.";
  const SCHEMA_VERSION = 2;
  const LEGACY_SCHEMA_VERSION = 1;
  const DEFAULT_DEBOUNCE_MS = 650;
  const DEFAULT_CHUNK_SIZE = 200;

  function resolveStorage(storage) { if (storage) return storage; try { return global.localStorage; } catch (_) { return null; } }
  function timestamp(value) { const n = Date.parse(String(value || "")); return Number.isFinite(n) ? new Date(n).toISOString() : null; }
  function cleanRow(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const copy = {};
    for (const key of Object.keys(row)) if (key !== "__internalId") copy[key] = row[key];
    return copy;
  }
  function chunkKey(i) { return CHUNK_PREFIX + i; }

  function create(storage, options) {
    const store = resolveStorage(storage);
    const debounceMs = Number.isFinite(options?.debounceMs) ? Math.max(0, Number(options.debounceMs)) : DEFAULT_DEBOUNCE_MS;
    const chunkSize = Number.isFinite(options?.chunkSize) ? Math.max(1, Math.floor(options.chunkSize)) : DEFAULT_CHUNK_SIZE;
    let timer = null;

    function readManifest() {
      if (!store?.getItem) return null;
      try {
        const m = JSON.parse(store.getItem(MANIFEST_KEY) || "null");
        if (!m || m.schemaVersion !== SCHEMA_VERSION || !Array.isArray(m.chunks) || !timestamp(m.savedAt)) return null;
        return m;
      } catch (_) { return null; }
    }
    function loadV2() {
      const manifest = readManifest(); if (!manifest) return null;
      const rows = [];
      try {
        for (const c of manifest.chunks) {
          const part = JSON.parse(store.getItem(chunkKey(c.index)) || "null");
          if (!Array.isArray(part) || part.length !== c.rowCount) return null;
          for (const row of part) { if (!row || typeof row !== "object" || Array.isArray(row)) return null; rows.push(row); }
        }
      } catch (_) { return null; }
      return { ...manifest, rows, savedAt: timestamp(manifest.savedAt) };
    }
    function loadLegacy() {
      try {
        const old = JSON.parse(store?.getItem?.(STORAGE_KEY) || "null");
        if (!old || old.schemaVersion !== LEGACY_SCHEMA_VERSION || !Array.isArray(old.rows) || !timestamp(old.savedAt)) return null;
        return { schemaVersion: LEGACY_SCHEMA_VERSION, savedAt: timestamp(old.savedAt), activeLevel: String(old.activeLevel || "ALL"), rows: old.rows };
      } catch (_) { return null; }
    }
    function save(rows, viewState) {
      if (!store?.setItem) return { ok:false, reason:"storage-unavailable" };
      if (!Array.isArray(rows)) rows = [];
      const savedAt = new Date().toISOString();
      const chunks = [];
      let written = 0;
      try {
        for (let start = 0, index = 0; start < rows.length; start += chunkSize, index += 1) {
          const part = [];
          for (let i = start; i < Math.min(start + chunkSize, rows.length); i += 1) { const row = cleanRow(rows[i]); if (row) part.push(row); }
          store.setItem(chunkKey(index), JSON.stringify(part));
          chunks.push({ index, rowCount: part.length }); written = index + 1;
        }
        const previous = readManifest();
        const manifest = { schemaVersion: SCHEMA_VERSION, savedAt, activeLevel: String(viewState?.activeLevel || "ALL"), rowCount: rows.length, chunkSize, chunks };
        store.setItem(MANIFEST_KEY, JSON.stringify(manifest));
        if (previous?.chunks) for (const c of previous.chunks) if (c.index >= written) store.removeItem(chunkKey(c.index));
        return { ok:true, savedAt, rowCount: rows.length, chunkCount: chunks.length };
      } catch (error) { return { ok:false, reason:error?.name === "QuotaExceededError" ? "quota" : "write-failed", error }; }
    }
    function schedule(rows, viewState, onSaved) { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer=null; const r=save(rows,viewState); if (typeof onSaved === "function") onSaved(r); }, debounceMs); }
    function flush(rows, viewState) { if (timer) { clearTimeout(timer); timer=null; } return save(rows,viewState); }
    function load() { return loadV2() || loadLegacy(); }
    function clear() {
      if (!store?.removeItem) return false;
      try { const m=readManifest(); store.removeItem(MANIFEST_KEY); store.removeItem(STORAGE_KEY); if (m?.chunks) m.chunks.forEach(c=>store.removeItem(chunkKey(c.index))); if(timer){clearTimeout(timer);timer=null;} return true; } catch(_){return false;}
    }
    function hasDraft() { return Boolean(readManifest() || loadLegacy()); }
    function formatSavedAt(savedAt) { const n=Date.parse(String(savedAt||"")); return Number.isFinite(n)?new Date(n).toLocaleString():""; }
    return { STORAGE_KEY, MANIFEST_KEY, SCHEMA_VERSION, chunkSize, save, schedule, flush, load, clear, hasDraft, formatSavedAt };
  }
  global.MylingoAuthoringDraftAutosave = { STORAGE_KEY, MANIFEST_KEY, SCHEMA_VERSION, create };
})(window);
