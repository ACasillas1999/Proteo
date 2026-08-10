require('dotenv').config({ path: '../.env' });
const { localQuery } = require('../src/localdb');

const cabMappings = {
  'OrderDate': 'Fecha',
  'DeliveryDate': 'Fech_Entrega',
  'DeliveryDateReal': 'Fech_Entrega',
  'TotalAmount': 'Total',
  'TotalTax': 'IVA_Porcentaje',
  'PaymentType': 'Cond_Pago',
  'Comments': 'Observaciones',
  'CreatedDate': 'Fecha_Captura',
  'CustomerId.CustomerNumber': 'Cve_Cte',
  'RepId.Id': 'Cve_Atendio',
  'RouteId.Name': 'Cve_Atendio'
};

const detMappings = {
  'ProductCode': 'Cve_Art',
  'ProductId': 'Cve_Art',
  'QtyOrdered': 'Cant_Pedida',
  'Price': 'Costo_Unitario',
  'Discount1': 'Descuento',
  'CreatedDate': 'Fech_Captura'
};

async function run() {
  try {
    console.log('Clearing existing mappings for cotizaciones...');
    await localQuery("DELETE FROM field_mapping WHERE entity IN ('cotizacion_cabecera', 'cotizacion_detalle')");

    console.log('Inserting cotizacion_cabecera mappings...');
    for (const [psField, erpCol] of Object.entries(cabMappings)) {
      await localQuery(
        "INSERT INTO field_mapping (entity, ps_field, erp_column) VALUES (?, ?, ?)",
        ['cotizacion_cabecera', psField, erpCol]
      );
    }

    console.log('Inserting cotizacion_detalle mappings...');
    for (const [psField, erpCol] of Object.entries(detMappings)) {
      await localQuery(
        "INSERT INTO field_mapping (entity, ps_field, erp_column) VALUES (?, ?, ?)",
        ['cotizacion_detalle', psField, erpCol]
      );
    }

    console.log('✓ Seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error during seeding:', err);
    process.exit(1);
  }
}

run();
