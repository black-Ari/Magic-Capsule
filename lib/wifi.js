'use strict';

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function netsh(args) {
  return new Promise((resolve) => {
    execFile('netsh', ['wlan', ...args], { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}${stderr}` });
    });
  });
}

const needsLocation = (text) => /location permission|ms-settings:privacy-location/i.test(text);

function parseNetworks(text) {
  const networks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const ssid = line.match(/^SSID \d+\s*:\s*(.*)$/); // hidden networks have an empty name
    if (ssid) {
      current = { ssid: ssid[1].trim(), signal: 0, secure: true };
      networks.push(current);
      continue;
    }
    if (!current) continue;
    const auth = line.match(/^\s+Authentication\s+: (.*)$/);
    if (auth) current.secure = !/^open$/i.test(auth[1].trim());
    const signal = line.match(/^\s+Signal\s+: (\d+)%/);
    if (signal) current.signal = Math.max(current.signal, Number(signal[1]));
  }
  return networks.filter((network) => network.ssid).sort((a, b) => b.signal - a.signal);
}

function parseCurrent(text) {
  const state = text.match(/^\s+State\s+: (.*)$/m);
  const ssid = text.match(/^\s+SSID\s+: (.*)$/m);
  return state && /^connected/i.test(state[1].trim()) && ssid ? ssid[1].trim() : '';
}

function parseProfiles(text) {
  return [...text.matchAll(/All User Profile\s+: (.*)$/gm)].map((match) => match[1].trim());
}

async function scan() {
  const [networks, interfaces, profiles] = await Promise.all([
    netsh(['show', 'networks', 'mode=bssid']),
    netsh(['show', 'interfaces']),
    netsh(['show', 'profiles']),
  ]);
  if (needsLocation(networks.out) || needsLocation(interfaces.out)) {
    return { needsLocation: true, networks: [], current: '' };
  }
  if (/no wireless interface|service.*not running/i.test(`${networks.out}${interfaces.out}`)) {
    return { unavailable: true, networks: [], current: '' };
  }
  const known = new Set(parseProfiles(profiles.out));
  return {
    current: parseCurrent(interfaces.out),
    networks: parseNetworks(networks.out).map((network) => ({ ...network, known: known.has(network.ssid) })),
  };
}

const escapeXml = (value) => value.replace(/[<>&'"]/g, (ch) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
}[ch]));

function profileXml(ssid, password) {
  const name = escapeXml(ssid);
  const security = password
    ? `<authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
       <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${escapeXml(password)}</keyMaterial></sharedKey>`
    : '<authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>';
  return `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${name}</name>
  <SSIDConfig><SSID><name>${name}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM><security>${security}</security></MSM>
</WLANProfile>`;
}

async function connect({ ssid, password, known }) {
  if (!known) {
    const file = path.join(os.tmpdir(), `nook-${crypto.randomUUID()}.xml`);
    fs.writeFileSync(file, profileXml(ssid, password), { mode: 0o600 });
    try {
      const added = await netsh(['add', 'profile', `filename=${file}`, 'user=current']);
      if (!added.ok) throw new Error(added.out.trim() || 'Could not save the network');
    } finally {
      fs.rmSync(file, { force: true }); // it holds the password in clear text
    }
  }
  const result = await netsh(['connect', `name=${ssid}`, `ssid=${ssid}`]);
  if (!result.ok) throw new Error(result.out.trim() || 'Could not connect');
}

module.exports = { scan, connect, parseNetworks, parseCurrent, parseProfiles, profileXml };
