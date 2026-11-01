'use strict';

// Pure sums about screens, kept apart from Electron so they can be tested without one.
const GLOW_ROOM = 40;
const LIMITS = { minW: 680, maxW: 960, minH: 400, maxH: 620 };
const SHARE = { w: 0.56, h: 0.61 };
const MARGIN = { side: 24, bottom: 64 };
const ROUND_TO = 10;

const roundStep = (value) => Math.round(value / ROUND_TO) * ROUND_TO;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// The open panel for one screen. It always fits, even if the chosen size is larger than the screen.
function fitPanel(bounds, settings) {
  const wanted = settings.fitScreen
    ? {
      w: clamp(roundStep(bounds.width * SHARE.w), LIMITS.minW, LIMITS.maxW),
      h: clamp(roundStep(bounds.height * SHARE.h), LIMITS.minH, LIMITS.maxH),
    }
    : { w: settings.panelWidth, h: settings.panelHeight };
  return {
    w: Math.min(wanted.w, bounds.width - MARGIN.side),
    h: Math.min(wanted.h, bounds.height - MARGIN.bottom - settings.topGap),
  };
}

function sheetFor(bounds, panel, { position, topGap }) {
  const width = panel.w + GLOW_ROOM * 2;
  const left = bounds.x + (bounds.width * position) / 100 - width / 2;
  return {
    x: Math.round(Math.max(bounds.x, Math.min(bounds.x + bounds.width - width, left))),
    y: bounds.y,
    width,
    height: panel.h + GLOW_ROOM + topGap,
  };
}

// Which screens get a notch. A chosen screen that is unplugged falls back to the main one.
function pickDisplays(displays, primaryId, { displayMode, displayId }, cursorDisplayId) {
  const byId = (id) => displays.find((display) => String(display.id) === String(id));
  const primary = byId(primaryId) || displays[0];
  switch (displayMode) {
    case 'all': return displays;
    case 'one': return [byId(displayId) || primary];
    case 'follow': return [byId(cursorDisplayId) || primary];
    default: return [primary];
  }
}

function describeDisplays(displays, primaryId) {
  return [...displays]
    .sort((a, b) => a.bounds.x - b.bounds.x)
    .map((display, index) => ({
      id: String(display.id),
      label: `Screen ${index + 1}, ${display.bounds.width} x ${display.bounds.height}${String(display.id) === String(primaryId) ? ' (main)' : ''}`,
    }));
}

// Where a walking pet is right now, as a shift from its resting place.
function walkOffset({ from, to, ms, at }, now) {
  const done = ms > 0 ? clamp((now - at) / ms, 0, 1) : 1;
  return from + (to - from) * done;
}

module.exports = {
  fitPanel, sheetFor, pickDisplays, describeDisplays, walkOffset,
};
