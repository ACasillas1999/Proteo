'use strict';
require('dotenv').config();
const { localQuery } = require('../src/localdb');

async function main() {
  const [rows] = await localQuery('SELECT id, clave_registro, datos FROM webhook_logs WHERE entidad = "orders" ORDER BY id DESC LIMIT 15');
  for (const r of rows) {
    try {
      const d = typeof r.datos === 'string' ? JSON.parse(r.datos) : r.datos;
      console.log(`ID: ${r.id} | OrderNumber: ${d.OrderNumber} | StatusId: ${d.StatusId} | StatusName: ${d.StatusName}`);
      console.log(`   details: ${Array.isArray(d.details) ? d.details.length : 'no'} | OrdersDetails: ${Array.isArray(d.OrdersDetails) ? d.OrdersDetails.length : 'no'} | details_promo: ${Array.isArray(d.details_promo) ? d.details_promo.length : 'no'}`);
    } catch (e) {
      console.log(`ID: ${r.id} - Error parseando JSON:`, e.message);
    }
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
