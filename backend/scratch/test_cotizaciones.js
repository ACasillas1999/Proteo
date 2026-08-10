require('dotenv').config({ path: '../.env' });
const { handleOrderInsert } = require('../src/webhookHandlers');
const { getPool } = require('../src/db');
const { localQuery } = require('../src/localdb');

async function run() {
  const erp = getPool();
  try {
    console.log('--- STARTING INTEGRATION TEST FOR COTIZACIONES & DISTRIBUIDO ---');

    // 1. Get initial consecutives
    const [initialPed] = await erp.query("SELECT Consec_Num FROM ctrlcons WHERE Tipo = 'NPED'");
    const [initialCot] = await erp.query("SELECT Consec_Num FROM ctrlcons WHERE Tipo = 'COT'");
    console.log(`Initial consecutives - Pedidos: ${initialPed[0].Consec_Num}, Cotizaciones: ${initialCot[0].Consec_Num}`);

    // Generate unique random numbers for test
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    const orderNo = `TEST${randomNum}`;
    const psOrderId = randomNum;

    // Webhook data payload for StatusId = 11
    const payload = {
      Id: psOrderId,
      OrderNumber: orderNo,
      OrderDate: new Date().toISOString().split('T')[0],
      DeliveryDate: new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0],
      TotalQty: "2.00",
      TotalAmount: "198.32",
      PaymentType: "CONTADO",
      OrderType: "NORMAL",
      TypeSend: "Recoge",
      StatusId: 11, // COTIZADO
      StatusName: "COTIZADO",
      Comments: "Test de cotizaciones",
      CustomerId: {
        Id: 4,
        CustomerNumber: "15", // Alvarez Cazares Azael
        Name: "ALVAREZ CAZARES AZAEL SIUUUU"
      },
      RouteId: {
        Id: 2,
        Name: "VICENTE", // mapped to vendedor VICENT
        Warehouse: "1"
      },
      BranchId: {
        Id: 9,
        Number: "9",
        Name: "SUCURSAL METEPEC"
      },
      details: [
        {
          Id: 99991,
          ProductId: "1020632",
          ProductCode: "1020632",
          QtyOrdered: "2.00",
          Price: "99.16",
          TotalAmount: "198.32",
          WarehouseId: "1"
        }
      ]
    };

    console.log(`\n1. Simulating order webhook insertion with StatusId = 11 (OrderNumber: ${orderNo}, Id: ${psOrderId})...`);
    await handleOrderInsert(payload);

    // Verify quote inserted
    const [nextCot] = await erp.query("SELECT Consec_Num FROM ctrlcons WHERE Tipo = 'COT'");
    const generatedCotFolio = nextCot[0].Consec_Num;
    console.log(`\nQuote consecutive is now: ${generatedCotFolio}`);
    if (generatedCotFolio !== initialCot[0].Consec_Num + 1) {
      throw new Error("Quote consecutive did not increment!");
    }

    const [quoteRows] = await erp.query("SELECT * FROM cbcot WHERE No_Cotiza = ?", [generatedCotFolio]);
    if (quoteRows.length === 0) {
      throw new Error("Quote cabecera not found in cbcot!");
    }
    console.log("✓ Quote cabecera found:", quoteRows[0]);

    const [quoteDetailRows] = await erp.query("SELECT * FROM dtcot WHERE N_Cotizacion = ?", [generatedCotFolio]);
    if (quoteDetailRows.length === 0) {
      throw new Error("Quote detail not found in dtcot!");
    }
    console.log(`✓ Quote detail found (${quoteDetailRows.length} rows):`, quoteDetailRows[0]);

    // Verify order inserted and has Distribuido = 1
    const [nextPed] = await erp.query("SELECT Consec_Num FROM ctrlcons WHERE Tipo = 'NPED'");
    const generatedPedFolio = nextPed[0].Consec_Num;
    console.log(`\nOrder consecutive is now: ${generatedPedFolio}`);
    if (generatedPedFolio !== initialPed[0].Consec_Num + 1) {
      throw new Error("Order consecutive did not increment!");
    }

    const [orderRows] = await erp.query("SELECT * FROM cbpedvta WHERE No_Pedido = ?", [generatedPedFolio]);
    if (orderRows.length === 0) {
      throw new Error("Order cabecera not found in cbpedvta!");
    }
    console.log("✓ Order cabecera found:", orderRows[0]);
    if (orderRows[0].Distribuido !== 1) {
      throw new Error(`Expected Distribuido = 1, got: ${orderRows[0].Distribuido}`);
    }
    console.log("✓ Order has Distribuido = 1");

    // 2. Simulate webhook status update with StatusId = 3 (distribuido should go to 0)
    console.log(`\n2. Simulating status update webhook with StatusId = 3 (OrderNumber: ${orderNo}, Id: ${psOrderId})...`);
    const updatePayload = {
      ...payload,
      StatusId: 3,
      StatusName: "SIN DEFINIR"
    };

    await handleOrderInsert(updatePayload);

    // Verify order Distribuido changed to 0
    const [orderRowsUpdated] = await erp.query("SELECT * FROM cbpedvta WHERE No_Pedido = ?", [generatedPedFolio]);
    console.log("✓ Order cabecera updated:", orderRowsUpdated[0]);
    if (orderRowsUpdated[0].Distribuido !== 0) {
      throw new Error(`Expected Distribuido = 0, got: ${orderRowsUpdated[0].Distribuido}`);
    }
    console.log("✓ Order has Distribuido = 0 successfully updated!");

    // Verify quote was NOT altered or duplicated
    const [finalCot] = await erp.query("SELECT Consec_Num FROM ctrlcons WHERE Tipo = 'COT'");
    if (finalCot[0].Consec_Num !== generatedCotFolio) {
      throw new Error("Quote consecutive changed during status update!");
    }
    console.log("✓ Quote consecutive remained unchanged.");

    console.log('\n--- ALL TEST SCENARIOS COMPLETED SUCCESSFULLY ---');
    process.exit(0);
  } catch (err) {
    console.error('\n✗ TEST FAILED:', err);
    process.exit(1);
  }
}

run();
