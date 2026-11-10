'use strict';
const C = window.ViewerCore, $ = id => document.getElementById(id), video = $('video');
const labels = {
  top_team:'上側チーム', bottom_team:'下側チーム', left_team:'左チーム', right_team:'右チーム',
  top_score:'上側スコア', bottom_score:'下側スコア', left_score:'左スコア', right_score:'右スコア',
  top_vote_rate:'上側投票率 (%)', bottom_vote_rate:'下側投票率 (%)',
  top_win_rate:'上側勝率 (%)', bottom_win_rate:'下側勝率 (%)', win_rate:'勝率 (%)',
  quarter:'クォーター', game_time_sec:'試合時計', inning:'イニング', inning_half:'表・裏',
  outs:'アウト', '1st':'一塁', '2nd':'二塁', '3rd':'三塁',
  runner_on_first:'一塁', runner_on_second:'二塁', runner_on_third:'三塁',
  east_points:'東家点数', south_points:'南家点数', west_points:'西家点数', north_points:'北家点数',
  round_wind:'場風', round_number:'局', honba:'本場', squads_left:'残り部隊数',
  blue_gold:'青ゴールド', red_gold:'赤ゴールド', name:'プレイヤー', chips_bb:'チップ (BB)',
  game_id:'ゲームID', segment_id:'区間ID', match_id:'試合ID', score_phase:'変更前・後',
  record:'元の記録', event:'イベント', content:'内容', status:'状態', transcript:'文字起こし', notes:'注記',
};
let entries = [], data = {columns:[], rows:[]}, model = C.normalize(data), page = 0;
let active = [], renderedKey = '', version = 0, blobURL = null, localCSV = false;
const pageSize = 100;
function clock(time) {
  if (!Number.isFinite(time)) return '—';
  const ms = Math.round(Math.abs(time) * 1000);
  return (time < 0 ? '−' : '') + String(Math.floor(ms / 60000)).padStart(2,'0') + ':' +
    String(Math.floor(ms / 1000) % 60).padStart(2,'0') + '.' + String(ms % 1000).padStart(3,'0');
}
const offset = () => Number($('offset').value) || 0;
function status(text) { $('status').textContent = text; }
function shown(value) { return C.missing(value) ? '未取得' : String(value); }
function pathText() {
  $('paths').replaceChildren();
  for (const text of [`動画: ${data.video || '手元の動画を選択できます'}`, `CSV: ${data.csv || '未登録'}`]) {
    const line = document.createElement('div'); line.textContent = text; $('paths').append(line);
  }
}
function renderTable() {
  if ($('rows').closest('[hidden]')) return;
  $('head').replaceChildren(); const header = document.createElement('tr');
  for (const col of ['CSV行', ...model.columns]) { const th = document.createElement('th'); th.textContent = col; header.append(th); }
  $('head').append(header); $('rows').replaceChildren();
  const selected = new Set(active.map(item => item.rowIndex));
  const fragment = document.createDocumentFragment();
  for (let i = page * pageSize; i < Math.min(model.rows.length, (page + 1) * pageSize); i++) {
    const row = document.createElement('tr'); row.tabIndex = 0; row.dataset.index = i;
    if (selected.has(i)) { row.className = 'active'; row.setAttribute('aria-current','true'); }
    for (const value of [i + 2, ...model.columns.map(col => model.rows[i][col])]) {
      const cell = document.createElement('td'); cell.textContent = shown(value); cell.title = cell.textContent; row.append(cell);
    }
    const go = () => {
      const time = model.rowTimes.get(i);
      if (time === undefined) status('この行は時刻が不正、または有効区間外のため移動できません。');
      else seek(time);
    };
    row.addEventListener('click', go);
    row.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); go(); } });
    fragment.append(row);
  }
  $('rows').append(fragment);
  const pages = Math.max(1, Math.ceil(model.rows.length / pageSize));
  $('page-label').textContent = `${page + 1} / ${pages} ページ（100行ずつ）`;
  $('page-prev').disabled = page === 0; $('page-next').disabled = page >= pages - 1;
}
function renderCards() {
  $('cards').replaceChildren();
  if (!active.length) {
    const message = document.createElement('p');
    message.textContent = model.rows.length ? 'この時刻に有効な付与情報はありません。' : 'CSVが未登録です。手元のCSVを指定することもできます。';
    $('cards').append(message); return;
  }
  for (const item of active) {
    const row = model.rows[item.rowIndex], card = document.createElement('article'); card.className = 'card';
    const heading = document.createElement('h3'); heading.textContent = `${item.label} · CSV ${item.rowIndex + 2}行目`;
    const fields = document.createElement('dl');
    for (const col of model.columns) {
      const dt = document.createElement('dt'); dt.textContent = labels[col] || col; dt.title = col;
      const dd = document.createElement('dd'); dd.textContent = shown(row[col]); fields.append(dt, dd);
    }
    const observed = document.createElement('p'); observed.className = 'observed';
    observed.textContent = `${row.score_phase ? 'イベント時刻' : 'CSV観測・開始時刻'}: ${clock(item.observed)} / 適用: ${clock(item.from)} 〜 ${clock(item.to)}`;
    card.append(heading, fields, observed); $('cards').append(card);
  }
}
function update(force = false) {
  const time = video.currentTime + offset();
  $('video-time').textContent = clock(video.currentTime); $('csv-time').textContent = clock(time);
  active = C.activeAt(model, time);
  const key = active.map(item => item.rowIndex).join(',');
  $('badge').textContent = active.length ? `有効な情報 ${active.length}件` : model.rows.length ? '区間外' : 'CSV未登録';
  $('badge').classList.toggle('outside', !active.length);
  $('first').disabled = !model.times.length;
  $('previous').disabled = !model.times.some(t => t < time - 0.000001);
  $('next').disabled = !model.times.some(t => t > time + 0.000001);
  if (force || key !== renderedKey) {
    renderedKey = key;
    if ($('follow').checked && active.length) page = Math.floor(active[0].rowIndex / pageSize);
    renderCards(); renderTable();
  }
  window.VideoGraphs.update(time, active);
}
function install(incoming) {
  const nextModel = C.normalize(incoming); // Validate before replacing the current model.
  data = incoming; model = nextModel; page = 0; renderedKey = '';
  $('row-count').textContent = `${model.rows.length.toLocaleString()}行`;
  $('rule').textContent = model.rule;
  $('bounds-source').textContent = data.bounds_source ? `区間の参照元: ${data.bounds_source}` : '区間はCSVの明示時刻、または観測範囲から設定しています。';
  $('ranges').replaceChildren(...model.ranges.map(range => {
    const li = document.createElement('li'), button = document.createElement('button');
    button.textContent = `${range.label}: ${clock(range.from)} 〜 ${clock(range.to)}`;
    button.addEventListener('click', () => seek(range.from)); li.append(button); return li;
  }));
  $('warnings').textContent = model.warnings.length ? `${model.warnings.length}件の注意:\n${model.warnings.slice(0, 10).join('\n')}${model.warnings.length > 10 ? '\n…詳細は元CSVを確認してください。' : ''}` : '';
  window.VideoGraphs.install(model, data, {seek, clock, labels});
  pathText(); update(true);
}
function seek(csvTime) {
  const time = csvTime - offset();
  if (!Number.isFinite(video.duration)) { status('動画の読み込み完了後に移動してください。'); return; }
  if (time < 0 || time > video.duration) { status('この時刻は動画の範囲外です。動画・補正値・時刻単位を確認してください。'); return; }
  video.currentTime = time; update(true);
}
function setVideo(path) {
  video.pause();
  if (blobURL) { URL.revokeObjectURL(blobURL); blobURL = null; }
  if (path) video.src = '/' + path.split('/').map(encodeURIComponent).join('/');
  else video.removeAttribute('src');
  video.load();
}
async function selectDataset() {
  const entry = entries.find(item => item.id === $('dataset').value); if (!entry) return;
  const token = ++version;
  localCSV = false; $('units').value = '1'; $('units').disabled = true;
  $('offset').value = '0'; $('csv-file').value = ''; $('video-file').value = '';
  install({...entry, columns:[], rows:[]}); setVideo(entry.video);
  status('CSVを読み込み中…');
  try {
    const response = await fetch('/api/viewer/data?id=' + encodeURIComponent(entry.id), {cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const incoming = await response.json(); if (token !== version) return;
    install(incoming);
    status(incoming.csv ? `${entry.name} — ${model.rows.length.toLocaleString()}行を読み込みました。「最初の情報へ」で移動できます。${model.warnings.length ? ' 時刻ルール欄に注意事項があります。' : ''}` : `${entry.name} — Score内のCSVが未登録です。動画は再生できます。`);
  } catch (error) { if (token === version) status('読み込み失敗: ' + error.message); }
}
function fillDatasets(previous) {
  $('dataset').replaceChildren();
  for (const item of entries.filter(e => e.sport === $('sport').value)) {
    const option = document.createElement('option'); option.value = item.id;
    option.textContent = item.name + (!item.csv ? '［CSVなし］' : !item.video ? '［動画なし］' : ''); $('dataset').append(option);
  }
  if ([...$('dataset').options].some(option => option.value === previous)) $('dataset').value = previous;
  return selectDataset();
}
async function loadCatalog() {
  const previousSport = $('sport').value, previousDataset = $('dataset').value;
  status('動画一覧を取得中…');
  if (location.protocol === 'file:') {
    status('自動一覧にはローカルサーバーが必要です。M1で python3 Score/serve_viewer.py を実行し、表示された全動画版URLを開いてください。ここでは手元の動画・CSVを選んで使えます。');
    $('units').disabled = false; return;
  }
  try {
    const response = await fetch('/api/viewer/catalog', {cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    entries = (await response.json()).entries;
    $('sport').replaceChildren();
    for (const sport of [...new Set(entries.map(e => e.sport))]) {
      const option = document.createElement('option'); option.value = sport;
      option.textContent = `${sport} (${entries.filter(e => e.sport === sport).length})`; $('sport').append(option);
    }
    if ([...$('sport').options].some(option => option.value === previousSport)) $('sport').value = previousSport;
    else if (entries.some(e => e.sport === 'Baseball')) $('sport').value = 'Baseball';
    await fillDatasets(previousDataset);
  } catch (error) { status('一覧取得失敗: ' + error.message + '。起動中のserve_viewer.pyを停止して、最新版で起動し直してください。手元の動画・CSVの指定でも使えます。'); }
}
$('sport').addEventListener('change', () => fillDatasets()); $('dataset').addEventListener('change', selectDataset);
$('reload').addEventListener('click', loadCatalog);
$('video-file').addEventListener('change', event => {
  const file = event.target.files[0]; if (!file) return;
  setVideo(null); blobURL = URL.createObjectURL(file); video.src = blobURL; video.load();
  data.video = file.name; pathText(); status('手元の動画を読み込みました。CSVと対応する動画か確認してください。');
});
$('csv-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const token = ++version;
  const videoPath = data.video;
  install({columns:[], rows:[], video:videoPath});
  try {
    const text = await file.text(); if (token !== version) return;
    const parsed = C.parseCSV(text);
    install({...parsed, csv:file.name, video:videoPath, timeScale:Number($('units').value)});
    localCSV = true; $('units').disabled = false;
    status(`${file.name} — ${model.rows.length.toLocaleString()}行を読み込みました。時刻単位は${$('units').selectedOptions[0].textContent}です。`);
  } catch (error) { if (token === version) status('CSV読込失敗: ' + error.message); }
});
$('units').addEventListener('change', () => { if (localCSV) { install({...data, timeScale:Number($('units').value)}); } });
$('offset').addEventListener('input', () => update(true));
$('speed').addEventListener('change', () => { video.playbackRate = Number($('speed').value); });
$('first').addEventListener('click', () => seek(model.times[0]));
$('previous').addEventListener('click', () => { const t = video.currentTime + offset(); const prev = model.times.filter(x => x < t - 0.000001).at(-1); if (prev !== undefined) seek(prev); });
$('next').addEventListener('click', () => { const next = model.times.find(x => x > video.currentTime + offset() + 0.000001); if (next !== undefined) seek(next); });
$('page-prev').addEventListener('click', () => { page--; $('follow').checked = false; renderTable(); });
$('page-next').addEventListener('click', () => { page++; $('follow').checked = false; renderTable(); });
$('follow').addEventListener('change', () => update(true));
for (const event of ['timeupdate','seeked','pause','ended']) video.addEventListener(event, () => update());
video.addEventListener('loadedmetadata', () => { video.playbackRate = Number($('speed').value); update(); });
video.addEventListener('error', () => status('動画を読み込めません。対応する動画を選び直すか、ブラウザが対応する形式か確認してください。'));
let lastFrame = 0;
function frame(time) { if (!video.paused && time - lastFrame >= 100) { update(); lastFrame = time; } requestAnimationFrame(frame); }
requestAnimationFrame(frame);
install(data); loadCatalog();
