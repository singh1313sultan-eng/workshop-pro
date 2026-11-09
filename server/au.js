// Australian rules and formats: ABN, phone numbers, postcodes, money, financial year.

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** True when an ABN (with or without spaces) passes the ATO check-digit test. */
function validAbn(v) {
  const d = String(v || '').replace(/\s+/g, '');
  if (!/^\d{11}$/.test(d)) return false;
  const n = d.split('').map(Number);
  n[0] -= 1;
  return n.reduce((s, x, i) => s + x * ABN_WEIGHTS[i], 0) % 89 === 0;
}
/** "51824753556" -> "51 824 753 556" */
const formatAbn = (v) => String(v || '').replace(/\s+/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');

/** Normalise an Australian phone number to 0XXXXXXXXX (or 13/1300/1800 numbers). Returns '' if invalid. */
function normPhone(v) {
  let p = String(v || '').replace(/[\s()-]/g, '');
  if (p.startsWith('+61')) p = '0' + p.slice(3);
  else if (p.startsWith('61') && p.length === 11) p = '0' + p.slice(2);
  if (/^0[23478]\d{8}$/.test(p)) return p;     // landlines (02/03/07/08) and mobiles (04)
  if (/^1[38]00\d{6}$/.test(p)) return p;       // 1300 / 1800
  if (/^13\d{4}$/.test(p)) return p;            // 13 xx xx
  return '';
}
const isMobile = (v) => /^04\d{8}$/.test(normPhone(v));
/** 0412345678 -> 0412 345 678, 0297481100 -> (02) 9748 1100 */
function formatPhone(v) {
  const p = normPhone(v) || String(v || '');
  if (/^04\d{8}$/.test(p)) return p.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
  if (/^0[2378]\d{8}$/.test(p)) return p.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2 $3');
  return p;
}

// first digit(s) of postcodes by state (Australia Post ranges, simplified)
const POSTCODE = {
  NSW: /^(1\d{3}|2(?!6[0-1]\d|9[0-2]\d)\d{3})$/,
  ACT: /^(02\d\d|26[0-1]\d|29[0-2]\d)$/,
  VIC: /^(3\d{3}|8\d{3})$/,
  QLD: /^(4\d{3}|9\d{3})$/,
  SA: /^5\d{3}$/,
  WA: /^6\d{3}$/,
  TAS: /^7\d{3}$/,
  NT: /^0[89]\d\d$/,
};
const STATES = Object.keys(POSTCODE);
const validPostcode = (state, pc) => (POSTCODE[state] ? POSTCODE[state].test(String(pc || '')) : /^\d{4}$/.test(String(pc || '')));

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n, currency = 'AUD', locale = 'en-AU') => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(n) || 0);

/** Australian financial year (July–June) containing a date, e.g. "FY2026-27" with start/end. */
function financialYear(date = new Date(), startMonth = 7) {
  const d = new Date(date);
  const y = d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
  const start = new Date(y, startMonth - 1, 1);
  const end = new Date(y + 1, startMonth - 1, 1);
  return { label: `FY${y}-${String(y + 1).slice(2)}`, start, end };
}
/** BAS quarter of a date (Jul–Sep = Q1 …) */
function basQuarter(date = new Date()) {
  const d = new Date(date);
  const m = d.getMonth(); // 0-based
  const qStartMonth = Math.floor(m / 3) * 3;
  const start = new Date(d.getFullYear(), qStartMonth, 1);
  const end = new Date(d.getFullYear(), qStartMonth + 3, 1);
  const fy = financialYear(d);
  const q = ((Math.floor(m / 3) + 2) % 4) + 1; // Jul-Sep -> Q1
  return { label: `${fy.label} Q${q}`, start, end };
}

module.exports = { validAbn, formatAbn, normPhone, isMobile, formatPhone, STATES, validPostcode, round2, money, financialYear, basQuarter };
