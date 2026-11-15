# Vibe Music

Vibe Music is a static Vite music player. The landing page is `/`, and the player is `/player` on the same domain. Audio files ship as public Vercel assets; there is no runtime Node API or SQLite dependency.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/` or `http://127.0.0.1:5173/player`. To serve a production build locally, run `npm.cmd run build` followed by `npm.cmd start`.

## Music catalog

- Commit MP3, WAV, or OGG files under `public/Music/`. Nested folders and spaces in filenames are supported.
- After adding or removing files, run `npm.cmd run catalog` to regenerate `src/data/catalog.json`.
- The build runs that generator automatically before TypeScript and Vite, so a normal `npm run build` also refreshes the manifest.
- Commit both the audio files and the generated manifest. Vercel serves the committed files at `/Music/...` after the next deployment.
- The catalog does not scan arbitrary deployment folders at runtime. The **Catalog guide** in the player explains this repository update flow.

Track title and artist are inferred from filenames: `Artist - Title.mp3` is split at the separator; otherwise the containing folder is used as the artist. Playlist membership, names, shuffle, repeat, and splash preferences are saved in this browser's local storage. They do not sync to another browser, device, or user. Clearing browser storage removes those playlists.

## Build and deploy

```powershell
npm.cmd run build
npm.cmd start
```

Vercel uses `npm run build` and serves `dist/` as a static Vite app. `vercel.json` records those settings and routes `/player` to the app shell. The existing production domain is `https://vibe-music-git.vercel.app`.

## Repository size notes

The checked-in audio catalog is about 193 MB across 51 files. The current files are all below 10 MB each. GitHub warns for files over 50 MiB and blocks individual files over 100 MiB. This repository uses ordinary Git files, not Git LFS; LFS would need a separate Vercel build/deployment setup and is not configured here. Vercel's documented 100 MB Hobby limit applies to source files uploaded through the CLI; this project is connected to Git, so that CLI upload limit is not the build path. Keep individual committed tracks below GitHub's hard limit and account for the full catalog in clone and deployment sizes.
