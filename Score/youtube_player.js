'use strict';
// Adapt YouTube's IFrame API to the existing viewer's video interface.
window.youtubeVideo = new class extends EventTarget {
  constructor() {
    super();
    this.player = null;
    this.ready = false;
    this.id = null;
    this.rate = 1;
    this.src = '';
    setInterval(() => {
      if (this.ready) this.dispatchEvent(new Event('timeupdate'));
    }, 100);
  }
  get currentTime() { return this.ready ? this.player.getCurrentTime() || 0 : 0; }
  set currentTime(time) {
    if (this.ready) this.player.seekTo(time, true);
  }
  get duration() { return this.ready ? this.player.getDuration() || NaN : NaN; }
  get paused() { return !this.ready || this.player.getPlayerState() !== 1; }
  get playbackRate() { return this.rate; }
  set playbackRate(rate) {
    this.rate = rate;
    if (this.ready) this.player.setPlaybackRate(rate);
  }
  pause() { if (this.ready) this.player.pauseVideo(); }
  removeAttribute() { this.src = ''; }
  load() {
    const name = decodeURIComponent(this.src).split('/').at(-1).replace(/\.mp4$/i, '');
    // Match from the end: both genre names and video IDs can contain underscores.
    const id = name.match(/(?:^|_)([A-Za-z0-9_-]{11})$/)?.[1];
    this.id = id || null;
    const link = document.getElementById('youtube-link');
    link.hidden = !id;
    if (id) link.href = 'https://www.youtube.com/watch?v=' + id;
    else link.removeAttribute('href');
    const hint = document.getElementById('youtube-status');
    hint.textContent = id ? '埋め込みで再生できない場合は「YouTubeで開く」を使用してください。' :
      '動画名は「ジャンル名_11文字のYouTube動画ID」で指定してください。';
    if (this.player) { this.player.destroy(); this.player = null; }
    this.ready = false;
    const host = document.getElementById('youtube-host');
    host.replaceChildren();
    const target = document.createElement('div'); target.id = 'youtube-player'; host.append(target);
    this.mount();
  }
  mount() {
    if (!this.id || !window.YT?.Player || this.player) return;
    if (location.protocol === 'file:') {
      document.getElementById('youtube-status').textContent =
        '埋め込み再生と同期にはローカルサーバーが必要です。python3 Score/serve_viewer.py を起動し、http://127.0.0.1:8000/Score/youtube_graph_viewer.html を開いてください。YouTubeリンクはそのまま使えます。';
      return;
    }
    this.player = new YT.Player('youtube-player', {
      videoId: this.id,
      playerVars: {origin: location.origin, playsinline: 1, rel: 0},
      events: {
        onReady: () => {
          this.ready = true;
          this.playbackRate = this.rate;
          this.dispatchEvent(new Event('loadedmetadata'));
        },
        onStateChange: () => this.dispatchEvent(new Event('timeupdate')),
        onError: event => {
          const reasons = {
            2: '動画IDが不正です。動画ファイル名を確認してください。',
            5: 'ブラウザのプレーヤーで再生できません。',
            100: '動画が削除されたか、非公開になっている可能性があります。',
            101: '動画の所有者が外部サイトでの埋め込み再生を許可していません。この制限はビューア側では解除できません。',
            150: '動画の所有者が外部サイトでの埋め込み再生を許可していません。この制限はビューア側では解除できません。',
            153: 'YouTubeに参照元を送信できません。ローカルサーバー経由で開き、ブラウザの参照元設定を確認してください。',
          };
          document.getElementById('youtube-status').textContent =
            `YouTube埋め込み再生エラー (${event.data})。${reasons[event.data] || '埋め込み動画を再生できません。'}「YouTubeで開く」から視聴してください。別タブの再生時刻は同期されません。`;
        },
      },
    });
  }
}();
window.onYouTubeIframeAPIReady = () => window.youtubeVideo.mount();
const youtubeScript = document.createElement('script');
youtubeScript.src = 'https://www.youtube.com/iframe_api';
youtubeScript.onerror = () => {
  document.getElementById('youtube-status').textContent = 'YouTubeプレーヤーを取得できません。「YouTubeで開く」を使用してください。';
};
document.head.append(youtubeScript);
