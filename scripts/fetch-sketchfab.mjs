#!/usr/bin/env node
/**
 * Sketchfab 모델 다운로드 (glTF) → public/models/<name>/
 *
 *   SKETCHFAB_TOKEN=... node scripts/fetch-sketchfab.mjs <name> <uid> [...]
 *   (토큰은 환경변수 또는 ~/.sketchfab_token 파일)
 *
 * 다운로드 후 public/models/CREDITS.md 에 CC-BY 출처를 추가한다.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const token = process.env.SKETCHFAB_TOKEN || (existsSync(join(homedir(), '.sketchfab_token')) ? readFileSync(join(homedir(), '.sketchfab_token'), 'utf8').trim() : '');
if (!token) {
  console.error('SKETCHFAB_TOKEN 없음');
  process.exit(1);
}
const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) {
  console.error('usage: fetch-sketchfab.mjs <name> <uid> [<name> <uid> ...]');
  process.exit(1);
}
const root = join(process.cwd(), 'public', 'models');
mkdirSync(root, { recursive: true });
const credits = join(root, 'CREDITS.md');
if (!existsSync(credits)) writeFileSync(credits, '# 3D 모델 출처\n\n모두 Creative Commons Attribution (CC-BY 4.0). 원작자 표기 필수.\n\n');

for (let i = 0; i < args.length; i += 2) {
  const name = args[i];
  const uid = args[i + 1];
  const headers = { Authorization: `Token ${token}` };
  const info = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}`)).json();
  const dl = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers })).json();
  const url = dl.gltf?.url;
  if (!url) {
    console.error(`${name}: 다운로드 URL 없음`, dl);
    continue;
  }
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const zipPath = join(dir, 'model.zip');
  // 큰 zip 은 Node fetch 가 타임아웃 나므로 curl 로 (재시도 포함)
  execSync(`curl -sSL --retry 5 --retry-delay 3 -o "${zipPath}" "${url.replace(/"/g, '')}"`, { stdio: 'inherit' });
  const buf = readFileSync(zipPath);
  execSync(`unzip -oq "${zipPath}" -d "${dir}"`);
  rmSync(zipPath);
  const line = `- **${name}**: "${info.name}" by ${info.user.displayName} (${info.user.profileUrl}) — ${info.viewerUrl} — ${info.license.label} (${info.license.url ?? 'https://creativecommons.org/licenses/by/4.0/'})\n`;
  const cur = readFileSync(credits, 'utf8');
  if (!cur.includes(info.viewerUrl)) appendFileSync(credits, line);
  console.log(`${name}: ${info.name} (${(buf.length / 1e6).toFixed(1)} MB) → ${dir}`);
}
