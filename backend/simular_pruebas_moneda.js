// Script para enviar 3 pruebas completas de Webhook a Proteo:
// 1. Cotización (Status 11) en USD (18.50)
// 2. Pedido (Status 38) en MXN (1.00)
// 3. Pedido Invoiced (Status 7) en USD (19.20)

require('dotenv').config();
const http = require('http');

const token = process.env.PS_TOKEN;
const port = parseInt(process.env.PORT) || 3001;

function sendWebhook(title, payloadObj) {
  return new Promise((resolve) => {
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

    console.log(`\n=======================================================`);
    console.log(`🚀 PRUEBA: ${title}`);
    console.log(`- Folio: ${payloadObj.data.OrderNumber}`);
    console.log(`- Estatus: ${payloadObj.data.StatusName} (StatusId: ${payloadObj.data.StatusId})`);
    console.log(`- Currency: "${payloadObj.data.Currency}"`);
    console.log(`- CurrencyRate: "${payloadObj.data.CurrencyRate}"`);
    console.log(`=======================================================`);

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        console.log(`📥 Respuesta Servidor (Status ${res.statusCode}): ${responseData}`);
        resolve();
      });
    });

    req.on('error', (e) => {
      console.error(`❌ Error en petición: ${e.message}`);
      resolve();
    });

    req.write(JSON.stringify(payloadObj));
    req.end();
  });
}

async function runAllTests() {
  const rand1 = Math.floor(1000 + Math.random() * 9000);
  const rand2 = Math.floor(1000 + Math.random() * 9000);
  const rand3 = Math.floor(1000 + Math.random() * 9000);

  // 1. Cotización en Dólares (Status 11)
  await sendWebhook("1. Cotización en Dólares (Status 11)", {
    object: "orders",
    key: { OrderNumber: `COT-USD-${rand1}` },
    data: {
      Id: 88000 + rand1,
      OrderNumber: `COT-USD-${rand1}`,
      StatusId: 11,
      StatusName: "QUOTE",
      Currency: "USD|es-US",
      CurrencyRate: "18.50",
      TotalAmount: "500.00",
      TotalTax: "80.00",
      CustomerId: { CustomerNumber: "15" },
      details: [{ ProductId: "TESTSKU01", QtyOrdered: "1.00", Price: "500.00" }]
    }
  });

  // 2. Pedido en Pesos (Status 38)
  await sendWebhook("2. Pedido en Pesos (Status 38)", {
    object: "orders",
    key: { OrderNumber: `PED-MXN-${rand2}` },
    data: {
      Id: 88000 + rand2,
      OrderNumber: `PED-MXN-${rand2}`,
      StatusId: 38,
      StatusName: "PROCESSED",
      Currency: "MXN|es-MX",
      CurrencyRate: "1.00",
      TotalAmount: "1200.00",
      TotalTax: "192.00",
      CustomerId: { CustomerNumber: "15" },
      details: [{ ProductId: "TESTSKU01", QtyOrdered: "1.00", Price: "1200.00" }]
    }
  });

  // 3. Pedido Invoiced en Dólares (Status 7)
  await sendWebhook("3. Pedido Invoiced en Dólares (Status 7 - INVOICED)", {
    object: "orders",
    key: { OrderNumber: `INV-USD-${rand3}` },
    data: {
      Id: 88000 + rand3,
      OrderNumber: `INV-USD-${rand3}`,
      StatusId: 7,
      StatusName: "INVOICED",
      Currency: "USD|es-US",
      CurrencyRate: "19.20",
      PaymentMethod: "PPD",
      TotalAmount: "2500.00",
      TotalTax: "400.00",
      CustomerId: { CustomerNumber: "999" },
      invoice: { CfdiUse: "G03", PaymentMethod: "PPD" },
      details: [{ ProductId: "TESTSKU01", QtyOrdered: "1.00", Price: "2500.00" }]
    }
  });

  console.log(`\n✅ Pruebas finalizadas.`);
}

runAllTests();
