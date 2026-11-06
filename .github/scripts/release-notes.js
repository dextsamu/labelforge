'use strict';

// Genera il testo della Release GitHub per un tag (usato da .github/workflows/build.yml).
// Ordine di ricerca:
//   1. release-notes/<tag>.md          (note scritte a mano, es. release-notes/v1.19.0.md)
//   2. la sezione "## <tag>" del CHANGELOG.md
// In fondo aggiunge release-notes/_footer.md (download, avvertenze), se esiste.
// Uso: node .github/scripts/release-notes.js v1.19.0 > RELEASE_NOTES.md

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null);

function changelogSection(version) {
  const log = read(path.join(root, 'CHANGELOG.md'));
  if (!log) return null;
  const lines = log.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]); i++) out.push(lines[i]);
  return out.join('\n').trim() || null;
}

const body = read(path.join(root, 'release-notes', `${tag}.md`)) || changelogSection(tag) || `LabelForge ${tag}`;
const footer = read(path.join(root, 'release-notes', '_footer.md'));
process.stdout.write(body.trim() + (footer ? '\n\n' + footer.trim() : '') + '\n');
