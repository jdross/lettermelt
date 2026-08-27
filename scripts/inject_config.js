#!/usr/bin/env node
'use strict';

const fs = require('fs');

const target = process.argv[2];
if (!target) throw new Error('Usage: inject_config.js <index.html>');

function attribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
