'use strict';

// A browser of the agent's own, using the Chrome or Edge already on this PC. It keeps its own profile
// in Nook's data folder, so it never touches the person's usual browser or its saved logins.
const path = require('path');
const dep = require('./deps');

const CHANNELS = ['chrome', 'msedge'];
const ACTION_MS = 15000;
const MAX_TEXT = 12000;
const MAX_ELEMENTS = 150;

// Runs in the page. Numbers each thing that can be used, so the AI can name it without guessing.
const READ_PAGE = ({ maxElements, maxText }) => {
  document.querySelectorAll('[data-nook-ref]').forEach((item) => item.removeAttribute('data-nook-ref'));
  const shown = (item) => {
    const box = item.getBoundingClientRect();
    const style = getComputedStyle(item);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = (item) => (item.getAttribute('aria-label') || item.innerText || item.value || item.placeholder || item.title || item.name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const found = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=textbox], [contenteditable=true]')]
    .filter(shown).slice(0, maxElements);
  const elements = found.map((item, index) => {
    const ref = index + 1;
    item.setAttribute('data-nook-ref', String(ref));
    const kind = item.tagName === 'INPUT' ? `input ${item.type}` : item.tagName.toLowerCase();
    return `[${ref}] ${kind} "${item.type === 'password' ? 'password box' : label(item)}"`;
  });
  return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, maxText), elements };
};

class Browser {
  constructor({ dataDir }) {
    this.profile = path.join(dataDir, 'agent-browser');
    this.context = null;
  }

  async launch() {
    const { chromium } = dep('playwright-core');
    let lastError;
    for (const channel of CHANNELS) {
      try {
        const context = await chromium.launchPersistentContext(this.profile, { channel, headless: false, viewport: null, args: ['--no-first-run', '--no-default-browser-check'] });
        context.on('close', () => { if (this.context === context) this.context = null; });
        return context;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`Could not start Chrome or Edge: ${lastError.message.split('\n')[0]}`);
  }

  async page() {
    this.context ||= await this.launch();
    const pages = this.context.pages();
    const page = pages[pages.length - 1] || await this.context.newPage();
    page.setDefaultTimeout(ACTION_MS);
    return page;
  }

  async open({ url }) {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('Only http and https addresses can be opened');
    const page = await this.page();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return `Opened ${page.url()}. Use browser_read to see it.`;
  }

  async read() {
    const page = await this.page();
    const { url, title, text, elements } = await page.evaluate(READ_PAGE, { maxElements: MAX_ELEMENTS, maxText: MAX_TEXT });
    return `${title}\n${url}\n\nThings you can use:\n${elements.join('\n') || '(none)'}\n\nPage text:\n${text}`;
  }

  locator(page, ref) {
    return page.locator(`[data-nook-ref="${Number(ref)}"]`);
  }

  async click({ ref }) {
    const page = await this.page();
    await this.locator(page, ref).click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return 'Clicked. Use browser_read to see the page now.';
  }

  async type({ ref, text, submit }) {
    const page = await this.page();
    const box = this.locator(page, ref);
    if (await box.getAttribute('type') === 'password') throw new Error('Never type passwords. Use ask_user so the person types it.');
    await box.fill(String(text));
    if (submit) await box.press('Enter');
    return submit ? 'Typed and sent. Use browser_read to see the page now.' : 'Typed.';
  }

  async close() {
    const { context } = this;
    this.context = null;
    await context?.close().catch(() => {});
  }
}

module.exports = { Browser };
