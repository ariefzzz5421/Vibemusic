import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const musicRoot = resolve(root, 'Music');
const dataRoot = resolve(process.env.VIBE_DATA_DIR || join(root, 'data'));
const uploadsRoot = join(dataRoot, 'uploads');
const artworkRoot = join(dataRoot, 'artwork');
const uploadPrefix = '@uploads/';
mkdirSync(dataRoot, { recursive: true });
mkdirSync(uploadsRoot, { recursive: true });
mkdirSync(artworkRoot, { recursive: true });
const db = new DatabaseSync(join(dataRoot, 'music.sqlite'));
db.exec(`PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60), is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playlist_tracks (playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL, PRIMARY KEY(playlist_id, track_id));
CREATE INDEX IF NOT EXISTS playlist_tracks_order ON playlist_tracks(playlist_id, position);
`);
const trackColumns = new Set(db.prepare('PRAGMA table_info(tracks)').all().map(column => column.name));
if (!trackColumns.has('artwork_path')) db.exec('ALTER TABLE tracks ADD COLUMN artwork_path TEXT');
if (!trackColumns.has('artwork_type')) db.exec('ALTER TABLE tracks ADD COLUMN artwork_type TEXT');
if (!trackColumns.has('artwork_checked')) db.exec('ALTER TABLE tracks ADD COLUMN artwork_checked INTEGER NOT NULL DEFAULT 0');
const now = () => new Date().toISOString();
const defaultPlaylist = db.prepare('SELECT id FROM playlists WHERE is_default = 1').get();
if (!defaultPlaylist) db.prepare('INSERT INTO playlists (id, name, is_default, created_at) VALUES (?, ?, 1, ?)').run('default', 'My Music', now());

