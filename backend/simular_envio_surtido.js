'use strict';
/**
 * =====================================================================================
 *                            SIMULADOR DE ENVÍO DE SURTIDO
 * =====================================================================================
 * Archivo: simular_envio_surtido.js
 * 
 * DESCRIPCIÓN:
 * Este script te permite simular y visualizar el payload JSON exacto que Proteo
 * envía a la API de PowerSales al sincronizar un pedido:
 *   - Estatus 43 (FULLY_PICKED / Surtido Completado)
 *   - Estatus 6  (PARTIALLY_PICKED / Surtido Parcial)
 * 
 * FORMAS DE USO DESDE LA TERMINAL (Comandos):
 * -------------------------------------------------------------------------------------
 * 1. Simulación automática (FULLY_PICKED / Estatus 43 por defecto):
 *    node simular_envio_surtido.js
 * 
 * 2. Simulación para Estatus 6 (PARTIALLY_PICKED / Surtido Parcial):
 *    node simular_envio_surtido.js --partial
 *    o especificando el folio:
 *    node simular_envio_surtido.js 334821 --partial
 * 
 * 3. Envío REAL en vivo a PowerSales:
 *    node simular_envio_surtido.js 334821 --live
 *    node simular_envio_surtido.js 334821 --partial --live
 * -------------------------------------------------------------------------------------
 */

require('dotenv').config();
const { query } = require('./src/db');
const surtidopedido = require('./src/handlers/surtidopedido');
const ps = require('./src/powersales');

(async () => {
  try {
    const args = process.argv.slice(2);
    const isLive = args.includes('--live');
    const isPartial = args.includes('--partial');
    const paramPedido = args.find(a => a !== '--live' && a !== '--partial');

    const targetStatusStr = isPartial ? 'PARTIALLY_PICKED' : 'FULLY_PICKED';
    const targetStatusId = isPartial ? 6 : 43;

    console.log('=====================================================');
    console.log(`  SIMULADOR DE ENVÍO DE SURTIDO (STATUS ${targetStatusId} - ${targetStatusStr})`);
    console.log('=====================================================');
    console.log(`Modo de ejecución: ${isLive ? '🔴 EN VIVO (Envía a PowerSales)' : '🟢 SIMULACIÓN (Solo muestra JSON)'}`);

    let noPedidoTarget = paramPedido;

    if (!noPedidoTarget) {
      const [latest] = await query('SELECT No_Pedido, IDPs FROM cbpedvta ORDER BY No_Pedido DESC LIMIT 1');
      if (!latest.length) {
        console.error('❌ No se encontraron pedidos en la tabla cbpedvta.');
        process.exit(1);
      }
      noPedidoTarget = latest[0].No_Pedido;
      console.log(`ℹ️ No se especificó No_Pedido. Usando el último pedido encontrado: ${noPedidoTarget} (IDPs: ${latest[0].IDPs})`);
    } else {
      console.log(`ℹ️ Pedido seleccionado: ${noPedidoTarget}`);
    }

    // 1. Consultar partidas en ERP (dtpedvta)
    const [dtRows] = await query('SELECT * FROM dtpedvta WHERE No_Pedido = ?', [noPedidoTarget]);
    console.log(`\n📦 Partidas en ERP (dtpedvta) encontradas: ${dtRows.length}`);
    dtRows.forEach((r, idx) => {
      console.log(`  [${idx + 1}] Artículo: ${r.Cve_Articulo} | Cant. Pedida: ${r.Cant_Pedida} | Cant. Facturada: ${r.Cant_Facturada} | Costo Unitario: ${r.Costo_Unitario}`);
    });

    // 2. Construir objeto del evento de cambio
    const cambio = {
      clave_registro: noPedidoTarget,
      campos_modificados: targetStatusStr
    };

    let sentPayload = null;

    if (!isLive) {
      ps.post = async (path, body) => {
        sentPayload = body.data;
        return { data: { ok: 1, message: 'Simulado exitosamente' } };
      };
    }

    console.log(`\n⚙️ Ejecutando surtidopedido.sync() con estatus '${targetStatusStr}'...`);
    const resultPayload = await surtidopedido.sync(cambio);
    const finalPayload = sentPayload || resultPayload;

    console.log('\n=====================================================');
    console.log(`       JSON GENERADO PARA ENVIAR A POWERSALES (StatusId: ${finalPayload.StatusId})`);
    console.log('=====================================================');
    console.log(JSON.stringify(finalPayload, null, 2));
    console.log('=====================================================\n');

    if (!isLive) {
      console.log('💡 TIP: Para probar con surtido parcial (Estatus 6), ejecuta:');
      console.log(`   node simular_envio_surtido.js ${noPedidoTarget} --partial\n`);
    } else {
      console.log('✅ Enviado en vivo a PowerSales.');
    }

  } catch (err) {
    console.error('\n❌ ERROR EN LA SIMULACIÓN:', err.message);
    if (err.stack) console.error(err.stack);
  } finally {
    process.exit(0);
  }
})();
