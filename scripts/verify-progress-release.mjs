import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const base = 'https://d2-project-management.web.app';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['index.html', 'project-progress.mjs', 'project-progress.css'];
const results = [];
for (const file of files) {
  const response = await fetch(`${base}/${file}`, {cache: 'no-store', signal: AbortSignal.timeout(30000)});
  const live = Buffer.from(await response.arrayBuffer());
  const local = await readFile(new URL(`../${file}`, import.meta.url));
  results.push({file, status: response.status, matchesLocal: hash(live) === hash(local)});
}
const api = await fetch(`${base}/api/progress-reports?projectId=release-check`, {cache: 'no-store', signal: AbortSignal.timeout(30000)});
const portal = await fetch('https://d2-group-system.web.app/module.html', {cache: 'no-store', signal: AbortSignal.timeout(30000)});
const policy = portal.headers.get('permissions-policy') || '';
const report = {files: results, unauthenticatedApiStatus: api.status, portalStatus: portal.status, portalMicrophoneDelegated: policy.includes('microphone=(self "https://d2-project-management.web.app")')};
console.log(JSON.stringify(report));
if (results.some(item => item.status !== 200 || !item.matchesLocal) || api.status !== 401 || portal.status !== 200 || !report.portalMicrophoneDelegated) process.exitCode = 1;
