import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { normalizeTracks } from '../src/race-playlist.js';

const tracks = normalizeTracks({
  tracks: [
    { file: 'track-a.mp3', title: 'A' },
    'track-b.ogg',
    { file: '' },
    null,
  ],
}, 'https://game.example/assets/audio/music/manifest.json');

assert.deepEqual(tracks, [
  { file: 'https://game.example/assets/audio/music/track-a.mp3', title: 'A' },
  { file: 'https://game.example/assets/audio/music/track-b.ogg', title: 'track-b.ogg' },
]);
assert.deepEqual(normalizeTracks({ tracks: 'invalid' }, 'https://game.example/manifest.json'), []);

const manifest = JSON.parse(readFileSync(new URL('../public/assets/audio/music/manifest.json', import.meta.url)));
assert.equal(manifest.tracks.length, 8, 'the shipped playlist should contain the supplied tracks');
for (const track of manifest.tracks) {
  assert.match(track.file, /^track-[a-z0-9-]+\.mp3$/);
  assert.ok(existsSync(new URL(`../public/assets/audio/music/${track.file}`, import.meta.url)), track.file);
}

console.log(JSON.stringify({ manifest: 'ok', relativeUrls: 'ok', shippedTracks: manifest.tracks.length }));
