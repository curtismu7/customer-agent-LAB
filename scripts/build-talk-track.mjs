// Writes docs/talk-track.md from the story data (server/src/data.js). A test fails if the committed file differs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { renderTalkTrackMarkdown } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'docs/talk-track.md'), renderTalkTrackMarkdown(DEFAULT_CAST));
  console.log('wrote docs/talk-track.md');
}
