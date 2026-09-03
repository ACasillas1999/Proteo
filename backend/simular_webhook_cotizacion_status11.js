// Script para simular un Webhook de Cotización (StatusId = 11) desde PowerSales
require('dotenv').config();
const http = require('http');

const token = process.env.PS_TOKEN;
const port = parseInt(process.env.PORT) || 3001;

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

const randomNum = Math.floor(1000 + Math.random() * 9000);
const orderNo = `COT${randomNum}W`;
const psOrderId = 50000 + randomNum;

const payload = JSON.stringify({
  object: "orders",
  key: {
    OrderNumber: orderNo
  },
  data: {
    Id: psOrderId,
    OrderNumber: orderNo,
    OrderDate: new Date().toISOString().split('T')[0],
    DeliveryDate: new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0],
    TotalQty: "2.00",
    TotalAmount: "198.32",
    PaymentType: "CONTADO",
    OrderType: "NORMAL",
    TypeSend: "Recoge",
    StatusId: 11, // STATUS_ID = 11 (Cotizado / Llenará cbcot y dtcot)
    StatusName: "COTIZADO",
    Comments: "Cotización de prueba simulada",
    CustomerId: {
      Id: 4,
      CustomerNumber: "15", // Debe existir en tabla clientes (IdGlobal = 15)
      Name: "ALVAREZ CAZARES AZAEL SIUUUU"
    },
    RouteId: {
      Id: 2,
      Name: "VICENTE", // Debe existir en tabla vendedor (Usuario = VICENTE)
      Warehouse: "1"
    },
    RepId: {
      Id: 3,
      EmployeeNumber: "2",
      FirstName: "VICENTE",
      UserName: "VICENTE"
    },
    details: [
      {
        Id: 200 + randomNum,
        ProductId: "1020632",
        ProductCode: "1020632",
        QtyOrdered: "2.00",
        Price: "99.16",
        SubTotalAmount: "198.32",
        TotalAmount: "198.32",
        UniqueId: `8342332026-${randomNum}`,
        Warehouse: "GENERAL",
        WarehouseId: "1"
      }
    ],
    details_promo: [
      {
        Id: 200 + randomNum,
        OrderId: psOrderId,
        ProductId: 316,
        order: {
          BranchId: 9 // Se distribuye a la sucursal 9
        }
      }
    ]
  }
});

console.log(`\n================================================================`);
console.log(`Enviando webhook de COTIZACIÓN (StatusId: 11)`);
console.log(`Folio: ${orderNo} | ID PowerSales: ${psOrderId}`);
console.log(`================================================================`);

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log(`\nRespuesta del Servidor (Status ${res.statusCode}):`);
    console.log(responseData);
    console.log(`\nInstrucciones de verificación:`);
    console.log(`1. Verifica que la cotización aparezca en la tabla cbcot y dtcot.`);
    console.log(`2. Verifica que el pedido aparezca en cbpedvta y dtpedvta con 'Distribuido' = 1.`);
    console.log(`3. Guarda el ID PowerSales (${psOrderId}) y Folio (${orderNo}) para simular la actualización posterior.`);
  });
});

req.on('error', (e) => {
  console.error(`Error de red: ${e.message}`);
});

req.write(payload);
req.end();
