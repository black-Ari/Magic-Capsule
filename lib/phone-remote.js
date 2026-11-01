'use strict';

// Turns what the phone's remote page sends into actions on this PC. Only the actions listed here
// exist, and each value is checked, so the page can never ask for anything else.
const MAX_MOVE = 400;
const MAX_NOTCHES = 15;
const MAX_TEXT = 2000;
const KEYS = new Set([
  'enter', 'backspace', 'esc', 'tab', 'space', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'delete', 'f5', 'win',
  'alt+tab', 'alt+f4', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+a', 'ctrl+s', 'ctrl+t', 'ctrl+w', 'win+d', 'win+e', 'shift+f5',
]);
const MEDIA = new Set(['toggle', 'next', 'prev']);
const VOLUME_STEP = 4;

const limit = (value, most) => Math.max(-most, Math.min(most, Math.round(Number(value) || 0)));

class PhoneRemote {
  constructor({ helper, pc }) {
    Object.assign(this, { helper, pc });
  }

  run(action) {
    switch (action?.type) {
      case 'move': return this.helper.call('remote.move', { dx: limit(action.dx, MAX_MOVE), dy: limit(action.dy, MAX_MOVE) });
      case 'click': return this.helper.call('remote.click', { button: action.button === 'right' ? 'right' : 'left', double: action.double === true });
      case 'scroll': return this.helper.call('remote.scroll', { notches: limit(action.notches, MAX_NOTCHES) });
      case 'text': return this.helper.call('input.type', { text: String(action.text ?? '').slice(0, MAX_TEXT) });
      case 'key':
        if (!KEYS.has(action.keys)) throw new Error('That key is not available');
        return this.helper.call('input.keys', { keys: action.keys });
      case 'media':
        if (!MEDIA.has(action.action)) throw new Error('Unknown media button');
        return this.helper.call('media', { action: action.action });
      case 'volume': return this.helper.call('volume.step', { delta: action.up ? VOLUME_STEP : -VOLUME_STEP });
      case 'mute': return this.helper.call('volume.mute');
      case 'lock': return this.pc.action('lock');
      case 'screenOff': return this.pc.action('screenOff');
      default: throw new Error('Unknown action');
    }
  }
}

module.exports = { PhoneRemote, KEYS };
