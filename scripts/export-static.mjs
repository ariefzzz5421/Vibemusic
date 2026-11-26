import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const musicRoot = join(root, 'Music');
const dataRoot = join(root, 'data');
const publicDir = join(root, 'public');
const staticAudioDir = join(publicDir, 'static-audio');
const staticArtworkDir = join(publicDir, 'static-artwork');

rmSync(staticAudioDir, { recursive: true, force: true });
rmSync(staticArtworkDir, { recursive: true, force: true });
mkdirSync(staticAudioDir, { recursive: true });
mkdirSync(staticArtworkDir, { recursive: true });

const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.webm']);
let tracks = [];
let playlists = [];

function parseMeta(file, folder) {
  const clean = basename(file, extname(file)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = clean.split(/\s+-\s+|\s{2,}/, 2).map(s => s.trim());
  const hasArtist = parts.length > 1;
  return {
    title: hasArtist ? parts[1] : clean,
    artist: hasArtist ? parts[0] : folder || 'Unknown artist',
  };
}

let usedSqlite = false;
try {
  const dbPath = join(dataRoot, 'music.sqlite');
  if (existsSync(dbPath)) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { open: true });
    const rows = db.prepare('SELECT * FROM tracks ORDER BY created_at DESC').all();
    for (const r of rows) {
      const isUpload = String(r.relative_path).startsWith('@uploads/');
      const rel = isUpload ? String(r.relative_path).slice('@uploads/'.length) : String(r.relative_path);
      const srcFile = isUpload ? join(dataRoot, 'uploads', rel) : join(musicRoot, rel);
      if (!existsSync(srcFile)) continue;

      const destRel = (isUpload ? `uploads/${rel}` : rel).replace(/\\/g, '/');
      const destFile = join(staticAudioDir, destRel);
      mkdirSync(join(destFile, '..'), { recursive: true });
      cpSync(srcFile, destFile);

      let artworkUrl = null;
      if (r.artwork_path) {
        const artSrc = join(dataRoot, 'artwork', basename(String(r.artwork_path)));
        if (existsSync(artSrc)) {
          const artName = basename(artSrc);
          cpSync(artSrc, join(staticArtworkDir, artName));
          artworkUrl = `/static-artwork/${encodeURIComponent(artName)}`;
        }
      }

      const folderName = isUpload ? 'Uploads' : (rel.includes('/') || rel.includes('\\') ? rel.split(/[/\\]/)[0] : 'Music');
      tracks.push({
        id: String(r.id),
        title: String(r.title),
        artist: String(r.artist),
        audio_url: `/static-audio/${destRel.split('/').map(encodeURIComponent).join('/')}`,
        artwork_url: artworkUrl,
        created_at: String(r.created_at),
        folder: folderName,
      });
    }

    const plRows = db.prepare('SELECT * FROM playlists ORDER BY is_default DESC, created_at ASC').all();
    const ptStmt = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC');
    for (const p of plRows) {
      const ids = ptStmt.all(p.id).map(x => String(x.track_id));
      playlists.push({
        id: String(p.id),
        name: String(p.name),
        created_at: String(p.created_at),
        is_default: Number(p.is_default || 0),
        track_ids: ids,
      });
    }
    usedSqlite = tracks.length > 0;
  }
} catch (err) {
  console.log('Fallback to scanning Music directory:', err.message);
}

if (!usedSqlite && existsSync(musicRoot)) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (AUDIO_EXT.has(extname(entry).toLowerCase())) {
        const rel = relative(musicRoot, full).replace(/\\/g, '/');
        const destFile = join(staticAudioDir, rel);
        mkdirSync(join(destFile, '..'), { recursive: true });
        cpSync(full, destFile);
        const folderName = rel.includes('/') ? rel.split('/')[0] : 'Music';
        const meta = parseMeta(entry, folderName);
        tracks.push({
          id: Buffer.from(rel).toString('base64url'),
          title: meta.title,
          artist: meta.artist,
          audio_url: `/static-audio/${rel.split('/').map(encodeURIComponent).join('/')}`,
          artwork_url: null,
          created_at: st.mtime.toISOString(),
          folder: folderName,
        });
      }
    }
  };
  walk(musicRoot);
}

if (!playlists.length) {
  playlists = [{
    id: 'default',
    name: 'My Music',
    created_at: new Date().toISOString(),
    is_default: 1,
    track_ids: tracks.map(t => t.id),
  }];
}

writeFileSync(join(publicDir, 'static-tracks.json'), JSON.stringify(tracks, null, 2));
writeFileSync(join(publicDir, 'static-playlists.json'), JSON.stringify(playlists, null, 2));
console.log(`Exported ${tracks.length} tracks and ${playlists.length} playlists for static deployment.`);
