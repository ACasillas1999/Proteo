// Script para simular una actualización de estatus de pedido (StatusId = 41)
require('dotenv').config();
const http = require('http');

const token = process.env.PS_TOKEN;
const port = parseInt(process.env.PORT) || 3001;

// Tomar argumentos de la línea de comandos
const args = process.argv.slice(2);
const orderNo = args[0];
const psOrderIdStr = args[1];

if (!orderNo || !psOrderIdStr) {
  console.log(`\nUso del script:`);
  console.log(`node simular_webhook_pedido_status41.js <OrderNumber> <Id>`);
  console.log(`\nEjemplo:`);
  console.log(`node simular_webhook_pedido_status41.js COT5542W 55542`);
  process.exit(1);
}

const psOrderId = parseInt(psOrderIdStr);

const options = {
  hostname: 'localhost',
  port: port,
  path: '/api/webhooks/powersales/object-update',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }
};

const payload = JSON.stringify({
  object: "orders",
  key: {
    OrderNumber: orderNo
  },
  data: {
    Id: psOrderId,
    OrderNumber: orderNo,
    StatusId: 41, // STATUS_ID = 41 (Cambiará Distribuido de 1 a 0)
    StatusName: "ENTREGADO / OTRAS ACTUALIZACIONES",
    details_promo: [
      {
        Id: 999,
        OrderId: psOrderId,
        order: {
          BranchId: 9
        }
      }
    ]
  }
});

console.log(`\n================================================================`);
console.log(`Enviando actualización de PEDIDO (StatusId: 41)`);
console.log(`Buscando Folio: ${orderNo} | ID PowerSales: ${psOrderId}`);
console.log(`================================================================`);

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log(`\nRespuesta del Servidor (Status ${res.statusCode}):`);
    console.log(responseData);
    console.log(`\nInstrucciones de verificación:`);
    console.log(`1. Verifica que el pedido con folio '${orderNo}' cambie a 'Distribuido' = 0.`);
    console.log(`2. Verifica que las tablas de cotización cbcot y dtcot NO se hayan duplicado ni alterado.`);
  });
});

req.on('error', (e) => {
  console.error(`Error de red: ${e.message}`);
});

req.write(payload);
req.end();
