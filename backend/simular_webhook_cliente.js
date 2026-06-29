// Script para simular un Webhook de Cliente desde PowerSales a Proteo
const http = require('http');

// Configuración de la petición
const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/webhooks/powersales/object-update',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // Token del .env
    'Authorization': 'Bearer 438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd'
  }
};

const payload = JSON.stringify({
  object: "customers",
  key: {
    CustomerNumber: "1282"
  },
  "data": {
    "Email": "demo@grupoascencio.com.mx"
  }
});

console.log("Enviando webhook de cliente simulado...");

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log(`\nRespuesta del Servidor (Status ${res.statusCode}):`);
    console.log(responseData);
  });
});

req.on('error', (e) => {
  console.error(`Problema con la petición: ${e.message}`);
});

// Escribimos los datos en el cuerpo de la petición
req.write(payload);
req.end();
