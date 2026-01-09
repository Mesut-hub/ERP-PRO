import { execSync } from 'node:child_process';

export default async function globalSetup() {
  // In CI, environment variables are set by GitHub Actions (no .env.test file).
  const cmd = process.env.CI ? 'npm run db:ci:reset' : 'npm run db:test:reset';
  execSync(cmd, { stdio: 'inherit' });
}