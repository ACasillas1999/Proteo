const axios = require('axios');
const mysql = require('mysql2/promise');

(async () => {
  try {
    const res = await axios.get('http://192.168.60.42:3005/api/sync-history?entidad=surtidopedido&limit=25');
    const items = res.data.data;
    
    const conn = await mysql.createConnection({
      host: '192.168.60.42',
      port: 3306,
      user: 'root',
      password: 'cga3026',
      database: 'aiesa_qa'
    });

    for (const item of items) {
      const datos = typeof item.datos === 'string' ? JSON.parse(item.datos) : item.datos;
      const details = datos.OrdersDetails || [];
      console.log(`\n======================================================`);
      console.log(`Sync ID: ${item.id} | Cambio ID: ${item.cambio_id} | Folio: ${item.clave_registro} | Status: ${datos.StatusName} | Items en Payload: ${details.length} | Fecha Sync: ${item.fecha_sync}`);
      
      // Consultar dtpedvta
      const [dt] = await conn.query('SELECT No_Pedido, Cve_Articulo, Cant_Pedida, Cant_Facturada FROM dtpedvta WHERE No_Pedido = ?', [item.clave_registro]);
      // Consultar surtido
      const [surt] = await conn.query('SELECT PedidoEC, Folio, Articulo, Cantidad, Faltante, Entregada, Ubicacion, Fecha, HoraInicial, HoraFinal FROM surtido WHERE Folio = ?', [item.clave_registro]);
      
      console.log('-- dtpedvta (' + dt.length + ' partidas) --');
      dt.forEach(r => console.log(`   Art: ${r.Cve_Articulo} | Pedida: ${r.Cant_Pedida} | Facturada: ${r.Cant_Facturada}`));
      
      console.log('-- surtido (' + surt.length + ' filas) --');
      surt.forEach(r => console.log(`   Art: ${r.Articulo} | Cant: ${r.Cantidad} | Entregada: ${r.Entregada} | Faltante: ${r.Faltante} | Ubicacion: ${r.Ubicacion} | HoraIni: ${r.HoraInicial} | HoraFin: ${r.HoraFinal}`));

      console.log('-- Enviado en Payload (' + details.length + ' items) --');
      details.forEach(d => console.log(`   SKU: ${d.ProductId} | QtyOrdered: ${d.QtyOrdered} | QtyPicked: ${d.QtyPicked}`));
    }
    await conn.end();
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();
