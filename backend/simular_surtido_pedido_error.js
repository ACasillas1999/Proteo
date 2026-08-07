// Script para simular el envío de estatus de surtido a PowerSales y reproducir el bug del API
require('dotenv').config();
const https = require('https');

const token = process.env.PS_TOKEN || '438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd';
const baseUrl = process.env.PS_BASE_URL || 'https://api.dev.powersales.cloud/api/grupoascencio';

// Extraemos el hostname de la URL base
const urlObj = new URL(baseUrl);
const hostname = urlObj.hostname;
const basePath = urlObj.pathname + '/orders';

// CONFIGURACIÓN DE PRUEBA: Cambia este número para probar diferentes casos:
// 1 = ProductId como String ("1020632")      --> Truena con: "Cannot access offset of type string on string"
// 2 = ProductId como Entero (316)            --> Truena con: "Trying to access array offset on value of type int"
// 3 = ProductId como Objeto ({ Id: 316 })    --> Truena con: "Undefined array key "ProductId""
// 4 = Arreglo de detalles vacío ([])         --> Exitoso (200 OK), pero BORRA todos los artículos del pedido
const TIPO_PRUEBA = 1; 

// Pedido real para la prueba (debe existir en la base de datos de PowerSales)
const orderId = 114; 
const orderNumberIpad = 'VIC00000102W'; 

let productVal1, productVal2;
if (TIPO_PRUEBA === 1) {
  productVal1 = "1020625"; 
  productVal2 = "1020632";
} else if (TIPO_PRUEBA === 2) {
  productVal1 = 315; 
  productVal2 = 316;
} else if (TIPO_PRUEBA === 3) {
  productVal1 = { Id: 315 }; 
  productVal2 = { Id: 316 };
}

const payload = {
  Id: orderId,
  StatusId: 43, // FULLY_PICKED
  StatusName: 'FULLY_PICKED',
  OrderNumberIPAD: orderNumberIpad,
  IDPedidoEnc: orderId,
  Employee: 3,
  ExternalReference: orderNumberIpad,
  ModifiedDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
  OrdersDetails: TIPO_PRUEBA === 4 ? [] : [
    {
      "Id": 138,
      "ProductId": productVal1,
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
      "ProductId": productVal2,
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

console.log(`Enviando petición a: https://${hostname}${basePath}`);
console.log(`Tipo de prueba seleccionada: ${TIPO_PRUEBA}`);
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
      if (parsed.message && parsed.exception) {
        console.log(`Laravel Error: ${parsed.message}`);
        console.log(`File: ${parsed.file}`);
        console.log(`Line: ${parsed.line}`);
      } else {
        console.log(JSON.stringify(parsed, null, 2));
      }
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
