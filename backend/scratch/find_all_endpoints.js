'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');

const url = 'https://apidev.ventaruta.net/docs/api-docs.json';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('=== TODOS LOS ENDPOINTS DE SWAGGER POWERSALES ===');
      for (const [path, methods] of Object.entries(json.paths)) {
        for (const [method, def] of Object.entries(methods)) {
          if (def.summary && (def.summary.toLowerCase().includes('inventory') || def.summary.toLowerCase().includes('product') || def.summary.toLowerCase().includes('stock') || def.summary.toLowerCase().includes('warehouse'))) {
            console.log(`${method.toUpperCase()} ${path} -> Summary: ${def.summary}`);
            if (def.parameters && def.parameters.length > 0) {
              console.log('   Params:', def.parameters.map(p => `${p.name} (${p.in}, ${p.type})`).join(', '));
            }
          }
        }
      }
    } catch(e) { console.error('Parse error:', e.message); }
  });
});
