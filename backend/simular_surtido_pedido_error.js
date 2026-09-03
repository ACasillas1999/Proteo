// Script para simular el envío de estatus de surtido a PowerSales y reproducir el bug del API
require('dotenv').config();
const https = require('https');

const token = process.env.PS_TOKEN;
const baseUrl = process.env.PS_BASE_URL;

// Extraemos el hostname de la URL base
const urlObj = new URL(baseUrl);
const hostname = urlObj.hostname;
const basePath = urlObj.pathname + '/orders';

// CONFIGURACIÓN DE PRUEBA: Cambia este número para probar diferentes casos:
// 1 = ProductId como String ("10295QO120")   --> Truena con: "Cannot access offset of type string on string"
// 2 = ProductId como Entero (98680)          --> Truena con: "Trying to access array offset on value of type int"
// 3 = ProductId como Objeto ({ Id: 98680 })  --> Truena con: "Undefined array key "ProductId""
// 4 = Arreglo de detalles vacío ([])         --> Exitoso (200 OK), pero BORRA todos los artículos del pedido
const TIPO_PRUEBA = 1; 

// Pedido real para la prueba (debe existir en la base de datos de PowerSales)
const orderId = 94; 
const orderNumberIpad = 'VIC00000030W'; 

let productVal1;
if (TIPO_PRUEBA === 1) {
  productVal1 = "10295QO120"; 
} else if (TIPO_PRUEBA === 2) {
  productVal1 = 98680; 
} else if (TIPO_PRUEBA === 3) {
  productVal1 = { Id: 98680 }; 
}

const payload = {
  Id: orderId,
  StatusId: 43, // FULLY_PICKED
  StatusName: 'FULLY_PICKED',
  OrderNumberIPAD: orderNumberIpad,
  IDPedidoEnc: orderId,
  Employee: 15,
  ExternalReference: orderNumberIpad,
  ModifiedDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
  OrdersDetails: TIPO_PRUEBA === 4 ? [] : [
    {
      "Id": 124,
      "ProductId": productVal1,
      "ProductCode": "10295QO120",
      "QtyOrdered": "1.00",
      "QtyDelivered": "0.00",
      "QtyPicked": "1.00",
      "Price": "579.00",
      "SubTotalAmount": "579.00",
      "TotalAmount": "671.64",
      "UniqueId": "9432215152026-08-26 08:40:24",
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
