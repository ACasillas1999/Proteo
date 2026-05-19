// Script para simular un Webhook desde PowerSales a Proteo
const http = require('http');

// Configuración de la petición
const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/webhooks/powersales/object-update',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // Asegúrate de que este token sea igual al PS_TOKEN de tu archivo .env
    'Authorization': 'Bearer 438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd'
  }
};

// JSON idéntico al que enviaría PowerSales
const payload = JSON.stringify({
  object: "products",
  key: {
    SKU: "10243CTHW1/0" // Cambia este SKU por el que quieras probar
  },
  data: {
    "SKU": "10243CTHW1/0",
    "Name": "PRUEBA COOL",
    "ShortName": "PRUEBA COOL",
    "Description": "PRUEBA COOL",
    "DescriptionHTML": "PRUEBA COOL",
    "Barcode": null,
    "BarCode2": null,
    "BarCode3": null,
    "Cost": "0",
    "IsActive": 1,
    "UnitsPerBox": null,
    "CasePerPallet": null,
    "ConversionFactor": 0,
    "ClaveSat": "26121600",
    "ProductCode": "10243CTHW1/0",
    "LoyaltyPct": null,
    "BrandId": "10243",
    "SubBrandId": null,
    "LineId": "123",
    "BranchId": null,
    "CategoryId": "1CWD",
    "SubCategoryId": null,
    "ProductType": null,
    "IsPMRequired": null,
    "IsDecimal": null
  }
});

console.log("Enviando webhook simulado...");

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log(`\nRespuesta del Servidor (Status ${res.statusCode}):`);
    console.log(responseData);
    console.log("\nAqui ya esta en nuestro servidor.");
  });
});

req.on('error', (e) => {
  console.error(`Problema con la petición: ${e.message}`);
});

// Escribimos los datos en el cuerpo de la petición
req.write(payload);
req.end();
