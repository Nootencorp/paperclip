#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function parseNpmrc(text) {
  const out = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out.set(line.slice(0, idx), line.slice(idx + 1));
  }
  return out;
}

function requireEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const rootPkg = readJson('package.json');
const uiPkg = readJson('ui/package.json');
const npmrc = parseNpmrc(readText('.npmrc'));
const lock = readText('pnpm-lock.yaml');

requireEqual('packageManager', rootPkg.packageManager, 'pnpm@9.15.4');

for (const [key, expected] of Object.entries({
  'auto-install-peers': 'false',
  'frozen-lockfile': 'true',
  'prefer-frozen-lockfile': 'true',
  'save-exact': 'true',
  'save-prefix': '',
  'package-manager-strict': 'true',
  'engine-strict': 'true',
})) {
  requireEqual(`.npmrc ${key}`, npmrc.get(key), expected);
}

requireEqual('ui @tanstack/react-query dependency', uiPkg.dependencies?.['@tanstack/react-query'], '5.90.21');
requireEqual('pnpm override @tanstack/react-query', rootPkg.pnpm?.overrides?.['@tanstack/react-query'], '5.90.21');
requireEqual('pnpm override @tanstack/query-core', rootPkg.pnpm?.overrides?.['@tanstack/query-core'], '5.90.20');

for (const [label, needle] of Object.entries({
  'lock autoInstallPeers false': 'autoInstallPeers: false',
  'lock react-query override': "'@tanstack/react-query': 5.90.21",
  'lock query-core override': "'@tanstack/query-core': 5.90.20",
  'lock ui react-query exact specifier': "'@tanstack/react-query':\n        specifier: 5.90.21\n        version: 5.90.21",
  'lock query-core package pinned': "'@tanstack/query-core@5.90.20'",
  'lock react-query package pinned': "'@tanstack/react-query@5.90.21'",
})) {
  if (!lock.includes(needle)) {
    failures.push(`${label}: missing ${JSON.stringify(needle)}`);
  }
}

if (/['"]@tanstack\/react-query['"]\s*:\s*['"][~^]/.test(readText('ui/package.json'))) {
  failures.push('ui/package.json must not use a floating @tanstack/react-query range');
}

if (failures.length) {
  console.error('Install policy verification FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Install policy verification PASS: pnpm is strict/frozen and TanStack packages are pinned.');
