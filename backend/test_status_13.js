// Test script to send order status with StatusId: 13 and check if it updates to Surtido Completo
require('dotenv').config();
const https = require('https');

const token = process.env.PS_TOKEN || '438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd';
const baseUrl = process.env.PS_BASE_URL || 'https://api.dev.powersales.cloud/api/grupoascencio';

const urlObj = new URL(baseUrl);
const hostname = urlObj.hostname;
const basePath = urlObj.pathname + '/orders';

// Probamos con StatusId: 13 (Surtido Completo)
const orderId = 114;
const orderNumberIpad = 'VIC00000102W';

const payload = {
  Id: orderId,
  StatusId: 13, // Test ID 13
  StatusName: '13 Surtido Completo',
  OrderNumberIPAD: orderNumberIpad,
  IDPedidoEnc: orderId,
  Employee: 3,
  ExternalReference: orderNumberIpad,
  ModifiedDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
  OrdersDetails: [
    {
      "Id": 138,
      "ProductId": "1020625",
      "ProductCode": "1020625",
      "QtyOrdered": "2.00",
      "QtyDelivered": "0.00",
      "QtyPicked": "2.00",
      "Price": "79.64",
      "SubTotalAmount": "159.28",
      "TotalAmount": "159.28",
      "UniqueId": "11442332026-08-05 10:16:06",
      "WarehouseId": "1"
    },
    {
      "Id": 137,
      "ProductId": "1020632",
      "ProductCode": "1020632",
      "QtyOrdered": "1.00",
      "QtyDelivered": "0.00",
      "QtyPicked": "1.00",
      "Price": "99.16",
      "SubTotalAmount": "99.16",
      "TotalAmount": "99.16",
      "UniqueId": "11442332026-08-05 10:16:06",
      "WarehouseId": "1"
    }
  ]
};

console.log(`Probando actualización con StatusId: 13`);
const postData = JSON.stringify({ data: payload });

const options = {
  hostname: hostname,
  path: basePath,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(postData),
    'Accept': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let responseBody = '';
  res.on('data', (chunk) => { responseBody += chunk; });
  res.on('end', () => {
    console.log(`\n=== RESPUESTA DEL SERVIDOR (HTTP ${res.statusCode}) ===`);
    try {
      const parsed = JSON.parse(responseBody);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(responseBody);
    }
  });
});

req.on('error', (e) => {
  console.error(`Error: ${e.message}`);
});

req.write(postData);
req.end();
