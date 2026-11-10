"""Generate the YouTube viewer without embedding CSV contents.

Run from any directory: python3 Score/build_youtube_viewer.py
Serve with: python3 Score/serve_viewer.py
Open: http://127.0.0.1:8000/Score/youtube_graph_viewer.html
The generated HTML also works on its own for YouTube links and manual CSV input.
"""

import json
from pathlib import Path

from viewer_catalog import catalog

HERE = Path(__file__).resolve().parent


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"既存ビューアの構造が変わっています: {old[:80]}")
    return text.replace(old, new, 1)


def build():
    html = (HERE / "video_graph_viewer.html").read_text(encoding="utf-8")
    html = replace_once(html, "グラフ付き動画・時刻別情報ビューア", "YouTube・CSVグラフビューア")
    html = replace_once(html, "VIDEO ANNOTATION VIEWER", "YOUTUBE ANNOTATION VIEWER")
    html = replace_once(html, "一覧を再取得", "一覧を再表示")
    html = replace_once(html, "グラフから動画の時刻へ移動", "YouTube動画とCSVを確認")
    html = replace_once(html, '<meta charset="utf-8">', '<meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin">')
    html = replace_once(html, '<label>手元の動画を指定<input type="file" id="video-file" accept="video/*"></label>',
                        '<label>動画ファイル名（拡張子は省略可）<input id="youtube-name" placeholder="Baseball_u23ftPzFsMo.mp4"></label><button id="youtube-apply">動画名から開く</button>')
    html = replace_once(html, '<video id="video" controls preload="metadata"></video>',
                        '<div id="youtube-host"></div><p><a id="youtube-link" target="_blank" rel="noopener" hidden>YouTubeで開く</a></p><p id="youtube-status" class="hint" role="status"></p>')
    html = replace_once(html, '点をクリックすると、動画と横の情報がその時刻に移動します。',
                        '点をクリックすると、埋め込み動画と横の情報がその時刻に移動します。動画ファイルは不要です。CSVはローカルから読み込みます。')

    # Reuse the maintained CSV model, graph renderer, and interface. Fail clearly
    # if their structure changes rather than silently producing a broken viewer.
    js = (HERE / "video_graph_viewer.js").read_text(encoding="utf-8")
    js = replace_once(js, "video = $('video')", "video = window.youtubeVideo")
    js = replace_once(js, "$('video-file').value = '';", "$('youtube-name').value = entry.name;")
    js = replace_once(js, 'setVideo(entry.video);', 'setVideo(entry.name);')
    js = replace_once(js, "status('CSVを読み込み中…');", """if (location.protocol === 'file:') {
    status('YouTubeリンクを用意しました。CSVは「手元のCSVを指定」から選択してください。');
    $('units').disabled = false; return;
  }
  status('CSVを読み込み中…');""")
    start = js.index('async function loadCatalog() {')
    end = js.index("$('sport').addEventListener", start)
    js = js[:start] + """async function loadCatalog() {
  const previousSport = $('sport').value, previousDataset = $('dataset').value;
  entries = window.youtubeCatalog;
  $('sport').replaceChildren();
  for (const sport of [...new Set(entries.map(e => e.sport))]) {
    const option = document.createElement('option'); option.value = sport;
    option.textContent = `${sport} (${entries.filter(e => e.sport === sport).length})`;
    $('sport').append(option);
  }
  if (entries.some(e => e.sport === previousSport)) $('sport').value = previousSport;
  else if (entries.some(e => e.sport === 'Baseball')) $('sport').value = 'Baseball';
  await fillDatasets(previousDataset);
}
""" + js[end:]
    start = js.index("$('video-file').addEventListener")
    end = js.index("$('csv-file').addEventListener", start)
    js = js[:start] + """$('youtube-apply').addEventListener('click', () => {
  const name = $('youtube-name').value.trim();
  if (!/_([A-Za-z0-9_-]{11})(?:\\.mp4)?$/i.test(name)) {
    status('「ジャンル名_11文字のYouTube動画ID」を入力してください。'); return;
  }
  ++version;
  localCSV = false; $('csv-file').value = ''; $('units').disabled = false;
  $('offset').value = '0';
  install({columns:[], rows:[], video:name}); setVideo(name);
  status('動画名からYouTubeリンクを作成しました。対応するCSVを選択してください。');
});
""" + js[end:]
    js = js.replace("!item.video ? '［動画なし］' : ''", "''")
    js = js.replace("動画: ${data.video || '手元の動画を選択できます'}", "動画: ${$('youtube-name').value || '未選択'}")

    styles = '\n'.join((HERE / name).read_text(encoding='utf-8') for name in
                       ('video_viewer.css', 'video_graph_viewer.css'))
    styles += '\n#youtube-host iframe{width:100%;aspect-ratio:16/9;height:auto;min-height:200px;border:0;border-radius:7px}#youtube-name{min-width:240px}'
    html = replace_once(html, '<link rel="stylesheet" href="video_viewer.css"><link rel="stylesheet" href="video_graph_viewer.css">',
                        '<style>' + styles + '</style>')
    html = replace_once(html, '<script src="video_viewer_core.js" defer></script><script src="video_graphs.js" defer></script><script src="video_graph_viewer.js" defer></script>', '')
    metadata = json.dumps(catalog(), ensure_ascii=False).replace('<', '\\u003c')
    scripts = [f'window.youtubeCatalog = {metadata};',
               (HERE / 'video_viewer_core.js').read_text(encoding='utf-8'),
               (HERE / 'video_graphs.js').read_text(encoding='utf-8'),
               (HERE / 'youtube_player.js').read_text(encoding='utf-8'), js]
    html = replace_once(html, '</body>', '\n'.join('<script>\n' + script.replace('</script', '<\\/script') + '\n</script>' for script in scripts) + '\n</body>')
    output = HERE / 'youtube_graph_viewer.html'
    output.write_text(html, encoding='utf-8')
    return output


if __name__ == '__main__':
    print(f'作成しました: {build()}')
