import { execSync } from 'node:child_process';

export default async function globalSetup() {
  if (process.env.CI) {
    execSync('npm run db:ci:reset', { stdio: 'inherit' });
  } else {
    execSync('npm run db:test:reset', { stdio: 'inherit' });
  }
}
