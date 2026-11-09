// Vercel entry point: every /api/* request is handled here by the same code as the Node server.
// The web pages in public/ are served directly by Vercel's CDN (see vercel.json).
// Vercel runs in UTC and reserves TZ; dates (today, due dates, reports) must be in the workshop's time.
process.env.TZ = process.env.APP_TZ || 'Australia/Sydney';
const app = require('../server/server.js');

module.exports = async (req, res) => {
  try {
    await app.ready();
  } catch (e) {
    console.error('Could not load data:', e.message);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `The server could not reach the database: ${e.message}` }));
  }
  return app.handle(req, res);
};
