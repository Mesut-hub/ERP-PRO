import { execSync } from 'node:child_process';

export default async function globalSetup() {
  // One command only. Reset includes seeding.
  const cmd = process.env.CI ? 'npm run db:ci:reset' : 'npm run db:test:reset';
  execSync(cmd, { stdio: 'inherit' });
}