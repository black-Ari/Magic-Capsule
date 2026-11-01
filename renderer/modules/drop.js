import { call, emit, h, icon, on, viewTitle } from '../core.js';

let body;
let received = [];
let error = '';

function renderQr(markup) {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  return h('div', { class: 'qr', role: 'img', ariaLabel: 'QR code for your phone' }, document.importNode(parsed, true));
}

function receivedList() {
  return h('div', { class: 'col grow scroll' },
    h('div', { class: 'label' }, 'Received this session'),
    received.length
      ? received.map((name) => h('div', { class: 'row' }, icon('check', 14), h('span', { class: 'truncate' }, name)))
      : h('div', { class: 'faint' }, 'Nothing yet'));
}

async function start(ip) {
  error = '';
  try {
    await call('drop.start', ip);
  } catch (err) {
    error = err.message.replace(/^Error invoking remote method 'call': (Error: )?/, '');
  }
  draw();
}

async function draw() {
  if (!body) return;
  const status = await call('drop.status');
  if (status.running) {
    body.replaceChildren(h('div', { class: 'drop-grid' },
      renderQr(status.qr),
      h('div', { class: 'card col' },
        h('div', { class: 'label' }, 'Scan with your phone camera. Both devices must be on the same Wi-Fi.'),
        h('div', { class: 'selectable truncate' }, status.url),
        h('div', { class: 'faint' }, 'Files from your phone go to Downloads\\Nook Drop. Files on your Shelf can be downloaded on the phone.'),
        h('div', { class: 'faint' }, 'If the phone cannot connect, allow Nook on private networks in Windows Firewall.'),
        h('label', { class: 'row' },
          h('span', { class: 'grow' }, 'Let the phone control this PC'),
          h('input', { type: 'checkbox', checked: status.remote, ariaLabel: 'Let the phone control this PC', onChange: (event) => call('drop.remote', event.target.checked) })),
        h('div', { class: 'faint' }, 'Adds a touchpad, keyboard and buttons to the page on your phone. It turns off when sharing stops. Use it on your own Wi-Fi only, because anyone with this link could use your PC.'),
        receivedList(),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onClick: () => call('drop.openFolder') }, icon('folder', 15), 'Open folder'),
          h('button', { class: 'btn primary', type: 'button', onClick: async () => { await call('drop.stop'); draw(); } }, icon('stop', 15), 'Stop')))));
    return;
  }

  const addresses = status.addresses;
  const choose = addresses.length > 1
    ? h('select', { ariaLabel: 'Network' }, addresses.map(({ name, ip }) => h('option', { value: ip }, `${name} (${ip})`)))
    : null;
  body.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'col', style: 'align-items:center;max-width:380px' },
    icon('phone', 40),
    h('div', {}, 'Send files and text between your phone and this PC over your own Wi-Fi, or use the phone as a touchpad and keyboard. Nothing to install on the phone.'),
    h('div', { class: 'faint' }, 'It only runs while you need it, and stops after 15 idle minutes.'),
    choose,
    h('button', { class: 'btn primary', type: 'button', disabled: !addresses.length, onClick: () => start(choose ? choose.value : undefined) }, 'Start sharing'),
    !addresses.length && h('div', { class: 'error' }, 'No local network found.'),
    error && h('div', { class: 'error' }, error))));
}

export default {
  id: 'drop',
  title: 'Phone Drop',
  icon: 'phone',

  init() {
    on('drop:received', (name) => { received.unshift(name); emit('pet', 'fileArrived'); draw(); });
    on('drop:stopped', () => draw());
  },

  render(view) {
    body = h('div', { class: 'col grow' });
    view.append(viewTitle('Phone'), body);
    draw();
  },

  show: () => draw(),
};
