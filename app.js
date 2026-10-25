(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { games: [], live: new Map(), search: '', category: 'all', sort: 'featured', syncedAt: null, selectedId: null, lastFocus: null, syncing: false };
  const pretty = new Intl.NumberFormat('en-US');
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const genreName = { story: 'STORY-DRIVEN HORROR', escape: 'ESCAPE & CHASE', psychological: 'PSYCHOLOGICAL HORROR', survival: 'SURVIVAL HORROR', anthology: 'HORROR ANTHOLOGY', extraction: 'EXTRACTION HORROR', supernatural: 'SUPERNATURAL HORROR' };
  const groupName = { horror: 'HORROR', shooter: 'SHOOTERS', movement: 'MOVEMENT', action: 'ACTION & CO-OP', party: 'PARTY & SOCIAL', adventure: 'ADVENTURE', simulation: 'SIMULATION' };
  const categoryFor = game => game.group || 'horror';
  const labelFor = game => game.demo ? 'DEMO' : (game.solo ? 'SOLO' : 'MULTIPLAYER');
  const categoryTextFor = game => categoryFor(game) === 'horror' ? (genreName[game.theme] || 'HORROR') : (groupName[categoryFor(game)] || 'GAMES');

  const compactText = n => Number.isFinite(n) ? compact.format(n) : '—';
  const robloxUrl = game => game.placeId ? `https://www.roblox.com/games/${game.placeId}/` : `https://www.roblox.com/discover/?keyword=${encodeURIComponent(game.title.replace(/\[[^\]]+\]/g, '').trim())}`;
  const localArt = game => game.art ? new URL(`assets/${game.art}`, document.baseURI).href : null;

  function gameImage(game) {
    const item = state.live.get(game.id);
    return item?.image || game.posterUrl || localArt(game);
  }
  function setImage(img, game) {
    img.alt = `${game.title} promotional image`;
    img.loading = 'lazy';
    img.decoding = 'async';
    const candidates = [state.live.get(game.id)?.image, game.posterUrl, localArt(game)]
      .filter((url, index, urls) => url && urls.indexOf(url) === index);
    let index = 0;
    img.onerror = () => {
      index++;
      if (index < candidates.length) img.src = candidates[index];
      else { img.onerror = null; img.hidden = true; }
    };
    if (candidates.length) { img.hidden = false; img.src = candidates[0]; }
    else { img.hidden = true; img.removeAttribute('src'); }
  }

  function selectedGames() {
    const q = state.search.trim().toLowerCase();
    const games = state.games.filter(game => {
      const matchesCategory = state.category === 'all' || categoryFor(game) === state.category || (categoryFor(game) === 'horror' && game.theme === state.category);
      const matchesSearch = !q || [game.title, game.creator, game.theme, categoryFor(game), ...(game.tags || []), ...game.summary].filter(Boolean).join(' ').toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
    games.sort((a, b) => {
      if (state.sort === 'az') return a.title.localeCompare(b.title);
      if (state.sort === 'players') return (state.live.get(b.id)?.players ?? -1) - (state.live.get(a.id)?.players ?? -1);
      if (state.sort === 'rating') return (state.live.get(b.id)?.rating ?? -1) - (state.live.get(a.id)?.rating ?? -1);
      return (Number(b.featured) - Number(a.featured)) || (state.games.indexOf(a) - state.games.indexOf(b));
    });
    return games;
  }

  function createCard(game) {
    const article = document.createElement('article');
    article.className = 'game-card';
    article.dataset.gameId = game.id;
    const poster = document.createElement('div');
    poster.className = 'poster';
    const image = document.createElement('img');
    image.className = 'poster-image';
    setImage(image, game);
    const title = document.createElement('div');
    title.className = 'poster-title';
    title.textContent = game.title;
    const info = document.createElement('button');
    info.className = 'poster-info';
    info.type = 'button';
    info.title = `About ${game.title}`;
    info.setAttribute('aria-label', `Show details for ${game.title}`);
    info.innerHTML = '<svg class="inline-svg" aria-hidden="true"><use href="#i-info"></use></svg>';
    info.addEventListener('click', () => openDetails(game));
    // Poster is also clickable, while the dedicated top-left info action stays explicit.
    poster.addEventListener('click', event => { if (!event.target.closest('button')) openDetails(game); });
    poster.style.cursor = 'pointer';
    poster.append(image, title, info);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const left = document.createElement('div');
    left.className = 'card-meta-left';
    const dot = document.createElement('span'); dot.className = 'multi-dot';
    const multi = document.createElement('span'); multi.className = 'multi-label'; multi.textContent = labelFor(game) + (categoryFor(game) !== 'horror' ? ` · ${groupName[categoryFor(game)]}` : '');
    left.append(dot, multi);
    const creator = document.createElement('span'); creator.className = 'card-creator';
    creator.textContent = `by ${game.creator}`;
    meta.append(left, creator);
    article.append(poster, meta);
    return article;
  }

  function render() {
    const grid = $('game-grid');
    const games = selectedGames();
    const newNodes = games.map(createCard);
    grid.replaceChildren(...newNodes);
    $('result-label').textContent = `SHOWING ${games.length} OF ${state.games.length} EXPERIENCES`;
    $('empty-state').hidden = games.length > 0;
  }

  function formatSyncTime(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return null;
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function syncLabel() {
    const lastSync = state.syncedAt ? new Date(state.syncedAt).getTime() : NaN;
    const age = Number.isFinite(lastSync) ? Date.now() - lastSync : Infinity;
    const delayed = age > 45 * 60 * 1000;
    $('live-indicator').classList.toggle('offline', delayed);
    $('live-status').textContent = delayed ? 'LAST SNAPSHOT IS DELAYED' : 'ROBLOX DATA SYNCED';
    const time = formatSyncTime(state.syncedAt);
    $('update-label').textContent = time ? `LAST ROBLOX SYNC · ${time}` : 'ROBLOX SNAPSHOT · ~15 MIN UPDATES';
  }

  function applyLivePayload(payload) {
    if (!payload || !Array.isArray(payload.games)) return false;
    const valid = payload.games.some(g => g && g.verified);
    if (!valid) return false;
    for (const record of payload.games) if (record?.id) {
      const catalogGame = state.games.find(game => game.id === record.id);
      // A game that was switched to a different Roblox experience must never show
      // the previous experience's description, thumbnail, or statistics.
      if (catalogGame?.universeId && String(record.universeId) !== String(catalogGame.universeId)) continue;
      const previous = state.live.get(record.id);
      state.live.set(record.id, record.verified ? record : (previous || record));
    }
    state.syncedAt = payload.syncedAt || state.syncedAt;
    syncLabel();
    if (payload.partial && $('live-status').textContent === 'ROBLOX DATA SYNCED') {
      $('live-status').textContent = 'PARTIAL ROBLOX DATA';
    }
    render();
    if (state.selectedId) populateDetails(state.games.find(g => g.id === state.selectedId));
    return true;
  }

  async function sync() {
    if (state.syncing || document.hidden) return;
    state.syncing = true;
    try {
      // GitHub Pages serves static JSON. This is not a serverless API endpoint.
      const url = new URL('./data/games.json', document.baseURI);
      url.searchParams.set('t', String(Date.now()));
      const response = await fetch(url.href, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!applyLivePayload(data)) throw Error('No usable Roblox snapshot yet');
    } catch (error) {
      $('live-indicator').classList.add('offline');
      $('live-status').textContent = state.syncedAt ? 'PREVIOUS SNAPSHOT AVAILABLE' : 'WAITING FOR FIRST ROBLOX SYNC';
      $('update-label').textContent = state.syncedAt ? `LAST ROBLOX SYNC · ${formatSyncTime(state.syncedAt)}` : 'RUN THE PAGES WORKFLOW TO SYNC DATA';
      if (state.selectedId) populateDetails(state.games.find(g => g.id === state.selectedId));
    } finally {
      state.syncing = false;
    }
  }

  function populateDetails(game) {
    if (!game) return;
    const live = state.live.get(game.id);
    setImage($('detail-image'), game);
    $('detail-title').textContent = game.title;
    $('detail-creator').textContent = live?.creator || game.creator;
    $('detail-genre').textContent = categoryTextFor(game);
    $('detail-summary').textContent = game.summary.join(' ');
    $('detail-visual-caption').textContent = labelFor(game) + ' / ' + categoryTextFor(game);
    const kicker = document.querySelector('.detail-kicker');
    if (kicker) for (const node of kicker.childNodes) if (node.nodeType === 3 && /MULTIPLAYER|SOLO|DEMO/.test(node.textContent)) node.textContent = ` ${labelFor(game)} `;
    const official = $('detail-description');
    official.classList.toggle('waiting', !live || live.description === null);
    if (!live || typeof live.description !== 'string') {
      official.textContent = game.unverified ? 'Exact Roblox experience has not been verified.' : 'The official Roblox description is temporarily unavailable. Open the game’s Roblox listing to read the creator’s current description.';
    } else if (!live.description.trim()) {
      official.textContent = 'The creator has not provided a public description for this experience.';
    } else {
      official.textContent = live.description; // Always the creator's exact live description, never generated.
    }
    const url = robloxUrl(game);
    $('detail-source').href = url;
    $('detail-source').firstChild.textContent = game.unverified ? 'Find on Roblox ' : 'View on Roblox ';
    $('play-link').href = url;
    $('play-link').firstChild.textContent = game.unverified ? 'Search on Roblox ' : 'Open in Roblox ';
    $('stat-players').textContent = compactText(live?.players);
    $('stat-visits').textContent = compactText(live?.visits);
    $('stat-favorites').textContent = compactText(live?.favorites);
    $('stat-rating').textContent = Number.isFinite(live?.rating) ? `${live.rating}%` : '—';
    $('stat-capacity').textContent = Number.isFinite(live?.maxPlayers) ? `${live.maxPlayers} players` : '—';
    const dt = live?.updated ? new Date(live.updated) : null;
    $('stat-date').textContent = dt && !Number.isNaN(dt.valueOf()) ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    $('detail-updated').textContent = live?.verified ? 'ROBLOX SNAPSHOT' : 'UNAVAILABLE';
    $('stats-disclaimer').textContent = live?.verified
      ? `Data from Roblox public APIs, sampled by GitHub Actions approximately every 15 minutes. Last successful sync: ${formatSyncTime(live?.fetchedAt || state.syncedAt) || 'unknown'}. GitHub schedule delays and Roblox outages may extend this interval.`
      : 'Live statistics are currently unavailable. No values are estimated or invented. You can still open this experience on Roblox.';
  }

  function openDetails(game) {
    state.lastFocus = document.activeElement;
    state.selectedId = game.id;
    populateDetails(game);
    const overlay = $('detail-overlay');
    overlay.hidden = false;
    document.body.classList.add('lock-scroll');
    $('detail-panel').querySelector('.panel-scroll').scrollTop = 0;
    $('detail-close').focus();
    try { history.replaceState(null, '', `#${game.id}`); } catch (_) {}
  }

  function closeDetails() {
    $('detail-overlay').hidden = true;
    document.body.classList.remove('lock-scroll');
    state.selectedId = null;
    if (state.lastFocus?.isConnected) state.lastFocus.focus();
    try { history.replaceState(null, '', '#catalog'); } catch (_) {}
  }

  function wireEvents() {
    $('search').addEventListener('input', e => { state.search = e.target.value; render(); });
    $('category').addEventListener('change', e => { state.category = e.target.value; render(); });
    $('sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
    $('clear-filters').addEventListener('click', () => {
      state.search = ''; state.category = 'all'; state.sort = 'featured';
      $('search').value = ''; $('category').value = 'all'; $('sort').value = 'featured'; render();
    });
    $('detail-close').addEventListener('click', closeDetails);
    $('detail-backdrop').addEventListener('click', closeDetails);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.selectedId) { closeDetails(); return; }
      if (e.key === '/' && !state.selectedId && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault(); $('search').focus();
      }
      if (e.key === 'Tab' && state.selectedId) {
        const focusable = [...$('detail-panel').querySelectorAll('button,a[href]')].filter(el => el.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    window.addEventListener('hashchange', () => {
      const slug = decodeURIComponent(location.hash.slice(1));
      if (state.selectedId && slug !== state.selectedId) closeDetails();
      else if (!state.selectedId) {
        const game = state.games.find(g => g.id === slug);
        if (game) openDetails(game);
      }
    });
  }

  async function init() {
    $('year').textContent = String(new Date().getFullYear());
    wireEvents();
    try {
      const response = await fetch(new URL('./catalog.json', document.baseURI));
      if (!response.ok) throw new Error('Catalog unavailable');
      const catalog = await response.json();
      if (!Array.isArray(catalog)) throw new Error('Invalid catalog');
      state.games = catalog;
      const count = document.querySelector('.hero-aside-number');
      if (count) count.innerHTML = `${catalog.length}<span class="tiny-plus">+</span>`;
      render();
      const hash = decodeURIComponent(location.hash.slice(1));
      const direct = state.games.find(g => g.id === hash);
      if (direct) openDetails(direct);
      sync();
      setInterval(sync, 120000);
    } catch (_) {
      $('live-indicator').classList.add('offline');
      $('live-status').textContent = 'CATALOG UNAVAILABLE';
      $('result-label').textContent = 'UNABLE TO LOAD GAMES';
      $('empty-state').hidden = false;
      $('empty-state').querySelector('p').textContent = 'Please refresh the page or try again shortly.';
    }
  }
  init();
})();
