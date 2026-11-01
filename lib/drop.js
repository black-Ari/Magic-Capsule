'use strict';

// Phone <-> PC over the local network. Off until started, stops by itself when idle, and every
// route needs the random token from the QR code. Traffic is plain HTTP, so it is meant for your
// own Wi-Fi only.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const dep = require('./deps');
const { uniquePath } = require('./shelf-path');

const qrcode = dep('qrcode-generator');

const IDLE_STOP_MS = 15 * 60000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_REMOTE_BYTES = 4 * 1024;
const VIRTUAL_ADAPTER = /vEthernet|VMware|VirtualBox|Hyper-V|Loopback|WSL|TAP|TUN|VPN|ZeroTier|Tailscale|Bluetooth/i;
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

function lanAddresses(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const address of addresses) {
      if (address.family === 'IPv4' && !address.internal && PRIVATE_IPV4.test(address.address)) {
        found.push({ name, ip: address.address });
      }
    }
  }
  return found.sort((a, b) => Number(/wi-?fi|wlan/i.test(b.name)) - Number(/wi-?fi|wlan/i.test(a.name)));
}

function safeFileName(raw) {
  const base = String(raw).split(/[\\/]/).pop()
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(-150);
  if (!base || /^\.+$/.test(base) || RESERVED_NAME.test(base)) return `file-${Date.now()}`;
  return base;
}

class PhoneDrop {
  constructor({ saveDir, listFiles, onFile, onText, onStop, onRemote, page }) {
    Object.assign(this, { saveDir, listFiles, onFile, onText, onStop, onRemote, page });
    this.server = null;
    this.remoteAllowed = false; // asked for each time, and always off when sharing stops
  }

  get running() {
    return Boolean(this.server);
  }

  status() {
    return this.running
      ? { running: true, url: this.url, ip: this.host, qr: this.qr, saveDir: this.saveDir(), remote: this.remoteAllowed }
      : { running: false, addresses: lanAddresses() };
  }

  async start(host) {
    if (this.running) return this.status();
    const ip = host || (lanAddresses()[0] || {}).ip;
    if (!ip) throw new Error('No local network found. Connect this PC to Wi-Fi or Ethernet first.');

    this.token = crypto.randomBytes(18).toString('base64url');
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        if (!res.headersSent) this.send(res, 500, 'text/plain', err.message);
        else res.destroy();
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, ip, resolve);
    });

    this.server = server;
    this.host = ip;
    this.origin = `${ip}:${server.address().port}`;
    this.url = `http://${this.origin}/${this.token}/`;
    const code = qrcode(0, 'M');
    code.addData(this.url);
    code.make();
    this.qr = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    this.touch();
    return this.status();
  }

  stop(reason = 'stopped') {
    if (!this.server) return;
    clearTimeout(this.idleTimer);
    this.remoteAllowed = false;
    this.server.closeAllConnections();
    this.server.close();
    this.server = null;
    this.onStop(reason);
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop('idle'), IDLE_STOP_MS);
  }

  send(res, status, type, body, headers = {}) {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(body);
  }

  async handle(req, res) {
    const route = new URL(req.url, 'http://local').pathname.split('/').filter(Boolean);
    const allowed = req.headers.host === this.origin && route[0] === this.token;
    if (!allowed) { this.send(res, 404, 'text/plain', 'Not found'); return; }
    this.touch();

    const key = `${req.method} ${route[1] || ''}`;
    if (key === 'GET ') this.send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(this.page));
    else if (key === 'GET list') this.list(res);
    else if (key === 'GET file') this.download(res, route[2]);
    else if (key === 'POST upload') await this.upload(req, res);
    else if (key === 'POST text') await this.text(req, res);
    else if (key === 'GET remote') this.send(res, 200, 'application/json', JSON.stringify({ allowed: this.remoteAllowed }));
    else if (key === 'POST remote') await this.remote(req, res);
    else this.send(res, 404, 'text/plain', 'Not found');
  }

  list(res) {
    const files = this.listFiles().map(({ id, name, size }) => ({ id, name, size }));
    this.send(res, 200, 'application/json', JSON.stringify(files));
  }

  download(res, id) {
    const file = this.listFiles().find((item) => item.id === id);
    if (!file) { this.send(res, 404, 'text/plain', 'Not found'); return; }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fs.statSync(file.path).size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file.path).on('error', () => res.destroy()).pipe(res);
  }

  async upload(req, res) {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_UPLOAD_BYTES) { this.send(res, 413, 'text/plain', 'File is too large'); return; }

    const name = safeFileName(decodeURIComponent(req.headers['x-file-name'] || 'file'));
    const dir = this.saveDir();
    fs.mkdirSync(dir, { recursive: true });
    const part = path.join(dir, `.${crypto.randomUUID()}.part`);
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) req.destroy(new Error('File is too large'));
    });
    try {
      await pipeline(req, fs.createWriteStream(part));
      const finalPath = uniquePath(dir, name);
      fs.renameSync(part, finalPath);
      this.onFile(finalPath);
      this.send(res, 200, 'application/json', JSON.stringify({ name: path.basename(finalPath) }));
    } catch (err) {
      fs.rmSync(part, { force: true });
      throw err;
    }
  }

  async readBody(req, most) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > most) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async text(req, res) {
    const body = await this.readBody(req, MAX_TEXT_BYTES);
    if (body === null) { this.send(res, 413, 'text/plain', 'Text is too long'); return; }
    this.onText(body);
    this.send(res, 200, 'application/json', '{}');
  }

  setRemote(allowed) {
    this.remoteAllowed = Boolean(allowed) && this.running;
    return this.remoteAllowed;
  }

  async remote(req, res) {
    if (!this.remoteAllowed) { this.send(res, 403, 'text/plain', 'Turn on phone control in Nook first'); return; }
    const body = await this.readBody(req, MAX_REMOTE_BYTES);
    if (body === null) { this.send(res, 413, 'text/plain', 'Too long'); return; }
    try {
      await this.onRemote(JSON.parse(body));
      this.send(res, 200, 'application/json', '{}');
    } catch (err) {
      this.send(res, 400, 'text/plain', err.message);
    }
  }
}

module.exports = { PhoneDrop, lanAddresses, safeFileName };
