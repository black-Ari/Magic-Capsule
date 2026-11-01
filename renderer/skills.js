// Using a skill in any chat: the Skills button, or typing /name in a message.
import { call, h, icon } from './core.js';

export const slug = (name) => name.trim().toLowerCase().replace(/\s+/g, '-');
export const loadSkills = () => call('store.get', 'skills', []);

// "/business-documents make an invoice" uses that skill for this one message, even if it is off.
export async function pullSkills(text) {
  const skills = await loadSkills();
  const names = [];
  const rest = text.replace(/(^|\s)\/([^\s/]+)/g, (match, space, word) => {
    const skill = skills.find((item) => slug(item.name) === word.toLowerCase());
    if (!skill) return match;
    names.push(skill.name);
    return space;
  });
  return { text: rest.trim(), names };
}

const TRAILING_COMMAND = /(?:^|\s)\/([^\s/]*)$/;

export function skillMenu(field, openSettings) {
  const menu = h('div', { class: 'skill-menu', hidden: true });

  function insert(skill) {
    const start = field.value.search(/\/[^\s/]*$/);
    const before = TRAILING_COMMAND.test(field.value) ? field.value.slice(0, start) : `${field.value}${field.value && !field.value.endsWith(' ') ? ' ' : ''}`;
    field.value = `${before}/${slug(skill.name)} `;
    menu.hidden = true;
    field.focus();
  }

  async function draw(filter = '') {
    const skills = await loadSkills();
    const shown = skills.filter((skill) => slug(skill.name).includes(filter.toLowerCase()));
    menu.replaceChildren(
      ...shown.map((skill) => h('div', { class: 'skill-option' },
        h('button', { class: 'skill-use', type: 'button', title: skill.text, onClick: () => insert(skill) }, h('span', { class: 'truncate' }, `/${slug(skill.name)}`)),
        h('label', { class: 'faint skill-always' }, 'Always',
          h('input', {
            type: 'checkbox',
            checked: skill.mode === 'always',
            ariaLabel: `Always use ${skill.name}`,
            onChange: async (event) => {
              const latest = await loadSkills();
              await call('store.set', 'skills', latest.map((item) => (item.name === skill.name ? { ...item, mode: event.target.checked ? 'always' : 'auto' } : item)));
            },
          })))),
      shown.length ? '' : h('div', { class: 'faint' }, skills.length ? 'No skill matches that' : 'No skills yet'),
      h('button', { class: 'skill-manage', type: 'button', onClick: () => { menu.hidden = true; openSettings(); } }, 'Add or manage skills'),
    );
    menu.hidden = false;
  }

  field.addEventListener('input', () => {
    const match = field.value.match(TRAILING_COMMAND);
    if (match) draw(match[1]);
    else menu.hidden = true;
  });
  field.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) { event.stopPropagation(); menu.hidden = true; } });

  const button = h('button', {
    class: 'btn skill-button', type: 'button', title: 'Use a skill',
    onClick: () => { if (menu.hidden) draw(); else menu.hidden = true; },
  }, icon('spark', 14), 'Skills');
  return { button, menu };
}
