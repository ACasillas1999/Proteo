// Script para probar el sincronizador con el pedido 554657
require('dotenv').config();
const surtidopedido = require('./src/handlers/surtidopedido');
const ps = require('./src/powersales');

(async () => {
  try {
    console.log('=== Iniciando prueba con Pedido 554657 (PS ID: 117) ===');
    const cambio = {
      clave_registro: '554657', // Folio 117
      campos_modificados: 'FULLY_PICKED'
    };

    const payload = await surtidopedido.sync(cambio);
    
    // Cast a enteros por seguridad
    payload.Id = Number(payload.Id);
    payload.IDPedidoEnc = Number(payload.IDPedidoEnc);
    
    console.log('\n=== PAYLOAD ENVIADO ===');
    console.log(JSON.stringify(payload, null, 2));

    const response = await ps.post('/orders', { data: payload });
    console.log('\n=== RESPUESTA DEL SERVIDOR DE POWERSALES ===');
    console.log(JSON.stringify(response.data, null, 2));

  } catch (err) {
    console.error('\n❌ ERROR:', err);
  } finally {
    process.exit(0);
  }
})();
