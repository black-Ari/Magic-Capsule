import { call, emit, h, icon, iconButton, on, saveSettings, state, viewTitle } from '../core.js';
import { RANK, setActivity, toast } from '../live.js';

const HUD_MS = 1600;
const CONFIRM_MS = 3000;
const RADIO_RETRIES = 3;
const RADIO_RETRY_MS = 1500;
const PAGES = [['quick', 'Quick'], ['wifi', 'Wi-Fi'], ['vpn', 'VPN'], ['bluetooth', 'Bluetooth'], ['sound', 'Sound'], ['pc', 'PC']];
const TILES = [
  ['wifi', 'Wi-Fi', 'wifi'], ['bluetooth', 'Bluetooth', 'bluetooth'], ['flight', 'Flight mode', 'plane'], ['hotspot', 'Hotspot', 'hotspot'],
  ['vpn', 'VPN', 'shield'], ['dark', 'Dark mode', 'moon'], ['nightLight', 'Night light', 'sun'], ['quiet', 'Do not disturb', 'bellOff'],
  ['camera', 'Camera', 'camera'], ['mic', 'Microphone', 'mic'], ['keepAwake', 'Stay awake', 'eye'],
];
const POWER = [['saver', 'Battery saver'], ['balanced', 'Balanced'], ['performance', 'Best performance']];
const SCREENS = [['internal', 'This screen'], ['clone', 'Same on both'], ['extend', 'Extend'], ['external', 'Second only']];
const SHORTCUTS = [
  ['settings', 'Settings'], ['taskManager', 'Task Manager'], ['controlPanel', 'Control Panel'], ['snip', 'Screenshot'],
  ['update', 'Windows Update'], ['apps', 'Apps'], ['storage', 'Storage'], ['display', 'Display'], ['notifications', 'Notifications'], ['location', 'Location'],
];

let volume = null;
let ui = null;
let firstVolume = true;
let page = 'quick';
let control = {};
let micMuted = null;

const cleanError = (err) => err.message.replace(/^Error invoking remote method 'call': (Error: )?/, '');

function showHud() {
  const bar = h('div', { class: 'pill-bar' }, h('span', { style: `width:${volume.muted ? 0 : volume.percent}%` }));
  setActivity('volume', {
    rank: RANK.volume, ttl: HUD_MS, left: icon(volume.muted ? 'mute' : 'volume', 16), right: bar, sub: `${volume.percent}%`,
  });
}

function paintVolume() {
  if (!ui || !volume) return;
  for (const slider of ui.volumes) slider.value = volume.percent;
  for (const text of ui.volumeTexts) text.textContent = volume.muted ? 'Muted' : `${volume.percent}%`;
  for (const button of ui.mutes) button.replaceChildren(icon(volume.muted ? 'mute' : 'volume', 16));
}

const volumeRow = () => {
  const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, ariaLabel: 'Volume', onInput: () => call('volume.set', Number(slider.value)) });
  const text = h('span', { class: 'chip' });
  const mute = iconButton('volume', 'Mute', () => call('volume.mute'));
  ui.volumes.push(slider);
  ui.volumeTexts.push(text);
  ui.mutes.push(mute);
  return h('div', { class: 'row' }, mute, slider, text);
};

function micValue() {
  return micMuted === null ? null : !micMuted;
}

async function loadMic() {
  micMuted = await call('mic.get').catch(() => null);
  drawMic();
}

function drawMic() {
  if (!ui) return;
  if (micMuted === null) {
    ui.mic.replaceChildren(h('span', { class: 'faint' }, 'No microphone found'));
  } else {
    const muted = micMuted;
    ui.mic.replaceChildren(
      icon(muted ? 'micOff' : 'mic', 16),
      h('span', { class: 'grow' }, muted ? 'Muted' : 'On'),
      h('button', { class: `btn ${muted ? 'primary' : ''}`, type: 'button', onClick: () => flipMic() }, muted ? 'Unmute' : 'Mute'),
    );
  }
  paintTiles();
}

async function flipMic() {
  const muted = micMuted;
  await call('mic.set', !muted);
  toast(muted ? 'Microphone on' : 'Microphone muted', muted ? 'mic' : 'micOff');
  await loadMic();
}

async function loadBrightness() {
  const value = await call('brightness.get').catch(() => null);
  if (value === null || value === undefined) {
    ui.brightnessRow.replaceChildren(h('span', { class: 'faint' }, 'This display does not allow brightness control'));
    return;
  }
  ui.brightness.value = value;
  ui.brightnessText.textContent = `${value}%`;
}

function tileValue(id) {
  if (id === 'mic') return micValue();
  if (id === 'keepAwake') return state.settings.keepAwake;
  if (id === 'vpn') return control.vpnConnected;
  return control[id];
}

