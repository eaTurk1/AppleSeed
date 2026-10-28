import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Preserve only the optional portal's non-secret configuration during updates.
export function portalEnvironment(plist, environment = process.env) {
  let previous = {};
  if (existsSync(plist)) previous = JSON.parse(execFileSync('/usr/bin/plutil', ['-extract', 'EnvironmentVariables', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  const address = environment.APPLESEED_PORTAL_URL || previous.APPLESEED_PORTAL_URL;
  if (!address) return {};
  const url = new URL(address), port = environment.APPLESEED_PORTAL_PORT || previous.APPLESEED_PORTAL_PORT || '18798';
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(url.pathname) || !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || ['18796', '5900'].includes(port)) throw new Error('Invalid Web Portal URL or listener port.');
  return { APPLESEED_PORTAL_URL: url.href, APPLESEED_PORTAL_PORT: String(port) };
}
