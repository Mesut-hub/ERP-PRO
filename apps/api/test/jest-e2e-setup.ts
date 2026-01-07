import { execSync } from 'node:child_process';

export default async function globalSetup() {
  // migrate reset runs seed automatically
  execSync('npm run db:test:reset', { stdio: 'inherit' });
}