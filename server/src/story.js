import { fillDeep, VERTICALS, verticalList } from './cast.js';
import { rawStory, SOURCE_LABEL } from './data.js';
import { MANIFEST } from './manifest.js';

// The story with the cast filled in. Labels stay as templates for the engine's own extra tokens (castOutcome and the rest).
export function buildStory(cast, vertical) {
  const s = fillDeep({ ...rawStory(), labels: undefined }, cast);
  return {
    title: s.title, banner: s.banner, talkTrack: s.talkTrack, why: s.why, notDemonstrated: s.notDemonstrated, sourceLabel: SOURCE_LABEL,
    source: MANIFEST.source, counts: MANIFEST.meta.counts, total: MANIFEST.meta.total, cast, vertical, verticals: verticalList(), fullVerticals: Object.keys(VERTICALS),
  };
}

// docs/talk-track.md is generated from the same data the UI reads (`npm run talk-track`); a test fails if they drift.
export function renderTalkTrackMarkdown(cast) {
  const s = buildStory(cast, 'banking');
  const parts = ['# Talk track', '', '<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->', '', `> SIMULATED. ${s.banner.mock}`, ''];
  for (const t of s.talkTrack) parts.push(`## ${t.title}`, '', t.say, '');
  parts.push('## Not demonstrated', '');
  for (const n of s.notDemonstrated) parts.push(`- ${n}`);
  return `${parts.join('\n')}\n`;
}
