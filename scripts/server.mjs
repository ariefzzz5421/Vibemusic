import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const musicRoot = resolve(root, 'Music');
const dataRoot = resolve(root, 'data');
mkdirSync(dataRoot, { recursive: true });
const db = new DatabaseSync(join(dataRoot, 'music.sqlite'));
db.exec(`PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playlist_tracks (playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL, PRIMARY KEY(playlist_id, track_id));
CREATE INDEX IF NOT EXISTS playlist_tracks_order ON playlist_tracks(playlist_id, position);
`);
const now = () => new Date().toISOString();
const defaultPlaylist = db.prepare('SELECT id FROM playlists WHERE is_default = 1').get();
if (!defaultPlaylist) db.prepare('INSERT INTO playlists (id, name, is_default, created_at) VALUES (?, ?, 1, ?)').run('default', 'My Music', now());

function metadata(file, folder) {
  const title = basename(file, extname(file)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = title.split(/\s+-\s+|\s{2,}/, 2).map(s => s.trim());
  const hasArtist = parts.length > 1;
  return { title: hasArtist ? parts[1] : title, artist: hasArtist ? parts[0] : folder || 'Unknown artist' };
}
function scanMusic() {
  if (!existsSync(musicRoot)) mkdirSync(musicRoot, { recursive: true });
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && ['.mp3', '.wav', '.ogg'].includes(extname(entry.name).toLowerCase())) files.push(path);
    }
  };
  walk(musicRoot);
  const addTrack = db.prepare('INSERT INTO tracks (id, title, artist, relative_path, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(relative_path) DO NOTHING');
  const addDefault = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)');
  const playlistId = db.prepare('SELECT id FROM playlists WHERE is_default = 1').get().id;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
    files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    files.forEach((file, index) => {
      const rel = relative(musicRoot, file).split(sep).join('/');
      const id = Buffer.from(rel).toString('base64url');
      const folder = relative(musicRoot, file).split(sep).slice(0, -1).at(-1) || '';
      const info = metadata(file, folder);
      addTrack.run(id, info.title, info.artist, rel, now());
      const row = db.prepare('SELECT id FROM tracks WHERE relative_path = ?').get(rel);
      addDefault.run(playlistId, row.id, index, now());
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return files.length;
}
scanMusic();

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const readBody = async (req) => { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16_384) throw new Error('Request body is too large.'); } return JSON.parse(raw || '{}'); };
const api = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/tracks') {
      const tracks = db.prepare('SELECT id, title, artist, relative_path, created_at FROM tracks ORDER BY title COLLATE NOCASE').all();
      return json(res, 200, tracks.map(t => ({ ...t, folder: t.relative_path.includes('/') ? t.relative_path.split('/').slice(0, -1).at(-1) : 'Music', audio_url: `/api/tracks/${encodeURIComponent(t.id)}/audio` })));
    }
    if (req.method === 'POST' && url.pathname === '/api/tracks') {
      const extension = String(url.searchParams.get('extension') || '').toLowerCase();
      if (!['.mp3', '.wav', '.ogg'].includes(extension)) return json(res, 400, { error: 'Choose an MP3, WAV, or OGG audio file.' });
      const title = String(url.searchParams.get('title') || '').trim(); const artist = String(url.searchParams.get('artist') || '').trim();
      if (!title || title.length > 100 || !artist || artist.length > 100) return json(res, 400, { error: 'Title and artist are required (up to 100 characters each).' });
      const size = Number(req.headers['content-length'] || 0);
      if (size > 100 * 1024 * 1024) return json(res, 413, { error: 'Audio files must be smaller than 100 MB.' });
      const importedRoot = join(musicRoot, 'Imported'); mkdirSync(importedRoot, { recursive: true });
      const filename = `${crypto.randomUUID()}${extension}`; const file = join(importedRoot, filename); const rel = `Imported/${filename}`;
      try {
        await pipeline(req, createWriteStream(file, { flags: 'wx' }));
        const id = Buffer.from(rel).toString('base64url'); const timestamp = now();
        const playlistId = db.prepare('SELECT id FROM playlists WHERE is_default = 1').get().id;
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT INTO tracks (id, title, artist, relative_path, created_at) VALUES (?, ?, ?, ?, ?)').run(id, title, artist, rel, timestamp);
          const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?').get(playlistId).next;
          db.prepare('INSERT INTO playlist_tracks(playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)').run(playlistId, id, position, timestamp);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 201, { id, title, artist, relative_path: rel });
      } catch (error) { if (existsSync(file)) await unlink(file); throw error; }
    }
    if (req.method === 'POST' && url.pathname === '/api/scan') return json(res, 200, { scanned: scanMusic() });
    if (req.method === 'GET' && url.pathname === '/api/playlists') {
      const rows = db.prepare('SELECT id, name, created_at, is_default FROM playlists ORDER BY is_default DESC, created_at').all();
      return json(res, 200, rows.map(p => ({ ...p, track_ids: db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, added_at').all(p.id).map(x => x.track_id) })));
    }
    if (req.method === 'POST' && url.pathname === '/api/playlists') {
      const body = await readBody(req); const name = String(body.name || '').trim();
      if (!name || name.length > 60) return json(res, 400, { error: 'Playlist name must be 1 to 60 characters.' });
      const id = crypto.randomUUID(); db.prepare('INSERT INTO playlists(id, name, created_at) VALUES (?, ?, ?)').run(id, name, now());
      return json(res, 201, { id, name, created_at: now(), is_default: 0, track_ids: [] });
    }
    const playlistMatch = url.pathname.match(/^\/api\/playlists\/([^/]+)$/);
    if (playlistMatch && req.method === 'PATCH') {
      const id = decodeURIComponent(playlistMatch[1]); const body = await readBody(req); const name = String(body.name || '').trim();
      if (!name || name.length > 60) return json(res, 400, { error: 'Playlist name must be 1 to 60 characters.' });
      const result = db.prepare('UPDATE playlists SET name = ? WHERE id = ? AND is_default = 0').run(name, id);
      return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Playlist not found or is the default playlist.' });
    }
    if (playlistMatch && req.method === 'DELETE') {
      const result = db.prepare('DELETE FROM playlists WHERE id = ? AND is_default = 0').run(decodeURIComponent(playlistMatch[1]));
      return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Playlist not found or is the default playlist.' });
    }
    const entryMatch = url.pathname.match(/^\/api\/playlists\/([^/]+)\/tracks\/([^/]+)$/);
    if (entryMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
      const playlistId = decodeURIComponent(entryMatch[1]); const trackId = decodeURIComponent(entryMatch[2]);
      if (req.method === 'PUT') {
        if (!db.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId) || !db.prepare('SELECT id FROM tracks WHERE id = ?').get(trackId)) return json(res, 404, { error: 'Playlist or track not found.' });
        const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?').get(playlistId).next;
        db.prepare('INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)').run(playlistId, trackId, position, now());
      } else db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId);
      return json(res, 200, { ok: true });
    }
    const audioMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/audio$/);
    if (audioMatch && req.method === 'GET') {
      const track = db.prepare('SELECT relative_path FROM tracks WHERE id = ?').get(decodeURIComponent(audioMatch[1]));
      if (!track) return json(res, 404, { error: 'Track not found.' });
      const file = resolve(musicRoot, ...track.relative_path.split('/'));
      if (!file.startsWith(musicRoot + sep) || !existsSync(file)) return json(res, 404, { error: 'Audio file is unavailable.' });
      const size = statSync(file).size; const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
      if (range) {
        const start = Number(range[1] || 0); const end = Math.min(Number(range[2] || size - 1), size - 1);
        if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
        const type = ({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' })[extname(file).toLowerCase()] || 'application/octet-stream';
        res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
        return createReadStream(file, { start, end }).pipe(res);
      }
      const type = ({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' })[extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size }); return createReadStream(file).pipe(res);
    }
    if (!url.pathname.startsWith('/api/')) {
      const dist = resolve(root, 'dist');
      if (!existsSync(dist)) return json(res, 404, { error: 'Build the frontend first with npm run build.' });
      let requested;
      try { requested = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Invalid URL path.' }); }
      let file = resolve(dist, `.${requested === '/' ? '/index.html' : requested}`);
      if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html');
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'content-length': statSync(file).size });
      return createReadStream(file).pipe(res);
    }
    return json(res, 404, { error: 'Route not found.' });
  } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : 'Request failed.' }); }
});
const port = Number(process.env.API_PORT || 3001);
api.listen(port, '127.0.0.1', () => console.log(`Vibe Music SQLite API listening on http://127.0.0.1:${port}`));
process.on('SIGINT', () => { db.close(); api.close(() => process.exit(0)); });
process.on('SIGTERM', () => { db.close(); api.close(() => process.exit(0)); });
