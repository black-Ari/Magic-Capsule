import { call, fmtDate, h, iconButton, viewTitle } from '../core.js';

const CATEGORIES = {
  Length: { Millimetre: 0.001, Centimetre: 0.01, Metre: 1, Kilometre: 1000, Inch: 0.0254, Foot: 0.3048, Yard: 0.9144, Mile: 1609.344 },
  Weight: { Milligram: 0.000001, Gram: 0.001, Kilogram: 1, Tonne: 1000, Ounce: 0.0283495, Pound: 0.453592 },
  Area: { 'Square metre': 1, 'Square foot': 0.092903, Acre: 4046.86, Hectare: 10000, 'Square km': 1000000 },
  Volume: { Millilitre: 0.001, Litre: 1, 'Cubic metre': 1000, Teaspoon: 0.00492892, Cup: 0.236588, Gallon: 3.78541 },
  Speed: { 'km/h': 1, 'm/s': 3.6, mph: 1.60934, Knot: 1.852 },
  Data: { Byte: 1, KB: 1000, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824 },
  Time: { Second: 1, Minute: 60, Hour: 3600, Day: 86400, Week: 604800, Year: 31557600 },
  Temperature: { Celsius: null, Fahrenheit: null, Kelvin: null },
  Currency: {},
};

const toCelsius = { Celsius: (v) => v, Fahrenheit: (v) => (v - 32) * 5 / 9, Kelvin: (v) => v - 273.15 };
const fromCelsius = { Celsius: (v) => v, Fahrenheit: (v) => v * 9 / 5 + 32, Kelvin: (v) => v + 273.15 };

let category = 'Length';
let fromUnit;
let toUnit;
let amount;
let result;
let note;
let picker;

function convert(value, from, to) {
  if (category === 'Temperature') return fromCelsius[to](toCelsius[from](value));
  const table = CATEGORIES[category];
  // Rates are "units per USD"; every other table is "base units per unit".
  return category === 'Currency' ? (value / table[from]) * table[to] : (value * table[from]) / table[to];
}

function format(value) {
  if (!Number.isFinite(value)) return '-';
  const digits = category === 'Currency' ? 2 : 6;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

function update() {
  const value = Number(amount.value);
  result.textContent = amount.value === '' || Number.isNaN(value) ? '-' : format(convert(value, fromUnit.value, toUnit.value));
}

function fill(select, units, chosen) {
  select.replaceChildren(...units.map((unit) => h('option', { value: unit }, unit)));
  select.value = chosen;
}

async function setCategory(name) {
  category = name;
  picker.value = name;
  note.textContent = '';
  if (name === 'Currency' && !Object.keys(CATEGORIES.Currency).length) {
    result.textContent = '...';
    try {
      const { rates, at } = await call('rates.get');
      CATEGORIES.Currency = rates;
      note.textContent = `Rates from ${fmtDate(at, { day: 'numeric', month: 'short' })}`;
    } catch (err) {
      result.textContent = '-';
      note.textContent = `Rates unavailable: ${err.message}`;
      return;
    }
  }
  const units = Object.keys(CATEGORIES[name]);
  const currency = name === 'Currency';
  fill(fromUnit, units, currency ? 'USD' : units[0]);
  fill(toUnit, units, currency ? 'INR' : units[1]);
  update();
}

export default {
  id: 'units',
  title: 'Units',
  icon: 'ruler',

  render(view) {
    picker = h('select', { ariaLabel: 'Category', onChange: () => setCategory(picker.value) },
      Object.keys(CATEGORIES).map((name) => h('option', { value: name }, name)));
    amount = h('input', { type: 'number', value: '1', step: 'any', ariaLabel: 'Amount', onInput: update });
    fromUnit = h('select', { ariaLabel: 'From', onChange: update });
    toUnit = h('select', { ariaLabel: 'To', onChange: update });
    result = h('div', { class: 'value selectable truncate' }, '-');
    note = h('div', { class: 'faint' });
    const swap = iconButton('swap', 'Swap units', () => {
      [fromUnit.value, toUnit.value] = [toUnit.value, fromUnit.value];
      update();
    }, 'btn icon-only');
    view.append(
      viewTitle('Units', picker),
      h('div', { class: 'card col' },
        h('div', { class: 'row' }, amount, fromUnit, swap, toUnit),
        h('div', { class: 'label' }, 'Result'),
        result,
        note),
    );
    setCategory('Length');
  },
};
