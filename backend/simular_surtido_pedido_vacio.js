// Script para simular el envío de estatus de surtido a PowerSales en su formato "vacío" (cómo se envía actualmente)
require('dotenv').config();
const https = require('https');

const token = process.env.PS_TOKEN;
const baseUrl = process.env.PS_BASE_URL;

const urlObj = new URL(baseUrl);
const hostname = urlObj.hostname;
const basePath = urlObj.pathname + '/orders';

// Pedido real para la prueba (debe existir en la base de datos de PowerSales)
const orderId = 110; 
const orderNumberIpad = 'VIC00000098W'; 

const payload = {
  Id: orderId,
  StatusId: 43, // FULLY_PICKED
  StatusName: 'FULLY_PICKED',
  OrderNumberIPAD: orderNumberIpad,
  IDPedidoEnc: orderId,
  Employee: 3,
  ExternalReference: orderNumberIpad,
  ModifiedDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
  OrdersDetails: [] // Formato vacío actual (Succeeds but deletes items on PowerSales)
};

console.log(`Enviando petición a: https://${hostname}${basePath}`);
console.log('Enviando payload con OrdersDetails vacío...');
console.log('Payload:', JSON.stringify({ data: payload }, null, 2));

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
  console.error(`Problema con la petición: ${e.message}`);
});

req.write(postData);
req.end();
