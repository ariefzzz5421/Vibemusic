import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';

const root = process.cwd();
const musicRoot = join(root, 'public', 'Music');
const output = join(root, 'src', 'data', 'catalog.json');
const supported = new Set(['.mp3', '.wav', '.ogg']);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && supported.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

const files = (await walk(musicRoot)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const tracks = files.map(file => {
  const path = relative(musicRoot, file).split(sep).join('/');
  const rawTitle = basename(file, extname(file)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = rawTitle.split(/\s+-\s+|\s{2,}/, 2).map(value => value.trim());
  const folder = path.includes('/') ? path.split('/').at(-2) : 'Music';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return {
    id: path,
    title: parts.length > 1 ? parts[1] : rawTitle,
    artist: parts.length > 1 ? parts[0] : folder || 'Unknown artist',
    folder,
    audio_url: `/Music/${encodedPath}`,
  };
});

await mkdir(join(root, 'src', 'data'), { recursive: true });
await writeFile(output, `${JSON.stringify(tracks, null, 2)}\n`, 'utf8');
console.log(`Wrote ${tracks.length} tracks to ${relative(root, output)}`);