function paintTiles() {
  if (!ui) return;
  for (const [id] of TILES) {
    const value = tileValue(id);
    const tile = ui.tiles[id];
    tile.classList.toggle('on', value === true);
    tile.disabled = value === null || value === undefined;
    tile.setAttribute('aria-pressed', String(value === true));
  }
  ui.power.value = control.power || 'balanced';
}

async function loadControl(tries = RADIO_RETRIES) {
  try {
    const [next, vpns] = await Promise.all([call('control.state'), call('control.vpn')]);
    control = { ...next, vpnConnected: vpns.some((vpn) => vpn.connected) };
    ui.status.textContent = '';
    // Right after Nook starts, Windows can answer before it has listed the radios.
    if (tries > 0 && next.wifi === null) setTimeout(() => loadControl(tries - 1), RADIO_RETRY_MS);
  } catch (err) {
    ui.status.textContent = cleanError(err);
  }
  paintTiles();
}

async function flip(id) {
  if (id === 'vpn') { showPage('vpn'); return; }
  if (id === 'mic') { await flipMic(); return; }
  const next = !tileValue(id);
  const [, label] = TILES.find(([key]) => key === id);
  ui.tiles[id].classList.add('busy');
  ui.status.textContent = '';
  try {
    if (id === 'keepAwake') await saveSettings({ keepAwake: next });
    else await call('control.set', id, next);
    toast(`${label} ${next ? 'on' : 'off'}`);
    emit('pet-control', { id, on: next });
    if (id !== 'keepAwake') await loadControl();
  } catch (err) {
    ui.status.textContent = cleanError(err);
  }
  ui.tiles[id].classList.remove('busy');
  paintTiles();
}

function quickPage() {
  ui.tiles = {};
  ui.status = h('div', { class: 'error' });
  ui.brightness = h('input', {
    type: 'range', min: 0, max: 100, step: 1, ariaLabel: 'Brightness',
    onChange: () => { ui.brightnessText.textContent = `${ui.brightness.value}%`; call('brightness.set', Number(ui.brightness.value)); },
  });
  ui.brightnessText = h('span', { class: 'chip' });
  ui.brightnessRow = h('div', { class: 'row' }, h('span', { class: 'control-icon' }, icon('sun', 16)), ui.brightness, ui.brightnessText);
  ui.power = h('select', {
    ariaLabel: 'Power mode',
    onChange: async () => {
      await call('control.power', ui.power.value).catch((err) => { ui.status.textContent = cleanError(err); });
      emit('pet-control', { id: 'power', on: ui.power.value === 'performance' });
      loadControl();
    },
  }, POWER.map(([value, label]) => h('option', { value }, label)));
  return h('div', { class: 'col grow scroll' },
    h('div', { class: 'control-tiles' }, TILES.map(([id, label, name]) => {
      ui.tiles[id] = h('button', { class: 'control-tile', type: 'button', title: label, onClick: () => flip(id) }, icon(name, 18), h('span', { class: 'truncate' }, label));
      return ui.tiles[id];
    })),
    ui.status,
    h('div', { class: 'card col' }, volumeRow(), ui.brightnessRow,
      h('label', { class: 'row' }, h('span', { class: 'control-icon' }, icon('power', 16)), h('span', { class: 'grow' }, 'Power mode'), ui.power)));
}

function connectForm(network) {
  const password = h('input', { type: 'password', class: 'grow', placeholder: 'Password', ariaLabel: `Password for ${network.ssid}`, minLength: 8 });
  const status = h('div', { class: 'error' });
  const submit = async (event) => {
    event.preventDefault();
    status.textContent = '';
    if (await connect(network, password.value, status)) password.value = '';
  };
  return h('form', { class: 'col', onSubmit: submit },
    h('div', { class: 'row' }, password, h('button', { class: 'btn primary', type: 'submit' }, 'Connect')), status);
}

async function connect(network, password, status) {
  try {
    await call('wifi.connect', { ssid: network.ssid, password, known: network.known });
    setTimeout(scan, 3000);
    return true;
  } catch (err) {
    status.textContent = cleanError(err);
    return false;
  }
}

function networkRow(network, current) {
  const connected = network.ssid === current;
  const status = h('div', { class: 'error' });
  const form = h('div');
  return h('div', { class: 'col' },
    h('div', {
      class: 'list-row',
      style: 'cursor:pointer',
      onClick: () => {
        if (connected) return;
        if (network.secure && !network.known) form.replaceChildren(form.childElementCount ? '' : connectForm(network));
        else connect(network, '', status);
      },
    },
    icon('wifi', 16),
    h('span', { class: 'grow truncate' }, network.ssid),
    connected && h('span', { class: 'chip' }, 'Connected'),
    network.secure && icon('lock', 14),
    h('span', { class: 'faint' }, `${network.signal}%`)),
    form, status);
}

