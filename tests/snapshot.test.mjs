import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../scripts/update-games.mjs';

const catalog = [
  { id: 'a', placeId: '1234', universeId: '22' },
  { id: 'b', placeId: '5678', universeId: null },
];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'ramimode-test-'));
  const catalogPath = join(dir, 'catalog.json');
  const outputPath = join(dir, 'data', 'games.json');
  await writeFile(catalogPath, JSON.stringify(catalog));
  return { catalogPath, outputPath, log: { info() {}, warn() {} } };
}
function mockFetch({ blocked = false, partial = false } = {}) {
  return async (url) => {
    const text = String(url);
    if (blocked || (partial && text.includes('/v1/games?'))) return { ok: false, status: 403 };
    let data;
    if (text.includes('/places/5678/universe')) data = { universeId: 33 };
    else if (text.includes('/v1/games?')) data = { data: [
      { id: 22, name: 'Game A', description: 'The genuine creator text.', creator: { name: 'Creator A' }, playing: 0, visits: 100, favoritedCount: 15, maxPlayers: 8, updated: '2026-10-01T00:00:00Z' },
      { id: 33, name: 'Game B', description: 'Other creator description.', creator: { name: 'Creator B' }, playing: 31, visits: 300, favoritedCount: 21, maxPlayers: 5, updated: '2026-10-02T00:00:00Z' },
    ] };
    else if (text.includes('/games/votes')) data = { data: [{ id: 22, upVotes: 9, downVotes: 1 }, { id: 33, upVotes: 0, downVotes: 0 }] };
    else if (text.includes('/multiget/thumbnails')) data = { data: [{ universeId: 22, thumbnails: [{ state: 'Completed', imageUrl: 'https://cdn.example/a.png' }] }] };
    else if (text.includes('/games/icons')) data = { data: [{ targetId: 33, imageUrl: 'https://cdn.example/b.png' }] };
    else throw new Error('Unexpected mock URL: ' + text);
    return { ok: true, json: async () => data };
  };
}

test('writes creator descriptions, zero player count, images, ratings, and a successful timestamp', async () => {
  const options = await setup();
  const result = await generate({ ...options, fetchFn: mockFetch() });
  assert.equal(result.games.length, 2);
  assert.equal(result.games[0].description, 'The genuine creator text.');
  assert.equal(result.games[0].players, 0);
  assert.equal(result.games[0].rating, 90);
  assert.equal(result.games[0].image, 'https://cdn.example/a.png');
  assert.equal(result.games[1].image, 'https://cdn.example/b.png');
  assert.equal(result.games[1].universeId, '33');
  assert.equal(result.games[1].rating, null);
  assert.equal(result.partial, false);
  assert.ok(!Number.isNaN(new Date(result.syncedAt).getTime()));
  const saved = JSON.parse(await readFile(options.outputPath, 'utf8'));
  assert.equal(saved.games[0].description, result.games[0].description);
});

test('preserves cached Roblox descriptions and stats on temporary outages with an unchanged sync timestamp', async () => {
  const options = await setup();
  const first = await generate({ ...options, fetchFn: mockFetch() });
  const second = await generate({ ...options, fetchFn: mockFetch({ blocked: true }) });
  assert.equal(second.syncedAt, first.syncedAt);
  assert.equal(second.games[0].description, 'The genuine creator text.');
  assert.equal(second.games[0].players, 0);
  assert.equal(second.games[1].universeId, '33');
  assert.equal(second.partial, true);
});

test('does not invent information on a first-run Roblox API outage', async () => {
  const options = await setup();
  const snapshot = await generate({ ...options, fetchFn: mockFetch({ blocked: true }) });
  assert.equal(snapshot.syncedAt, null);
  assert.equal(snapshot.games[0].description, null);
  assert.equal(snapshot.games[0].players, null);
  assert.equal(snapshot.games[0].verified, false);
  assert.equal(snapshot.games[1].universeId, null);
});
