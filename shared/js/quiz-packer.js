(function (root) {
  "use strict";

  const DEFAULTS = Object.freeze({ minSize: 5, targetSize: 20, maxSize: 150 });

  function norm(value) {
    return String(value == null ? "" : value).trim();
  }

  function bucketKey(row) {
    return [norm(row.level).toUpperCase(), norm(row.quiz_category || row.category), norm(row.title)]
      .map(v => v.toLowerCase())
      .join("|");
  }

  function levelCategoryKey(row) {
    return [norm(row.level).toUpperCase(), norm(row.quiz_category || row.category)]
      .map(v => v.toLowerCase())
      .join("|");
  }

  function profileKey(level, category) {
    return [norm(level).toUpperCase(), norm(category)].map(v => v.toLowerCase()).join("|");
  }

  function indexProfiles(profiles) {
    const byKey = new Map();
    (Array.isArray(profiles) ? profiles : []).forEach(p => {
      if (!p || !p.level || !p.quiz_category) return;
      byKey.set(profileKey(p.level, p.quiz_category), p);
    });
    return byKey;
  }

  function resolveBucketOptions(level, category, profileIndex, fallback) {
    const profile = profileIndex ? profileIndex.get(profileKey(level, category)) : null;
    if (!profile) return { ...fallback, profileId: null };
    return {
      minSize: Number.isFinite(profile.min_size) ? profile.min_size : fallback.minSize,
      targetSize: Number.isFinite(profile.target_size) ? profile.target_size : fallback.targetSize,
      maxSize: Number.isFinite(profile.max_size) ? profile.max_size : fallback.maxSize,
      titleTemplate: profile.title_template || null,
      descriptionTemplate: profile.description_template || null,
      profileId: profile.id || null
    };
  }

  function applyTemplate(template, vars) {
    return String(template).replace(/\$\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));
  }

  function nextQuizId(level, usedIds) {
    const prefix = norm(level).toLowerCase();
    let max = 0;
    usedIds.forEach(id => {
      const match = norm(id).match(new RegExp("^" + prefix + "-(\\d+)$", "i"));
      if (match) max = Math.max(max, Number(match[1]));
    });
    let n = max + 1;
    let candidate = `${prefix}-${String(n).padStart(3, "0")}`;
    while (usedIds.has(candidate)) candidate = `${prefix}-${String(++n).padStart(3, "0")}`;
    return candidate;
  }

  function rebalance(pool, targetSize, maxSize) {
    if (!pool.length) return [];
    const size = Math.min(maxSize, Math.max(1, targetSize));
    const groups = [];
    for (let i = 0; i < pool.length; i += size) groups.push(pool.slice(i, i + size));
    if (groups.length > 1 && groups[groups.length - 1].length < DEFAULTS.minSize) {
      const tail = groups.pop();
      const prev = groups[groups.length - 1];
      const room = maxSize - prev.length;
      if (room >= tail.length) prev.push(...tail);
      else {
        const take = Math.min(room, tail.length);
        prev.push(...tail.splice(0, take));
        groups.push(tail);
      }
    }
    return groups;
  }

  function packRows(rows, options) {
    const opts = { ...DEFAULTS, ...(options || {}) };
    const profileIndex = indexProfiles(opts.profiles);
    const input = Array.isArray(rows) ? rows : [];
    const selectedOnly = opts.selectedIds ? new Set(opts.selectedIds) : null;
    const eligible = [];
    const untouched = [];
    const usedIds = new Set(input.map(r => norm(r && r.quiz_id)).filter(Boolean));

    input.forEach((row, index) => {
      const copy = row;
      const selected = !selectedOnly || selectedOnly.has(copy.__internalId);
      const id = norm(copy.quiz_id);
      const numericQ = Number(copy.question_number);
      const existingSizeHint = Number.isInteger(numericQ) && numericQ > 0;
      if (!selected || (id && !opts.repackExisting) || existingSizeHint && id && !opts.repackExisting) {
        untouched.push(copy);
        return;
      }
      copy.__packOrder = index;
      eligible.push(copy);
    });

    const byBucket = new Map();
    eligible.forEach(row => {
      const key = levelCategoryKey(row);
      if (!byBucket.has(key)) byBucket.set(key, []);
      byBucket.get(key).push(row);
    });

    const packed = [];
    const changed = [];
    const usedProfiles = new Set();
    byBucket.forEach(pool => {
      pool.sort((a, b) => (a.__packOrder || 0) - (b.__packOrder || 0));
      const level = norm(pool[0].level).toUpperCase();
      const category = norm(pool[0].quiz_category || pool[0].category) || "General Practice";
      const bucketOpts = resolveBucketOptions(level, category, profileIndex, opts);
      if (bucketOpts.profileId) usedProfiles.add(bucketOpts.profileId);
      const chunks = rebalance(pool, bucketOpts.targetSize, bucketOpts.maxSize);
      chunks.forEach(chunk => {
        if (chunk.length < bucketOpts.minSize) {
          // Keep tiny tails together rather than manufacture an invalid quiz.
          packed.push(...chunk);
          return;
        }
        const title = bucketOpts.titleTemplate
          ? applyTemplate(bucketOpts.titleTemplate, { category, level })
          : `Mixed ${category} Practice`;
        const description = bucketOpts.descriptionTemplate
          ? applyTemplate(bucketOpts.descriptionTemplate, { category, level })
          : `Practice ${title}.`;
        const id = nextQuizId(level, usedIds);
        usedIds.add(id);
        chunk.forEach((row, i) => {
          row.quiz_id = id;
          row.title = title;
          row.description = description;
          row.question_number = i + 1;
          row.quiz_category = category;
          row.quiz_tags = `${category},${level}`;
          row.question_category = row.question_category || category;
          row.question_tags = row.question_tags || `${category},${level}`;
          changed.push(row);
        });
        packed.push(...chunk);
      });
    });

    input.forEach(row => { delete row.__packOrder; });
    return {
      rows: input,
      packedQuizCount: new Set(changed.map(r => norm(r.quiz_id))).size,
      packedRowCount: changed.length,
      changed,
      profilesApplied: Array.from(usedProfiles)
    };
  }

  root.MylingoQuizPacker = Object.freeze({
    DEFAULTS,
    packRows,
    bucketKey,
    levelCategoryKey,
    profileKey,
    indexProfiles
  });
})(window);
