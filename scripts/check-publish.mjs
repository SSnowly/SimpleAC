import { execFileSync } from 'node:child_process';

const revision = process.argv[2];
const output = revision
  ? execFileSync('git', ['rev-list', '--objects', revision], { encoding: 'utf8' })
  : execFileSync('git', ['ls-files'], { encoding: 'utf8' });
const paths = output
  .trim()
  .split('\n')
  .map((line) => (revision ? line.replace(/^[a-f0-9]+ ?/, '') : line));
const internal =
  /(^|\/)(?:\.agents|\.claude|\.codex|research|notes|plans|decisions)(?:\/|$)|(^|\/)(?:plan\.md|FEATURES\.txt|AGENTS\.md|CLAUDE\.md|GEMINI\.md)$|(?:research|investigation)[^/]*\.md$/i;
const forbidden = [...new Set(paths.filter((path) => internal.test(path)))];
if (forbidden.length > 0) {
  console.error(`Internal files cannot be published:\n${forbidden.join('\n')}`);
  process.exit(1);
}
console.log(`publish: ${revision ? 'history' : 'tracked files'} contain no internal notes`);
