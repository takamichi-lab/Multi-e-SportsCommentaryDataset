'use strict';
// Common time model. Source CSV rows are retained for inspection.
window.ViewerCore = (() => {
  const missing = value => value == null || /^(|nan|null|none)$/i.test(String(value).trim());
  function number(value) {
    if (missing(value)) return null;
    const text = String(value).trim();
    if (/^\d+(?::\d+(?:\.\d+)?){1,2}$/.test(text)) {
      return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    }
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  function parseCSV(text) {
    const data = []; let row = [], field = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (c === ',' && !quoted) { row.push(field); field = ''; }
      else if ((c === '\r' || c === '\n') && !quoted) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); if (row.some(v => v.trim())) data.push(row);
        row = []; field = '';
      } else field += c;
    }
    if (quoted) throw new Error('CSVの引用符が閉じられていません。');
    row.push(field); if (row.some(v => v.trim())) data.push(row);
    const columns = (data.shift() || []).map(v => v.trim());
    if (!columns.length || new Set(columns).size !== columns.length) throw new Error('CSVの列名が空か重複しています。');
    const warnings = [];
    const rows = data.map((values, i) => {
      if (values.length > columns.length) throw new Error(`CSV ${i + 2}行目の列数が多すぎます。`);
      if (values.length < columns.length) warnings.push(`CSV ${i + 2}行目の不足列を空欄として表示します。`);
      return Object.fromEntries(columns.map((key, j) => [key, values[j] || '']));
    });
    return {columns, rows, warnings};
  }
  function normalize(data) {
    const {columns, rows} = data;
    const has = key => columns.includes(key);
    const items = [], ranges = [], warnings = [...(data.warnings || [])];
    const timeKey = ['video_time_sec', 'time_sec'].find(has);
    const intervalKeys = [['video_start_sec', 'video_end_sec'], ['start_time', 'end_time'],
      ['game_start_sec', 'game_end_sec'], ['start', 'end']].find(keys => keys.every(has));
    const scale = data.timeScale || 1;
    const at = v => { const n = number(v); return n === null ? null : n * scale; };
    const add = (rowIndex, from, to, inclusive, observed, label) => {
      if (from === null || to === null || from < 0 || to < from) {
        warnings.push(`CSV ${rowIndex + 2}行目の時刻が不正で、同期対象から除外しました。`); return;
      }
      items.push({rowIndex, from, to, inclusive, observed, label});
    };
    let rule;
    if (intervalKeys) {
      rule = '区間型：開始以上・終了未満の行をすべて表示';
      rows.forEach((r, i) => {
        const start = at(r[intervalKeys[0]]), end = at(r[intervalKeys[1]]);
        add(i, start, end, false, start, `区間 ${i + 1}`);
      });
    } else if (timeKey && has('score_phase') && has('segment_start_sec') && has('segment_end_sec')) {
      rule = '変更前・変更後：区間開始〜イベント直前はscore_before、イベント時刻〜区間終了未満はscore_after';
      rows.forEach((r, i) => {
        const start = at(r.segment_start_sec), end = at(r.segment_end_sec), event = at(r[timeKey]);
        if (start === null || end === null || event === null || event < start || event > end) {
          warnings.push(`CSV ${i + 2}行目のイベント時刻が区間に収まりません。`); return;
        }
        if (!['score_before', 'score_after'].includes(r.score_phase)) {
          warnings.push(`CSV ${i + 2}行目のscore_phaseが不明です。`); return;
        }
        add(i, r.score_phase === 'score_before' ? start : event,
          r.score_phase === 'score_before' ? event : end, false, event,
          `game ${r.game_id} / segment ${r.segment_id}`);
      });
    } else if (timeKey) {
      rule = '観測型：同じ区間内の直前の値を保持。同時刻の複数行はまとめて表示';
      const groups = new Map(); let quarterRun = 0, previousQuarter;
      rows.forEach((r, i) => {
        const time = at(r[timeKey]);
        if (time === null || time < 0) { warnings.push(`CSV ${i + 2}行目の観測時刻が不正です。`); return; }
        if (has('quarter') && r.quarter !== previousQuarter) { quarterRun++; previousQuarter = r.quarter; }
        const key = JSON.stringify([r.game_id || '', r.segment_id || '', has('quarter') ? quarterRun : '',
          r.segment_start_sec || '', r.segment_end_sec || '']);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({r, i, time});
      });
      for (const group of groups.values()) {
        group.sort((a, b) => a.time - b.time || a.i - b.i);
        const first = group[0], last = group[group.length - 1];
        const candidate = (data.sport === 'shadowverse' ? [] : data.bounds || []).find(b => number(b.id) === number(first.r.game_id) && !missing(first.r.game_id));
        const hasExplicit = has('segment_start_sec') && has('segment_end_sec');
        const rawStart = at(first.r.segment_start_sec), rawEnd = at(first.r.segment_end_sec);
        const explicit = hasExplicit && rawStart !== null && rawEnd !== null && rawStart >= 0 && rawEnd >= rawStart;
        const bound = candidate && at(candidate.start) !== null && at(candidate.end) !== null &&
          at(candidate.start) >= 0 && at(candidate.end) >= at(candidate.start) ? candidate : null;
        if (hasExplicit && !explicit) warnings.push(`CSV ${first.i + 2}行目からの区間端が不足・不正です。${bound ? '別の区間CSV' : '最初〜最後の観測範囲'}で表示します。`);
        const start = explicit ? rawStart : bound ? at(bound.start) : first.time;
        const end = explicit ? rawEnd : bound ? at(bound.end) : last.time;
        const label = has('quarter') ? `Q${first.r.quarter}` :
          [first.r.game_id ? `game ${first.r.game_id}` : '', first.r.segment_id ? `segment ${first.r.segment_id}` : ''].filter(Boolean).join(' / ') || '観測区間';
        // Compute the next distinct timestamp once for every simultaneous batch.
        for (let j = 0; j < group.length;) {
          let next = j + 1;
          while (next < group.length && group[next].time === group[j].time) next++;
          for (let k = j; k < next; k++) {
            const sample = group[k], from = start === null ? null : Math.max(start, sample.time);
            const to = end === null ? null : Math.min(end, next < group.length ? group[next].time : end);
            if (from !== null && to !== null && from > to) continue;
            add(sample.i, from, to, next === group.length && !explicit && !bound, sample.time, label);
          }
          j = next;
        }
      }
      rule += has('quarter') ? '。Qの最初〜最後の観測を有効区間にし、Q間は区間外' :
        '。明示区間がない場合は各game/segmentの最初〜最後の観測が有効区間';
      if (data.sport === 'valorant') rule += '。VALORANTのgame_idはマップ単位です。元のラウンド区間CSVのIDとは対応付けません';
      if (data.sport === 'shadowverse') rule += '。Shadowverseは同一game_idの最初〜最後の観測を有効区間とし、ゲーム間は区間外です';
    } else if (rows.length) throw new Error('時刻列を認識できません。video_time_sec、開始・終了時刻などが必要です。');
    else rule = 'CSV未登録：動画のみ再生できます';
    items.sort((a, b) => a.from - b.from || a.rowIndex - b.rowIndex);
    const rangeMap = new Map();
    items.forEach(item => {
      const key = item.label;
      if (!rangeMap.has(key)) rangeMap.set(key, {label: key, from: item.from, to: item.to});
      const range = rangeMap.get(key); range.from = Math.min(range.from, item.from); range.to = Math.max(range.to, item.to);
    });
    ranges.push(...rangeMap.values());
    const times = [...new Set(items.map(item => item.from))].sort((a, b) => a - b);
    const rowTimes = new Map(items.map(item => [item.rowIndex, item.from]));
    return {items, times, rowTimes, ranges, warnings, rule, columns, rows};
  }
  function activeAt(model, time) {
    return model.items.filter(item => time >= item.from && (time < item.to || (item.inclusive && time === item.to)));
  }
  return {missing, number, parseCSV, normalize, activeAt};
})();
