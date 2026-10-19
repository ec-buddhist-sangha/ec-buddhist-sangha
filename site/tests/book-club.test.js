const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const { nextMeeting, formatDate } = require('../static/js/book-club.js');
const data = require('../data/mission_majjhima.json');

test('next reading stays visible during the meeting, then advances at its end', () => {
  assert.equal(nextMeeting(data.meetings, Date.parse('2026-10-19T12:00:00Z')).n, 1);
  assert.equal(nextMeeting(data.meetings, Date.parse('2026-11-06T01:15:00Z')).n, 1);
  assert.equal(nextMeeting(data.meetings, Date.parse('2026-11-06T01:30:00Z')).n, 2);
  assert.equal(nextMeeting(data.meetings, Date.parse(data.meetings.at(-1).end)), null);
  assert.equal(nextMeeting([], Date.now()), null);
});

test('the saved Zoom schedule retains 7 p.m. Central across DST and valid reading/video links', () => {
  assert.equal(data.meetings.length, 110);
  const central = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  data.meetings.forEach((m, i) => {
    assert.equal(m.n, i + 1);
    assert.equal(central.format(new Date(m.start)), '19:00');
    assert.equal(Date.parse(m.end) - Date.parse(m.start), 30 * 60000);
    assert.match(m.reading, new RegExp('^https://suttacentral.net/mn' + m.n + '/'));
    assert.match(m.video, /^https:\/\/www.youtube.com\/watch\?v=[\w-]{11}$/);
    assert.match(m.title, new RegExp('^Book club: Mission Majjhima \\(' + m.n + '/152\\): '));
  });
  assert.equal(formatDate(data.meetings[0].start), 'Thursday, November 5, 2026');
});

test('page renders the next reading and safely handles titles and missing future dates', () => {
  const altered = JSON.parse(JSON.stringify(data));
  altered.meetings[0].end = '2099-01-01T00:00:00Z';
  altered.meetings[0].title = '<img src=x onerror=alert(1)>';
  const dom = new JSDOM('<div id="book-club-next"></div><script id="book-club-data" type="application/json"></script>', { runScripts: 'outside-only' });
  dom.window.document.getElementById('book-club-data').textContent = JSON.stringify(altered);
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../static/js/book-club.js'), 'utf8'));
  const root = dom.window.document.getElementById('book-club-next');
  assert.equal(root.querySelector('h3').textContent, altered.meetings[0].title);
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelector('a').href, altered.meetings[0].reading);
  dom.window.close();
});
