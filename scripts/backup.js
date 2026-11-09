// Command-line backup: node scripts/backup.js  -> backups/workshop-pro-YYYY-MM-DD-HHMM.json
// Reads Supabase (when .env has the keys) or data/db.json. Schedule it daily (Task Scheduler / cron).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); }
(async () => {
  let data;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.STORAGE !== 'file') {
    const Store = require('../server/store/supabase');
    data = await new Store({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY }).load();
  } else {
    data = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'db.json'), 'utf8'));
  }
  if (!data) throw new Error('No data found');
  const dir = path.join(root, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = path.join(dir, `workshop-pro-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ format: 'workshop-pro-backup', version: 1, createdAt: new Date().toISOString(), workshop: data.workshop && data.workshop.name, data }));
  // keep the newest 30
  const old = fs.readdirSync(dir).filter((f) => /^workshop-pro-.*\.json$/.test(f)).sort().reverse().slice(30);
  old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
  console.log(`Backup written: ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
})().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
