'use strict';

// Which skills apply to a message. Each skill is auto, always or off. Auto skills are matched on the
// words of the message, on this PC, so choosing one costs no AI request and sends nothing extra.
const { SKILL_LIBRARY } = require('./skill-library');

const MAX_AUTO = 3;
const MIN_WORD = 4;
const IGNORED = new Set(['skill', 'skills', 'helper', 'check', 'with', 'from', 'that', 'this', 'your', 'when', 'what', 'have', 'make', 'help']);

const words = (text) => String(text).toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) || [];

// Skills saved before modes existed had a simple on/off switch.
function skillMode(skill) {
  if (['auto', 'always', 'off'].includes(skill.mode)) return skill.mode;
  if (skill.on === false) return 'off';
  return SKILL_LIBRARY.find((item) => item.name === skill.name)?.mode || 'auto';
}

function keywordsOf(skill) {
  if (Array.isArray(skill.keywords) && skill.keywords.length) return skill.keywords;
  const known = SKILL_LIBRARY.find((item) => item.name === skill.name);
  if (known) return known.keywords;
  return words(skill.name).filter((word) => word.length >= MIN_WORD && !IGNORED.has(word));
}

function matches(keyword, messageWords, text) {
  const wanted = String(keyword).toLowerCase().trim();
  if (!wanted) return false;
  return wanted.includes(' ') ? text.includes(wanted) : messageWords.has(wanted);
}

function chooseSkills(skills, message) {
  const text = words(message).join(' ');
  const messageWords = new Set(text.split(' '));
  return skills
    .filter((skill) => skillMode(skill) === 'auto')
    .map((skill) => ({ skill, hits: keywordsOf(skill).filter((keyword) => matches(keyword, messageWords, text)).length }))
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, MAX_AUTO)
    .map(({ skill }) => skill.name);
}

const USER_SKILLS_HEADING = '\n\nSkills the person added. Follow them when they fit the task:\n';

function withSkills(system, skills, named = []) {
  const active = skills.filter((skill) => skillMode(skill) === 'always' || named.includes(skill.name));
  if (!active.length) return system;
  const text = active.map((skill) => `<skill name=${JSON.stringify(skill.name)}>\n${skill.text}\n</skill>`).join('\n');
  return `${system}${USER_SKILLS_HEADING}${text}`;
}

// For the Agent, which can also pick a skill itself when the words alone do not show it.
function skillCatalog(skills, active = []) {
  const rest = skills.filter((skill) => skillMode(skill) === 'auto' && !active.includes(skill.name));
  if (!rest.length) return '';
  const lines = rest.map((skill) => `- ${skill.name}${skill.description ? `: ${skill.description}` : ''}`).join('\n');
  return `\n\nMore skills you can load with use_skill if one fits the task:\n${lines}`;
}

function findSkill(skills, name) {
  return skills.find((skill) => skill.name === name && skillMode(skill) !== 'off');
}

// Facts the person agreed to keep, listed in Settings > AI where they can be deleted.
function withMemory(system, facts = []) {
  if (!facts.length) return system;
  return `${system}\n\nThings the person asked you to remember:\n${facts.map((fact) => `- ${fact.text}`).join('\n')}`;
}

const MAX_NAME = 24;

// The name the person gave their pet, which is also the AI they talk to.
function withName(system, name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return clean ? `${system}\n\nThe person named you ${clean}. Use that name when you speak about yourself.` : system;
}

module.exports = {
  chooseSkills, findSkill, skillCatalog, skillMode, withMemory, withName, withSkills,
};
