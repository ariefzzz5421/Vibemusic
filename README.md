# Vibe Music

A local music player for the audio files in `Music/`. On first start, the Node backend scans MP3, WAV, and OGG files recursively, records their metadata and paths in SQLite, and adds them to the default **My Music** playlist. Audio files stay in `Music/`; they are streamed by the backend and never copied into the database.

## Requirements

- Node.js 24 or newer (`node:sqlite` is built into Node)
- npm

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:5173` for the landing page or `http://app.localhost:5173` for the player dashboard. The dev command starts both the Vite frontend and the SQLite API. The SQLite file is created at `data/music.sqlite` on first run.

To build and run the production app locally:

```powershell
npm.cmd run build
npm.cmd start
```

Then open `http://localhost:3001` for the landing page or `http://app.localhost:3001` for the player dashboard.

## Music and playlists

- Add audio files to `Music/` (subfolders are scanned too), then use **Scan Music folder** in the app. New files are added to **My Music** automatically.
- Use **Add music** to import one MP3, WAV, or OGG file from your computer. It is copied to `Music/Imported/`, and its title and artist are saved in SQLite. Maximum file size: 100 MB.
- Create playlists and add or remove tracks from them in the app. Playlist membership and names persist in SQLite.
- The default playlist contains the whole local collection and cannot be renamed or deleted.
- Rename or move a music file outside the app, then scan again. Existing database entries are retained so custom playlists remain stable; unavailable files show an error when played.
- The database stores file paths and playlist metadata, not copies of the audio.

## Notes

- This is a local, single-user app. The API binds to `127.0.0.1` and has no public authentication layer.
- SQLite is provided by Node's built-in `node:sqlite` module, so no external database service or native package install is needed.
- Music folder metadata is inferred from filenames. Names containing `Artist - Title` are split; otherwise the parent folder is used as the artist when available.
