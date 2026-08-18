// Text Frame — アップデートチェックシステム
//
// 仕組み:
//   1. このページ自身が現在のバージョン（window.APP_VERSION、index.html内で定義）を持っている
//   2. 起動時に update.json を取得し、そこに書かれた最新バージョンと比較する
//   3. 異なっていれば、ページ上部に更新バナーを表示する
//   4. 「更新する」ボタンを押すと、Service Workerのキャッシュを削除してから再読み込みする
//
// update.json の書式:
//   {
//     "version": "1.0.1",
//     "notes": ["変更点1", "変更点2"]
//   }

(function(){
  const CURRENT_VERSION = window.APP_VERSION;
  if(!CURRENT_VERSION){
    console.warn('[TextFrame update] window.APP_VERSION が設定されていません。index.html を確認してください。');
    return;
  }

  const banner = document.getElementById('updateBanner');
  const bannerText = document.getElementById('updateBannerText');
  const updateBtn = document.getElementById('updateBtn');
  const dismissBtn = document.getElementById('updateDismissBtn');

  if(!banner || !bannerText || !updateBtn) return;

  function compareVersions(a, b){
    // シンプルな semver 風比較 (1.2.3 のようなドット区切り数値を想定)
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for(let i = 0; i < len; i++){
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if(na !== nb) return na - nb;
    }
    return 0;
  }

  function showBanner(latestVersion, notes){
    const noteText = Array.isArray(notes) && notes.length
      ? notes.map(n => `・${n}`).join('\n')
      : '';
    bannerText.textContent = `新しいバージョン（v${latestVersion}）が利用可能です`;
    banner.title = noteText;
    if(noteText){
      // ノート一覧を折りたたみ表示するため、専用の要素があれば差し込む
      const notesEl = document.getElementById('updateBannerNotes');
      if(notesEl){
        notesEl.textContent = noteText;
      }
    }
    banner.classList.add('visible');
  }

  async function applyUpdate(){
    updateBtn.disabled = true;
    updateBtn.textContent = '更新中…';
    try {
      // Service Workerのキャッシュを全削除
      if('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }
      // Service Worker自体も一旦登録解除し、次回読み込み時に新しい sw.js を
      // 取得させる（reg.update() だけだとブラウザ側のHTTPキャッシュに
      // 阻まれることがあるため、unregister の方が確実）
      if('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(reg => reg.unregister().catch(() => {})));

        // 登録解除しただけだとページ遷移直後にまだ新しいSWが有効化されて
        // おらず、古いキャッシュ挙動を引きずる（あるいは何も制御していない）
        // 状態でリロードされてしまうことがある。特にiPadOSのホーム画面PWA
        // （standalone表示）でこの傾向が強い。
        // そこでここで明示的に新しい sw.js を再登録し、activate されるまで
        // 待ってからページを再読み込みすることで、リロード後のページが
        // 確実に最新のService Workerに制御された状態で始まるようにする。
        try {
          const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
          const sw = reg.installing || reg.waiting;
          if(sw && sw.state !== 'activated'){
            await new Promise((resolve) => {
              const onChange = () => {
                if(sw.state === 'activated'){
                  sw.removeEventListener('statechange', onChange);
                  resolve();
                }
              };
              sw.addEventListener('statechange', onChange);
              // 念のためのタイムアウト（activateイベントが取れない場合でも
              // 更新処理自体は止めない）
              setTimeout(resolve, 3000);
            });
          }
        } catch(swErr){
          console.warn('[TextFrame update] 新しいService Workerの再登録に失敗しました:', swErr);
        }
      }
    } catch(e){
      console.warn('[TextFrame update] キャッシュ削除中にエラー:', e);
    } finally {
      // キャッシュ削除後、確実に最新版を取得するためクエリを付与して再読み込み
      const url = new URL(window.location.href);
      url.searchParams.set('_v', Date.now().toString());
      window.location.replace(url.toString());
    }
  }

  updateBtn.addEventListener('click', applyUpdate);

  if(dismissBtn){
    dismissBtn.addEventListener('click', () => {
      banner.classList.remove('visible');
    });
  }

  async function checkForUpdate(){
    try {
      const res = await fetch('update.json', { cache: 'no-store' });
      if(!res.ok) return;
      const data = await res.json();
      if(!data || !data.version) return;

      if(compareVersions(data.version, CURRENT_VERSION) > 0){
        showBanner(data.version, data.notes);
      }
    } catch(e){
      // オフライン時などは静かに諦める（オフライン動作を妨げないため）
      console.warn('[TextFrame update] update.json の取得に失敗しました（オフラインの可能性）:', e);
    }
  }

  // ページ読み込み後、少し時間を置いてからチェック（初期描画を優先）
  window.addEventListener('load', () => {
    setTimeout(checkForUpdate, 800);
  });
})();
