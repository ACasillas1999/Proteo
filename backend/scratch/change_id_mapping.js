require('dotenv').config({ path: '../.env' });
const { localQuery } = require('../src/localdb');

async function run() {
  try {
    console.log('Updating mappings in local DB...');
    
    // 1. Delete mapping of 'Id' for entity 'pedido_cabecera'
    await localQuery(
      "DELETE FROM field_mapping WHERE entity = 'pedido_cabecera' AND ps_field = 'Id'"
    );
    console.log("✓ Deleted 'Id' mapping from 'pedido_cabecera'.");

    // 2. Insert or update mapping of 'OrderNumber' to 'IDPs' for entity 'pedido_cabecera'
    // First check if it exists
    const [existing] = await localQuery(
      "SELECT id FROM field_mapping WHERE entity = 'pedido_cabecera' AND ps_field = 'OrderNumber'"
    );

    if (existing.length > 0) {
      await localQuery(
        "UPDATE field_mapping SET erp_column = 'IDPs' WHERE id = ?",
        [existing[0].id]
      );
    } else {
      await localQuery(
        "INSERT INTO field_mapping (entity, ps_field, erp_column) VALUES ('pedido_cabecera', 'OrderNumber', 'IDPs')"
      );
    }
    console.log("✓ Mapped 'OrderNumber' to 'IDPs' in 'pedido_cabecera'.");

    console.log('✓ Seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('Error updating mapping:', err);
    process.exit(1);
  }
}

run();
