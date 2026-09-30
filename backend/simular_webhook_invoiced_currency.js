// Script de simulación para verificar estatus INVOICED, Currency, CurrencyRate y reglas SAT en Proteo
require('dotenv').config();
const http = require('http');

const token = process.env.PS_TOKEN;
const port = parseInt(process.env.PORT) || 3001;

// Configuración de la petición HTTP hacia el Webhook local
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

// Generamos folio aleatorio para la prueba
const randomNum = Math.floor(1000 + Math.random() * 9000);
const orderNo = `SIMINVOICE${randomNum}`;

const payloadObj = {
  object: "orders",
  key: {
    OrderNumber: orderNo
  },
  data: {
    Id: 77000 + randomNum,
    OrderNumber: orderNo,
    OrderDate: new Date().toISOString().split('T')[0],
    TotalQty: "1.00",
    TotalAmount: "1500.00",
    TotalTax: "240.00",
    OrderType: "NORMAL",
    StatusId: 7,
    StatusName: "INVOICED",
    Comments: "Pedido simulado para prueba de INVOICED / SAT / Currency",
    
    // Pruebas de Moneda y Tipo de Cambio
    Currency: "USD|es-US",       // Se espera mapeo a 2 (Dólares)
    CurrencyRate: "18.50",       // Se espera mapeo numérico de tipo de cambio
    
    // Método de pago desde PowerSales
    PaymentMethod: "PPD",        // Se espera IDMetodoPagoSAT = 'PPD' e IDFormaPagoSAT = '99'
    
    CustomerId: {
      Id: 18,
      CustomerNumber: "999",     // Cliente 999 (Nota de Venta) -> Forzará PUE, S01, IVA 0%
      Name: "CLIENTE DE PRUEBA NOTA DE VENTA",
      TIN: "XAXX010101000"
    },
    RepId: {
      Id: 3,
      EmployeeNumber: "2",
      FirstName: "ALEJANDRO",
      UserName: "A.PACHECO"
    },
    invoice: {
      CfdiUse: "G03",
      paymentTypeSAT: "03",
      PaymentMethod: "PPD"
    },
    details: [
      {
        Id: 101,
        ProductId: "TESTSKU01",
        ProductCode: "TESTSKU01",
        QtyOrdered: "1.00",
        Price: "1500.00",
        SubTotalAmount: "1260.00",
        TotalAmount: "1500.00"
      }
    ]
  }
};

const payload = JSON.stringify(payloadObj);

console.log(`=======================================================`);
console.log(`🚀 ENVIANDO WEBHOOK SIMULADO`);
console.log(`- Folio Pedido: ${orderNo}`);
console.log(`- Status: ${payloadObj.data.StatusName} (Id: ${payloadObj.data.StatusId})`);
console.log(`- Currency en Payload: "${payloadObj.data.Currency}" (Debe convertirse a 2)`);
console.log(`- CurrencyRate en Payload: "${payloadObj.data.CurrencyRate}"`);
console.log(`- CustomerNumber: "${payloadObj.data.CustomerId.CustomerNumber}"`);
console.log(`- PaymentMethod: "${payloadObj.data.PaymentMethod}"`);
console.log(`=======================================================\n`);

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log(`📥 Respuesta del Servidor (HTTP Status: ${res.statusCode}):`);
    try {
      console.log(JSON.stringify(JSON.parse(responseData), null, 2));
    } catch {
      console.log(responseData);
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Error al enviar la petición webhook: ${e.message}`);
});

req.write(payload);
req.end();
