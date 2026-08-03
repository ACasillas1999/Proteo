// Script para simular un Webhook de Pedido (orders) desde PowerSales a Proteo
require('dotenv').config();
const http = require('http');

const token = process.env.PS_TOKEN || '438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd';
const port = parseInt(process.env.PORT) || 3001;

// Configuración de la petición
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

// Generamos un folio aleatorio para evitar colisiones en pruebas
const randomNum = Math.floor(1000 + Math.random() * 9000);
const orderNo = `VIC00000${randomNum}W`;

const payload = JSON.stringify({
  object: "orders",
  key: {
    OrderNumber: orderNo
  },
  data: {
    Id: 9999 + randomNum,
    OrderNumber: orderNo,
    OrderDate: new Date().toISOString().split('T')[0],
    DeliveryDate: new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0],
    TotalQty: "1.00",
    TotalAmount: "99.16",
    PaymentType: "CONTADO",
    // Puedes probar cambiando a "ANEXO" o "NORMAL" para validar las reglas de negocio
    OrderType: "NORMAL",
    TypeSend: "Recoge",
    StatusId: 3,
    StatusName: "SIN DEFINIR",
    Comments: "Pedido de prueba simulado",
    CustomerId: {
      Id: 4,
      CustomerNumber: "15", // Debe existir en la tabla clientes (columna IdGlobal = 15)
      Name: "ALVAREZ CAZARES AZAEL SIUUUU",
      TIN: "AACA840501D60",
      Address1: "CALLE GUANAJUATO 60"
    },
    RouteId: {
      Id: 2,
      Name: "VICENTE", // Debe existir en la tabla vendedor (columna Usuario = VICENTE)
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
        Id: 102,
        ProductId: "1020632",
        ProductCode: "1020632",
        QtyOrdered: "1.00",
        Price: "99.16",
        SubTotalAmount: "99.16",
        TotalAmount: "99.16",
        UniqueId: `8342332026-${randomNum}`,
        Warehouse: "GENERAL",
        WarehouseId: "1"
      }
    ],
    details_promo: [
      {
        Id: 102,
        OrderId: 9999 + randomNum,
        ProductId: 316,
        order: {
          BranchId: 9 // Se procesará en la sucursal 9
        }
      }
    ]
  }
});

console.log(`Enviando webhook de pedido simulado (${orderNo})...`);

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log(`\nRespuesta del Servidor (Status ${res.statusCode}):`);
    console.log(responseData);
  });
});

req.on('error', (e) => {
  console.error(`Problema con la petición: ${e.message}`);
});

req.write(payload);
req.end();
