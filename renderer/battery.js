import { emit, icon, state } from './core.js';
import { toast } from './live.js';

let info = null;
let warned = false;
let status;

export const batteryPercent = () => (info ? Math.round(info.level * 100) : null);

function paint() {
  if (!status || !info) return;
  const { show, percent, lowAt } = state.settings.battery;
  const level = batteryPercent();
  status.hidden = !show;
  status.classList.toggle('low', !info.charging && level <= lowAt);
  status.replaceChildren(icon(info.charging ? 'charging' : 'battery', 16), percent ? ` ${level}%` : '');
  status.title = info.charging ? `Charging, ${level}%` : `On battery, ${level}%`;
}

function checkLow() {
  const { show, lowAt } = state.settings.battery;
  if (info.charging || batteryPercent() > lowAt) {
    warned = false;
  } else if (show && !warned) {
    warned = true;
    toast(`Low battery, ${batteryPercent()}%`, 'alert', 8000);
    emit('pet', 'lowBattery');
  }
}

export async function startBattery(element) {
  status = element;
  if (!navigator.getBattery) return;
  info = await navigator.getBattery();
  info.addEventListener('levelchange', () => { paint(); checkLow(); });
  info.addEventListener('chargingchange', () => {
    paint();
    checkLow();
    const { show, charger } = state.settings.battery;
    if (show && charger) toast(`${info.charging ? 'Charging' : 'On battery'}, ${batteryPercent()}%`, info.charging ? 'charging' : 'battery');
    if (info.charging) emit('pet', 'charging');
  });
  paint();
  checkLow();
}

export const refreshBattery = paint;
