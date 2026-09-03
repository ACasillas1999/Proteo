require('dotenv').config();
const http = require('http');
const https = require('https');

const HOST  = process.env.TEST_HOST  || 'localhost:3001'; // o 'endpoint.grupoascencio.com.mx' para probar el túnel real
const TOKEN = process.env.PS_TOKEN;

const branchId    = process.argv[2] || '9';
const productId   = process.argv[3] || '';
const warehouseId = process.argv[4] || '';

const params = new URLSearchParams({ branch_id: branchId });
if (productId)   params.set('ProductId', productId);
if (warehouseId) params.set('WarehouseId', warehouseId);

const isHttps = HOST.includes('grupoascencio.com.mx') || process.env.TEST_HTTPS === '1';
const [hostname, port] = HOST.split(':');
const client = isHttps ? https : http;

const options = {
  hostname,
  port: port || (isHttps ? 443 : 3001),
  path: `/api/inventory?${params.toString()}`,
  method: 'GET',
  headers: { 'Authorization': `Bearer ${TOKEN}` },
};

console.log(`Consultando inventario: branch_id=${branchId} ProductId=${productId || '(todos)'} WarehouseId=${warehouseId || '(todos)'}`);

const req = client.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log(`\nStatus: ${res.statusCode}`);
    console.log(body);
  });
});

req.on('error', (e) => console.error(`Error: ${e.message}`));
req.end();
