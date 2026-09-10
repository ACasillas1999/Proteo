const https = require('https');
const fs = require('fs');

const url = process.env.PS_BASE_URL ? (process.env.PS_BASE_URL.replace(/\/+$/, '') + '/docs/api-docs.json') : 'https://apidev.ventaruta.net/docs/api-docs.json';

console.log('Fetching swagger from:', url);
https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Available paths:', Object.keys(json.paths));
      for (const [path, methods] of Object.entries(json.paths)) {
        if (path.includes('warehouse') || path.includes('inventory')) {
          console.log('\n=== PATH:', path, '===');
          console.log(JSON.stringify(methods, null, 2));
        }
      }
    } catch(e) { console.error('Parse error:', e.message); }
  });
}).on('error', err => console.error(err));
