import type { Track } from './types';

export type Playlist = { id: string; name: string; created_at: string; is_default: number; track_ids: string[] };
const storageKey = 'vibe-music.playlists.v1';

export function readPlaylists(tracks: Track[]): Playlist[] {
  const fallback: Playlist[] = [{ id: 'default', name: 'My Music', created_at: '', is_default: 1, track_ids: tracks.map(track => track.id) }];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Playlist[];
    if (!Array.isArray(stored)) return fallback;
    const available = new Set(tracks.map(track => track.id));
    const playlists = stored.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string')
      .map(item => ({ ...item, track_ids: Array.isArray(item.track_ids) ? item.track_ids.filter(id => available.has(id)) : [] }));
    const defaultPlaylist = playlists.find(item => item.id === 'default');
    if (defaultPlaylist) defaultPlaylist.track_ids = tracks.map(track => track.id);
    else playlists.unshift(fallback[0]);
    return playlists;
  } catch { return fallback; }
}

export function savePlaylists(playlists: Playlist[]) {
  try { window.localStorage.setItem(storageKey, JSON.stringify(playlists)); }
  catch { /* Keep the player usable when browser storage is disabled or full. */ }
}
