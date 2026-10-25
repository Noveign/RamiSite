/**
 * RamiMode Hub - GitHub Pages data snapshot generator.
 * Fetches public Roblox API data during GitHub Actions, not in visitors' browsers.
 * Never invents a description or a player count. Preserves the last good value on failure.
 * Requires Node 22+. No API keys, auth cookies or dependencies.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = {
  details: 'https://games.roblox.com/v1/games?universeIds=',
  votes: 'https://games.roblox.com/v1/games/votes?universeIds=',
  thumbnails: 'https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=',
  icons: 'https://thumbnails.roblox.com/v1/games/icons?universeIds=',
};

async function request(url, fetchFn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchFn(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'RamiModeHub/1.1 (public-game-directory)' },
        signal: AbortSignal.timeout(12500),
      });
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status} from ${new URL(url).host}`);
        // 4xx errors other than 429 are not recoverable with retries.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) throw Object.assign(err, { terminal: true });
        throw err;
      }
      const json = await response.json();
      if (!json || typeof json !== 'object') throw new Error('Invalid Roblox JSON response');
      return json;
    } catch (error) {
      lastError = error;
      if (error.terminal || attempt >= maxAttempts) break;
      await new Promise(r => setTimeout(r, attempt * 800));
    }
  }
  throw lastError;
}

function readData(response, label, errors) {
  if (response.status === 'rejected') {
    errors.push(`${label}: ${response.reason?.message || 'unknown error'}`);
    return null;
  }
  return response.value;
}

function asInt(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function asDescription(value) { return typeof value === 'string' ? value : null; }
function asHttpImage(image) {
  return typeof image === 'string' && /^https:\/\//i.test(image) ? image : null;
}
function imageFrom(row) {
  const thumbs = Array.isArray(row?.thumbnails) ? row.thumbnails : [];
  const candidate = thumbs.find(item => item?.state === 'Completed' && item.imageUrl)
    || thumbs.find(item => item?.imageUrl);
  return asHttpImage(candidate?.imageUrl || row?.imageUrl);
}
function idMap(rows, idKey = 'id') {
  return new Map((Array.isArray(rows) ? rows : []).filter(row => row?.[idKey] != null).map(row => [String(row[idKey]), row]));
}

export async function generate({
  fetchFn = fetch,
  catalogPath = 'catalog.json',
  outputPath = 'data/games.json',
  log = console,
} = {}) {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (!Array.isArray(catalog) || !catalog.length) throw new Error('Catalog missing or empty');

  let previous;
  try { previous = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (_) { previous = { games: [], syncedAt: null }; }
  const oldById = idMap(previous.games);
  const errors = [];
  const resolved = await Promise.all(catalog.map(async (game) => {
    let universeId = game.universeId || oldById.get(game.id)?.universeId;
    if (!universeId && game.placeId) {
      try {
        const result = await request(`https://apis.roblox.com/universes/v1/places/${encodeURIComponent(game.placeId)}/universe`, fetchFn);
        universeId = result.universeId || null;
      } catch (error) { errors.push(`place ${game.placeId}: ${error.message}`); }
    }
    return { ...game, universeId: universeId ? String(universeId) : null };
  }));

  const universeIds = [...new Set(resolved.map(g => g.universeId).filter(Boolean))];
  let details, votes, images, icons;
  if (universeIds.length) {
    const ids = universeIds.join(',');
    const results = await Promise.allSettled([
      request(API.details + ids, fetchFn),
      request(API.votes + ids, fetchFn),
      request(API.thumbnails + ids + '&countPerUniverse=1&defaults=true&size=768x432&format=Png', fetchFn),
      request(API.icons + ids + '&size=512x512&format=Png&isCircular=false', fetchFn),
    ]);
    details = readData(results[0], 'experience details', errors);
    votes = readData(results[1], 'ratings', errors);
    images = readData(results[2], 'thumbnails', errors);
    icons = readData(results[3], 'icons', errors);
  }

  const detailById = idMap(details?.data);
  const votesById = idMap(votes?.data);
  const thumbById = idMap(images?.data, 'universeId');
  const iconById = idMap(icons?.data, 'targetId');
  const now = new Date().toISOString();
  let fresh = 0;

  const games = resolved.map(({ id, universeId }) => {
    const old = oldById.get(id) || {};
    const detail = detailById.get(universeId);
    const tally = votesById.get(universeId);
    const up = asInt(tally?.upVotes);
    const down = asInt(tally?.downVotes);
    const image = imageFrom(thumbById.get(universeId)) || imageFrom(iconById.get(universeId));
    const verified = !!detail || !!old.verified;
    if (detail) fresh++;
    // Every value is fetched from Roblox or inherited from a previously verified Roblox snapshot.
    // Null stays null, never becomes 0 unless Roblox actually reports zero.
    const choose = (value, oldValue) => value === null || value === undefined ? (oldValue ?? null) : value;
    const newRating = up !== null && down !== null && up + down > 0 ? Math.round(up * 100 / (up + down)) : null;
    return {
      id, universeId,
      title: choose(asDescription(detail?.name), old.title),
      description: choose(asDescription(detail?.description), old.description),
      creator: choose(asDescription(detail?.creator?.name), old.creator),
      players: choose(asInt(detail?.playing), old.players),
      visits: choose(asInt(detail?.visits), old.visits),
      favorites: choose(asInt(detail?.favoritedCount), old.favorites),
      maxPlayers: choose(asInt(detail?.maxPlayers), old.maxPlayers),
      rating: choose(newRating, old.rating),
      upvotes: choose(up, old.upvotes),
      downvotes: choose(down, old.downvotes),
      updated: choose(asDescription(detail?.updated), old.updated),
      image: image || old.image || null,
      verified,
      fetchedAt: detail ? now : (old.fetchedAt || null),
    };
  });

  // Retain the previous sync time if Roblox's details endpoint failed entirely.
  const syncedAt = fresh ? now : (previous.syncedAt || null);
  const snapshot = {
    games,
    syncedAt,
    partial: fresh !== games.length || errors.length > 0,
    source: 'Roblox public APIs',
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  log.info(`RamiMode Hub: verified ${fresh}/${games.length} fresh game records (${games.filter(g => g.verified).length} total usable).`);
  if (errors.length) log.warn(`Roblox API issues: ${errors.join('; ')}`);
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generate().catch(err => { console.error(err); process.exitCode = 1; });
}
