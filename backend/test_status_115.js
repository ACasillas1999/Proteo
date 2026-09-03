// Test script to send status update for order 115 with correct detail ID
require('dotenv').config();
const https = require('https');

const token = process.env.PS_TOKEN;
const baseUrl = process.env.PS_BASE_URL;

const urlObj = new URL(baseUrl);
const hostname = urlObj.hostname;
const basePath = urlObj.pathname + '/orders';

const orderId = 115;
const orderNumberIpad = 'VIC00000103W';

const payload = {
  Id: orderId,
  StatusId: 43, // FULLY_PICKED
  StatusName: 'FULLY_PICKED',
  OrderNumberIPAD: orderNumberIpad,
  IDPedidoEnc: orderId,
  Employee: 3,
  ExternalReference: orderNumberIpad,
  ModifiedDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
  OrdersDetails: [
    {
      "Id": 144, // CORRECT DETAIL ID FOR ORDER 115!
      "ProductId": "1020632",
      "ProductCode": "1020632",
      "QtyOrdered": "1.00",
      "QtyDelivered": "0.00",
      "QtyPicked": "1.00",
      "Price": "99.16",
      "SubTotalAmount": "99.16",
      "TotalAmount": "99.16",
      "UniqueId": "11542332026-08-05 16:18:06",
      "WarehouseId": "1"
    }
  ]
};

console.log(`Probando actualización de Pedido 115 (Estatus 06) a StatusId: 43`);
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
    console.log(`\n=== RESPUESTA DEL SERVIDOR DE POWERSALES ===`);
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
