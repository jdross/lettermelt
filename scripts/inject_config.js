#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) throw new Error('Usage: inject_config.js <index.html>');

const INVITE_TITLE = 'Play LetterMelt with me';
const INVITE_DESCRIPTION = 'Join this two-player game and melt the board together.';

function attribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function replaceMeta(html, pattern, value) {
  const next = html.replace(pattern, '$1' + attribute(value) + '$2');
  if (next === html) throw new Error('Could not update invite meta: ' + pattern);
  return next;
}

function writeInviteHtml(indexPath) {
  let html = fs.readFileSync(indexPath, 'utf8');
  html = replaceMeta(html, /(<title>)[^<]*(<\/title>)/, INVITE_TITLE);
  html = replaceMeta(html, /(<meta property="og:title" content=")[^"]*(")/, INVITE_TITLE);
  html = replaceMeta(html, /(<meta name="twitter:title" content=")[^"]*(")/, INVITE_TITLE);
  html = replaceMeta(html, /(<meta name="description" content=")[^"]*(")/, INVITE_DESCRIPTION);
  html = replaceMeta(html, /(<meta property="og:description" content=")[^"]*(")/, INVITE_DESCRIPTION);
  html = replaceMeta(html, /(<meta name="twitter:description" content=")[^"]*(")/, INVITE_DESCRIPTION);
  fs.writeFileSync(path.join(path.dirname(indexPath), 'invite.html'), html);
}

let html = fs.readFileSync(target, 'utf8');
const values = {
  'lettermelt-supabase-url': process.env.LETTER_MELT_SUPABASE_URL || '',
  'lettermelt-supabase-key': process.env.LETTER_MELT_SUPABASE_KEY || '',
  'lettermelt-multiplayer-enabled': process.env.MULTIPLAYER_ENABLED || 'true'
};
for (const [name, value] of Object.entries(values)) {
  const pattern = new RegExp('(<meta\\s+name="' + name + '"\\s+content=")[^"]*(">)');
  html = html.replace(pattern, '$1' + attribute(value) + '$2');
}
fs.writeFileSync(target, html);
writeInviteHtml(target);
