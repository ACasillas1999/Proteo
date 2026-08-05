// Script para probar el sincronizador surtidopedido.js con el pedido local 554654
require('dotenv').config();
const surtidopedido = require('./src/handlers/surtidopedido');

(async () => {
  try {
    console.log('=== Iniciando prueba de sincronización de surtido de pedido ===');
    const cambio = {
      clave_registro: '554654', // Folio del pedido en cbpedvta
      campos_modificados: 'FULLY_PICKED' // Nuevo estatus
    };

    console.log('Ejecutando surtidopedido.sync()...');
    const payload = await surtidopedido.sync(cambio);
    console.log('\n=== PAYLOAD ENVIADO EXITOSAMENTE ===');
    console.log(JSON.stringify(payload, null, 2));

  } catch (err) {
    console.error('\n❌ ERROR EN LA SINCRONIZACIÓN:', err);
  } finally {
    process.exit(0);
  }
})();