function metadata(file, folder) {
  const title = basename(file, extname(file)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = title.split(/\s+-\s+|\s{2,}/, 2).map(s => s.trim());
  const hasArtist = parts.length > 1;
  return { title: hasArtist ? parts[1] : title, artist: hasArtist ? parts[0] : folder || 'Unknown artist' };
}
function syncsafeSize(buffer, offset) {
  if ([0, 1, 2, 3].some(index => buffer[offset + index] > 127)) return -1;
  return (buffer[offset] << 21) | (buffer[offset + 1] << 14) | (buffer[offset + 2] << 7) | buffer[offset + 3];
}
function imageType(data, declared) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) return 'image/gif';
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(declared) ? declared : '';
}
function parseApic(frame, version) {
  if (!frame.length) return null;
  const encoding = frame[0];
  let cursor = 1;
  let mime = '';
  if (version === 2) {
    if (frame.length < 5) return null;
    const format = frame.toString('ascii', 1, 4).toUpperCase();
    mime = format === 'JPG' || format === 'JPEG' ? 'image/jpeg' : format === 'PNG' ? 'image/png' : '';
    cursor = 4;
  } else {
    const mimeEnd = frame.indexOf(0, cursor);
    if (mimeEnd < 0) return null;
    mime = frame.toString('latin1', cursor, mimeEnd).toLowerCase();
    cursor = mimeEnd + 1;
  }
  if (cursor >= frame.length) return null;
  const pictureType = frame[cursor++];
  const step = encoding === 1 || encoding === 2 ? 2 : 1;
  while (cursor + step <= frame.length) {
    if (step === 1 ? frame[cursor] === 0 : frame[cursor] === 0 && frame[cursor + 1] === 0) { cursor += step; break; }
    cursor += step;
  }
  const data = frame.subarray(cursor);
  const type = imageType(data, mime);
  return type && data.length ? { type, data, pictureType } : null;
}
function parseId3Artwork(file) {
  let descriptor;
  try {
    descriptor = openSync(file, 'r');
    const header = Buffer.alloc(10);
    if (readSync(descriptor, header, 0, 10, 0) !== 10 || header.toString('ascii', 0, 3) !== 'ID3') return null;
    const version = header[3];
    if (![2, 3, 4].includes(version)) return null;
    const tagSize = syncsafeSize(header, 6);
    if (tagSize <= 0 || tagSize > 32 * 1024 * 1024 || tagSize + 10 > statSync(file).size) return null;
    const body = Buffer.alloc(tagSize);
    if (readSync(descriptor, body, 0, tagSize, 10) !== tagSize) return null;
    let offset = 0;
    if ((version === 3 || version === 4) && (header[5] & 0x40) && body.length >= 4) {
      const extendedSize = version === 4 ? syncsafeSize(body, 0) : body.readUInt32BE(0);
      if (extendedSize > 0 && extendedSize <= body.length) offset = version === 4 ? extendedSize : extendedSize + 4;
    }
    const pictures = [];
    while (offset < body.length) {
      const headerSize = version === 2 ? 6 : 10;
      if (offset + headerSize > body.length) break;
      const frameId = body.toString('ascii', offset, offset + (version === 2 ? 3 : 4));
      if (!frameId.trim() || frameId[0] === '\0') break;
      const frameSize = version === 2
        ? body.readUIntBE(offset + 3, 3)
        : version === 4 ? syncsafeSize(body, offset + 4) : body.readUInt32BE(offset + 4);
      if (frameSize <= 0 || frameSize > body.length - offset - headerSize) break;
      if ((frameId === 'APIC' && version !== 2) || (frameId === 'PIC' && version === 2)) {
        const picture = parseApic(body.subarray(offset + headerSize, offset + headerSize + frameSize), version);
        if (picture) pictures.push(picture);
      }
      offset += headerSize + frameSize;
    }
    return pictures.find(picture => picture.pictureType === 3) || pictures[0] || null;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
function storeArtwork(file, trackId) {
  const picture = extname(file).toLowerCase() === '.mp3' ? parseId3Artwork(file) : null;
  let artworkPath = null;
  let artworkType = null;
  if (picture) {
    const extension = picture.type === 'image/jpeg' ? 'jpg' : picture.type === 'image/png' ? 'png' : picture.type === 'image/webp' ? 'webp' : 'gif';
    const name = `${trackId}.${extension}`;
    writeFileSync(join(artworkRoot, name), picture.data);
    artworkPath = name;
    artworkType = picture.type;
  }
  db.prepare('UPDATE tracks SET artwork_path = ?, artwork_type = ?, artwork_checked = 1 WHERE id = ?').run(artworkPath, artworkType, trackId);
}
function scanMusic() {
  if (!existsSync(musicRoot)) mkdirSync(musicRoot, { recursive: true });
  const files = [];
  const walk = (dir, base, prefix = '') => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, base, prefix);
      else if (entry.isFile() && ['.mp3', '.wav', '.ogg'].includes(extname(entry.name).toLowerCase())) {
        const rel = relative(base, path).split(sep).join('/');
        files.push({ file: path, rel: `${prefix}${rel}` });
      }
    }
  };
  walk(musicRoot, musicRoot);
  walk(uploadsRoot, uploadsRoot, uploadPrefix);
  const addTrack = db.prepare('INSERT INTO tracks (id, title, artist, relative_path, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(relative_path) DO NOTHING');
  const addDefault = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)');
  const playlistId = db.prepare('SELECT id FROM playlists WHERE is_default = 1').get().id;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
    files.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
    files.forEach(({ file, rel }, index) => {
      const id = Buffer.from(rel).toString('base64url');
      const folder = rel.startsWith(uploadPrefix)
        ? relative(uploadsRoot, file).split(sep).slice(0, -1).at(-1) || 'Uploads'
        : relative(musicRoot, file).split(sep).slice(0, -1).at(-1) || '';
      const info = metadata(file, folder);
      addTrack.run(id, info.title, info.artist, rel, now());
      const row = db.prepare('SELECT id, artwork_checked FROM tracks WHERE relative_path = ?').get(rel);
      if (!row.artwork_checked) storeArtwork(file, row.id);
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

function trackFile(relativePath) {
  const isUpload = relativePath.startsWith(uploadPrefix);
  const base = isUpload ? uploadsRoot : musicRoot;
  const rel = isUpload ? relativePath.slice(uploadPrefix.length) : relativePath;
  const file = resolve(base, ...rel.split('/'));
  return file.startsWith(base + sep) && existsSync(file) ? file : null;
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const readBody = async (req) => { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16_384) throw new Error('Request body is too large.'); } return JSON.parse(raw || '{}'); };
const api = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/tracks') {
      const tracks = db.prepare('SELECT id, title, artist, relative_path, created_at, artwork_path FROM tracks ORDER BY title COLLATE NOCASE').all();
      return json(res, 200, tracks.map(t => ({ ...t, folder: t.relative_path.startsWith(uploadPrefix) ? (t.relative_path.slice(uploadPrefix.length).split('/').slice(0, -1).at(-1) || 'Uploads') : t.relative_path.includes('/') ? t.relative_path.split('/').slice(0, -1).at(-1) : 'Music', audio_url: `/api/tracks/${encodeURIComponent(t.id)}/audio`, artwork_url: t.artwork_path ? `/api/tracks/${encodeURIComponent(t.id)}/artwork` : null })));
    }
    if (req.method === 'POST' && url.pathname === '/api/tracks') {
      const extension = String(url.searchParams.get('extension') || '').toLowerCase();
      if (!['.mp3', '.wav', '.ogg'].includes(extension)) return json(res, 400, { error: 'Choose an MP3, WAV, or OGG audio file.' });
      const title = String(url.searchParams.get('title') || '').trim(); const artist = String(url.searchParams.get('artist') || '').trim();
      if (!title || title.length > 100 || !artist || artist.length > 100) return json(res, 400, { error: 'Title and artist are required (up to 100 characters each).' });
      const size = Number(req.headers['content-length'] || 0);
      if (size > 100 * 1024 * 1024) return json(res, 413, { error: 'Audio files must be smaller than 100 MB.' });
      const filename = `${crypto.randomUUID()}${extension}`; const file = join(uploadsRoot, filename); const rel = `${uploadPrefix}${filename}`;
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
        storeArtwork(file, id);
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
    const artworkMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/artwork$/);
    if (artworkMatch && req.method === 'GET') {
      const track = db.prepare('SELECT artwork_path, artwork_type FROM tracks WHERE id = ?').get(decodeURIComponent(artworkMatch[1]));
      if (!track?.artwork_path) return json(res, 404, { error: 'This track has no embedded cover art.' });
      const file = resolve(artworkRoot, track.artwork_path);
      if (!file.startsWith(artworkRoot + sep) || !existsSync(file)) return json(res, 404, { error: 'Cover art is unavailable.' });
      res.writeHead(200, { 'content-type': track.artwork_type || 'application/octet-stream', 'cache-control': 'public, max-age=86400', 'content-length': statSync(file).size });
      return createReadStream(file).pipe(res);
    }
    const audioMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/audio$/);
    if (audioMatch && req.method === 'GET') {
      const track = db.prepare('SELECT relative_path FROM tracks WHERE id = ?').get(decodeURIComponent(audioMatch[1]));
      if (!track) return json(res, 404, { error: 'Track not found.' });
      const file = trackFile(track.relative_path);
      if (!file) return json(res, 404, { error: 'Audio file is unavailable.' });
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
