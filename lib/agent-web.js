'use strict';

// Plain web reading for the agent, without opening a browser.
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_TEXT = 20000;
const TIMEOUT_MS = 20000;
const MAX_RESULTS = 8;
const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Nook/0.1';
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text) => text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
  if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
  const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
});

function htmlToText(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function assertWebAddress(url) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Only http and https addresses can be read');
}

async function download(url, signal) {
  assertWebAddress(url);
  const limits = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]);
  const response = await fetch(url, { signal: limits, headers: { 'User-Agent': AGENT, Accept: 'text/html,application/json,text/plain,*/*' } });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > MAX_BYTES) break;
  }
  return { response, body: Buffer.concat(chunks).toString('utf8') };
}

async function webFetch({ url }, signal) {
  const { response, body } = await download(url, signal);
  if (!response.ok) throw new Error(`That site answered ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!/text|json|xml|javascript/i.test(type)) throw new Error(`That address is a ${type || 'file'}, not a page. Use run_command to download it.`);
  const isHtml = /html/i.test(type);
  const title = isHtml ? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] || '').trim() : '';
  const text = isHtml ? htmlToText(body) : body;
  const cut = text.length > MAX_TEXT ? `\n[${text.length - MAX_TEXT} characters cut]` : '';
  return `${title ? `${title}\n\n` : ''}${text.slice(0, MAX_TEXT)}${cut}`;
}

function parseResults(html) {
  const results = [];
  const links = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const [whole, href, title] of html.matchAll(links)) {
    const after = html.slice(html.indexOf(whole) + whole.length);
    const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(after.slice(0, 4000))?.[1] || '';
    const target = decode(href);
    const real = /[?&]uddg=([^&]+)/.exec(target)?.[1];
    results.push({ url: real ? decodeURIComponent(real) : target, title: htmlToText(title), snippet: htmlToText(snippet) });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

async function webSearch({ query }, signal, root = 'https://html.duckduckgo.com/html/') {
  const { response, body } = await download(`${root}?q=${encodeURIComponent(String(query))}`, signal);
  const results = response.ok ? parseResults(body) : [];
  if (!results.length) return 'No results came back. Try other words, or use browser_open with a search page.';
  return results.map((item, index) => `${index + 1}. ${item.title}\n${item.url}\n${item.snippet}`).join('\n\n');
}

module.exports = { htmlToText, parseResults, webFetch, webSearch };
