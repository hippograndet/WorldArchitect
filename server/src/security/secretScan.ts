import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';

const SCAN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'OpenAI API key', pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{24,}/ },
  { name: 'Groq API key', pattern: /gsk_[A-Za-z0-9_-]{16,}/ },
  { name: 'AWS access key ID', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Stripe API key', pattern: /sk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Slack token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
];

const IGNORED_SUFFIXES = [
  'package-lock.json',
  'PLAN.md',
];

function trackedFiles(): string[] {
  const result = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function shouldSkip(file: string): boolean {
  if (file.includes('node_modules/') || file.includes('/dist/') || file.includes('/build/')) return true;
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return true;
  if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.webp')) return true;
  return IGNORED_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

export function assertNoCommittedSecrets(): void {
  if (process.env.WORLDARCHITECT_SKIP_SECRET_SCAN === '1' || process.env.NODE_ENV === 'test') return;

  const findings: string[] = [];
  for (const file of trackedFiles()) {
    if (shouldSkip(file)) continue;

    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const { name, pattern } of SCAN_PATTERNS) {
      if (pattern.test(text)) findings.push(`${file}: possible ${name}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Startup blocked because possible committed API keys were found:\n${findings.join('\n')}\n` +
      'Remove the secret from tracked files or set WORLDARCHITECT_SKIP_SECRET_SCAN=1 only after manual review.',
    );
  }
}
