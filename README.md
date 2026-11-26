# Vibe Music

A single-user, server-backed music player. The Node backend scans MP3, WAV, and OGG files in `Music/`, records their metadata in SQLite, and adds them to the default **My Music** playlist. Audio is streamed through the server; browser storage is not used for music files. Files added with **Add music** are saved under the server data directory in `uploads/`, and playlist names and membership are saved in SQLite.

## Requirements

- Node.js 24 or newer (`node:sqlite` is built into Node)
- npm

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:5173` for the music library and player. The dev command starts both the Vite frontend and the SQLite API. The server data directory defaults to `data/`. It contains `music.sqlite`, uploaded audio in `uploads/`, and cached embedded cover art in `artwork/`. Set `VIBE_DATA_DIR` to a persistent server volume when hosting so uploaded music, cover art, and playlists survive application updates.

To build and run the production app locally:

```powershell
npm.cmd run build
npm.cmd start
```

Then open `http://localhost:3001` for the music library and player.

## Music and playlists

- Add audio files to `Music/` (subfolders are scanned too), then use **Scan Music folder** in the app. New files are added to **My Music** automatically.
- Use **Add music** to upload one MP3, WAV, or OGG file. The server saves it in its configured `uploads/` storage and streams playback from there. Its title, artist, and playlist membership are stored in SQLite. Maximum file size: 100 MB.
- Create playlists and add or remove tracks from them in the app. Playlist membership and names persist in SQLite.
- The default playlist contains the whole server library and cannot be renamed or deleted.
- The API reads embedded ID3 cover art from MP3 files and caches the image in the server data directory. Files without embedded art use the built-in Vibe cover.
- Songs already in `Music/` remain part of the server's app library. Use **Scan Music folder** after adding files to that server folder.

## Notes

- This checkout is a local, single-user app. The API binds to `127.0.0.1` and has no account or public authentication layer, so it is not ready to expose as a shared multi-user site.
- Hosting requires a persistent volume configured with `VIBE_DATA_DIR` and an authentication layer before opening the API to other users. `VIBE_DATA_DIR` moves server storage; it does not turn this local-only app into a cloud service on its own.
- SQLite is provided by Node's built-in `node:sqlite` module, so no external database service or native package install is needed.
- Music folder metadata is inferred from filenames. Names containing `Artist - Title` are split; otherwise the parent folder is used as the artist when available.