async function scan() {
  if (!ui) return;
  ui.wifi.replaceChildren(h('div', { class: 'faint' }, 'Scanning...'));
  const result = await call('wifi.scan').catch((err) => ({ error: cleanError(err) }));
  if (result.needsLocation) {
    ui.wifi.replaceChildren(h('div', { class: 'col' },
      h('div', { class: 'label' }, 'Windows only shares the Wi-Fi list when Location is on. Turn on Location services and "Let desktop apps access your location".'),
      h('button', { class: 'btn', type: 'button', onClick: () => call('wifi.locationSettings') }, 'Open Location settings')));
  } else if (result.unavailable || result.error) {
    ui.wifi.replaceChildren(h('div', { class: 'faint' }, result.error || 'No Wi-Fi adapter found'));
  } else {
    ui.wifi.replaceChildren(...(result.networks.length
      ? result.networks.map((network) => networkRow(network, result.current))
      : [h('div', { class: 'faint' }, 'No networks found')]));
  }
}

function wifiPage() {
  ui.wifi = h('div', { class: 'col grow scroll' });
  return h('div', { class: 'card col grow' },
    h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Wi-Fi networks'), iconButton('refresh', 'Scan again', scan), settingsButton('wifi', 'Wi-Fi settings')),
    ui.wifi);
}

const settingsButton = (name, label) => iconButton('open', label, () => call('control.open', name));

function vpnRow(vpn) {
  const status = h('div', { class: 'error' });
  const button = h('button', {
    class: `btn ${vpn.connected ? '' : 'primary'}`,
    type: 'button',
    onClick: async () => {
      button.disabled = true;
      button.textContent = vpn.connected ? 'Disconnecting...' : 'Connecting...';
      status.textContent = '';
      try {
        await call(vpn.connected ? 'control.vpnDisconnect' : 'control.vpnConnect', vpn.name);
        toast(`VPN ${vpn.name.trim()} ${vpn.connected ? 'off' : 'on'}`);
        emit('pet-control', { id: 'vpn', on: !vpn.connected });
        loadVpn();
      } catch (err) {
        status.textContent = cleanError(err);
        button.disabled = false;
        button.textContent = 'Connect';
      }
    },
  }, vpn.connected ? 'Disconnect' : 'Connect');
  return h('div', { class: 'col' }, h('div', { class: 'list-row' }, icon('shield', 16),
    h('span', { class: 'grow truncate' }, vpn.name.trim()),
    vpn.connected && h('span', { class: 'chip' }, 'Connected'), button), status);
}

async function loadVpn() {
  const list = await call('control.vpn').catch(() => []);
  control.vpnConnected = list.some((vpn) => vpn.connected);
  ui.vpn.replaceChildren(...(list.length
    ? list.map(vpnRow)
    : [h('div', { class: 'faint' }, 'No VPN is saved in Windows yet. Add one in VPN settings. Apps such as Proton VPN are opened from their own window.')]));
  paintTiles();
}

function vpnPage() {
  ui.vpn = h('div', { class: 'col grow scroll' });
  return h('div', { class: 'card col grow' },
    h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'VPNs saved in Windows'), iconButton('refresh', 'Refresh', loadVpn), settingsButton('vpn', 'VPN settings')),
    ui.vpn);
}

async function loadBluetooth() {
  ui.bluetooth.replaceChildren(h('div', { class: 'faint' }, 'Looking...'));
  const list = await call('control.bluetooth').catch((err) => ({ error: cleanError(err) }));
  if (list.error) { ui.bluetooth.replaceChildren(h('div', { class: 'faint' }, list.error)); return; }
  list.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  ui.bluetooth.replaceChildren(...(list.length
    ? list.map((device) => h('div', { class: 'list-row' }, icon('bluetooth', 16), h('span', { class: 'grow truncate' }, device.name), device.connected && h('span', { class: 'chip' }, 'Connected')))
    : [h('div', { class: 'faint' }, 'No paired devices. Pair one in Bluetooth settings.')]));
}

function bluetoothPage() {
  ui.bluetooth = h('div', { class: 'col grow scroll' });
  return h('div', { class: 'card col grow' },
    h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Paired devices. Windows connects them by itself when they are near.'), iconButton('refresh', 'Refresh', loadBluetooth), settingsButton('bluetooth', 'Bluetooth settings')),
    ui.bluetooth);
}

