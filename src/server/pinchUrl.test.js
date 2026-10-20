import { describe, it, expect } from 'vitest';
import { normalizePinchBackendUrl } from './pinchUrl.js';

describe('normalizePinchBackendUrl', () => {
  it('accepts a clean https origin and returns it normalized', () => {
    expect(normalizePinchBackendUrl('https://pinch-mt-preview.vercel.app')).toBe(
      'https://pinch-mt-preview.vercel.app',
    );
    expect(normalizePinchBackendUrl('https://pinch.usesundays.com')).toBe(
      'https://pinch.usesundays.com',
    );
    // a trailing slash is just the root path → still origin-only
    expect(normalizePinchBackendUrl('https://pinch.example.com/')).toBe('https://pinch.example.com');
    // explicit port is kept
    expect(normalizePinchBackendUrl('https://pinch.example.com:8443')).toBe(
      'https://pinch.example.com:8443',
    );
    // surrounding whitespace is trimmed
    expect(normalizePinchBackendUrl('  https://pinch.example.com  ')).toBe(
      'https://pinch.example.com',
    );
  });

  it('rejects anything that is not a bare https origin (feeds CSP + iframe src)', () => {
    for (const bad of [
      undefined,
      null,
      '',
      '   ',
      'http://pinch.example.com', // not https
      'https://*.vercel.app', // wildcard host
      'https://pinch.example.com/cook/123', // has a path
      'https://pinch.example.com?x=1', // has a query
      'https://pinch.example.com#frag', // has a fragment
      'https://user:pass@pinch.example.com', // credentials
      'javascript:alert(1)', // scheme injection
      'data:text/html,hi',
      'ftp://pinch.example.com',
      'pinch.example.com', // no scheme
      'https://pinch.example.com; script-src *', // injection attempt → invalid URL
    ]) {
      expect(normalizePinchBackendUrl(bad), `should reject: ${String(bad)}`).toBeNull();
    }
  });
});
