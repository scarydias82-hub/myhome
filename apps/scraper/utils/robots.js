import { USER_AGENT } from './userAgent.js';

// Minimal robots.txt parser. Handles User-agent + Disallow lines for our
// bot or wildcard. Good enough for a one-off concept scrape; not RFC-perfect.
const cache = new Map();

export async function fetchRobots(origin) {
  if (cache.has(origin)) return cache.get(origin);
  const url = `${origin}/robots.txt`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) {
      cache.set(origin, { rules: [] });
      return cache.get(origin);
    }
    const text = await res.text();
    const rules = parseRobots(text);
    cache.set(origin, { rules });
    return cache.get(origin);
  } catch {
    cache.set(origin, { rules: [] });
    return cache.get(origin);
  }
}

function parseRobots(text) {
  const lines = text.split(/\r?\n/);
  const groups = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const key = field.toLowerCase();
    if (key === 'user-agent') {
      current = { agents: [value.toLowerCase()], disallow: [] };
      groups.push(current);
    } else if (current && key === 'disallow' && value) {
      current.disallow.push(value);
    }
  }
  const ua = USER_AGENT.toLowerCase();
  const matching = groups.filter(
    (g) => g.agents.some((a) => a === '*' || ua.includes(a)),
  );
  return matching.flatMap((g) => g.disallow);
}

export async function isAllowed(targetUrl) {
  const u = new URL(targetUrl);
  const { rules } = await fetchRobots(u.origin);
  const path = u.pathname + u.search;
  for (const rule of rules) {
    if (rule === '/') return false;
    if (path.startsWith(rule)) return false;
  }
  return true;
}