async function loadOutputs() {
  const list = await call('control.outputs').catch(() => []);
  ui.outputs.replaceChildren(...(list.length
    ? list.map((output) => h('div', {
      class: 'list-row',
      style: 'cursor:pointer',
      onClick: async () => {
        await call('control.output', output.id).catch((err) => toast(cleanError(err), 'alert'));
        loadOutputs();
      },
    }, icon('volume', 16), h('span', { class: 'grow truncate' }, output.name), output.current && h('span', { class: 'chip' }, 'In use')))
    : [h('div', { class: 'faint' }, 'No sound device found')]));
}

function soundPage() {
  ui.outputs = h('div', { class: 'col scroll' });
  ui.mic = h('div', { class: 'row' });
  return h('div', { class: 'col grow scroll' },
    h('div', { class: 'card col' }, h('div', { class: 'label' }, 'Volume'), volumeRow(), h('div', { class: 'label' }, 'Microphone'), ui.mic),
    h('div', { class: 'card col grow' }, h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Sound comes out of'), settingsButton('sound', 'Sound settings')), ui.outputs));
}

// Things that end your work ask twice.
function confirmButton(label, run) {
  let armed = false;
  let timer = null;
  const reset = () => { armed = false; button.textContent = label; button.classList.remove('primary'); };
  const button = h('button', {
    class: 'btn', type: 'button',
    onClick: () => {
      clearTimeout(timer);
      if (armed) { reset(); run(); return; }
      armed = true;
      button.textContent = 'Sure? Click again';
      button.classList.add('primary');
      timer = setTimeout(reset, CONFIRM_MS);
    },
  }, label);
  return button;
}

function pcPage() {
  const cancel = h('button', {
    class: 'btn', type: 'button', hidden: true,
    onClick: async () => { await call('control.action', 'cancelShutdown'); cancel.hidden = true; toast('Cancelled'); },
  }, 'Cancel shutdown');
  const ending = (name, label) => confirmButton(label, async () => {
    await call('control.action', name);
    cancel.hidden = false;
    toast(`${label} in 20 seconds`, 'alert');
  });
  const screen = h('select', { ariaLabel: 'Second screen', onChange: () => call('control.display', screen.value) },
    SCREENS.map(([value, label]) => h('option', { value }, label)));
  screen.value = 'extend';
  const button = (label, run) => h('button', { class: 'btn', type: 'button', onClick: run }, label);
  return h('div', { class: 'col grow scroll' },
    h('div', { class: 'card col' },
      h('div', { class: 'label' }, 'This PC'),
      h('div', { class: 'control-actions' },
        button('Lock', () => call('control.action', 'lock')),
        confirmButton('Sleep', () => call('control.action', 'sleep')),
        button('Screen off', () => call('control.action', 'screenOff')),
        confirmButton('Empty Recycle Bin', async () => { await call('control.action', 'emptyBin'); toast('Recycle Bin is empty', 'recycle'); }),
        confirmButton('Sign out', () => call('control.action', 'signOut')),
        ending('restart', 'Restart'),
        ending('shutDown', 'Shut down'),
        cancel)),
    h('label', { class: 'card row' }, h('span', { class: 'control-icon' }, icon('monitor', 16)), h('span', { class: 'grow' }, 'With a second screen, show'), screen),
    h('div', { class: 'card col' },
      h('div', { class: 'label' }, 'Open'),
      h('div', { class: 'control-actions' }, SHORTCUTS.map(([name, label]) => button(label, () => call('control.open', name))))));
}

const loaders = {
  quick: () => { loadControl(); loadBrightness(); loadMic(); },
  wifi: scan,
  vpn: loadVpn,
  bluetooth: loadBluetooth,
  sound: () => { loadOutputs(); loadMic(); },
  pc: () => {},
};

function showPage(next) {
  page = next;
  for (const [id, element] of Object.entries(ui.pages)) element.hidden = id !== next;
  for (const button of ui.segments.children) button.classList.toggle('active', button.dataset.page === next);
  paintVolume();
  loaders[next]();
}

export default {
  id: 'control',
  title: 'Control',
  icon: 'sliders',

  init() {
    on('volume', (next) => {
      volume = next;
      paintVolume();
      if (firstVolume) firstVolume = false; // the first report is the current level, not a change
      else if (state.settings.volumeHud) showHud();
    });
  },

  render(view) {
    ui = { volumes: [], volumeTexts: [], mutes: [] };
    ui.pages = {
      quick: quickPage(), wifi: wifiPage(), vpn: vpnPage(), bluetooth: bluetoothPage(), sound: soundPage(), pc: pcPage(),
    };
    ui.segments = h('div', { class: 'segmented' }, PAGES.map(([id, label]) => h('button', { type: 'button', 'data-page': id, onClick: () => showPage(id) }, label)));
    view.append(viewTitle('Control', ui.segments), ...Object.values(ui.pages));
    paintVolume();
  },

  async show() {
    if (!ui) return;
    volume ||= await call('volume.get').catch(() => null);
    showPage(page);
  },
};
