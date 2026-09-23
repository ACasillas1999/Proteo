'use strict';
require('dotenv').config();
const axios = require('axios');

// =============================================================================
// SCRIPT DE PRUEBA: POST A POWERSALES (CURRENCYEXCHANGE)
// =============================================================================

// Campos exactos según la estructura de PowerSales:
const TEST_DATA = {
  Currency: "USD",
  Rate: "18.0100",
  RateBuy: "0.0000",
  RateSell: "0.0000",
  Date: "2026-09-23",
  CurrencyBase: "MXN",
  CreatedBy: 15
};

// URL objetivo
const TARGET_URL = process.env.PS_BASE_URL 
  ? `${process.env.PS_BASE_URL}/currencyexchange`
  : "https://api.qa.powersales.cloud/api/grupoascencio/currencyexchange";

const TOKEN = process.env.PS_TOKEN || "438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd";

async function enviarPost() {
  console.log("=================================================================");
  console.log(`🚀 ENVIANDO PETICIÓN POST A POWERSALES`);
  console.log("=================================================================");
  console.log(`📍 URL Target: ${TARGET_URL}`);
  console.log(`🔑 Token Auth: Bearer ${TOKEN.substring(0, 15)}...`);
  console.log(`📦 Payload enviado:`, JSON.stringify(TEST_DATA, null, 2));
  console.log("-----------------------------------------------------------------");
  console.log("Esperando respuesta del servidor de PowerSales...");

  const t0 = Date.now();

  try {
    const response = await axios.post(TARGET_URL, TEST_DATA, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 35000 // 35 segundos de timeout máximo
    });

    const ms = Date.now() - t0;
    console.log("\n=================================================================");
    console.log(`✅ ¡RESPUESTA EXITOSA DEL SERVIDOR! (${ms} ms)`);
    console.log("=================================================================");
    console.log(`📊 HTTP Status Code: ${response.status} ${response.statusText}`);
    console.log(`📄 Respuesta (JSON Data):`);
    console.log(JSON.stringify(response.data, null, 2));
    console.log("=================================================================");

  } catch (error) {
    const ms = Date.now() - t0;
    console.log("\n=================================================================");
    console.log(`❌ EL SERVIDOR RESPONDIÓ CON ERROR O TIMEOUT (${ms} ms)`);
    console.log("=================================================================");

    if (error.response) {
      console.log(`📊 HTTP Status Code: ${error.response.status} ${error.response.statusText}`);
      console.log(`📄 Respuesta del Servidor (Error Data):`);
      console.log(JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.log(`⚠️ Sin respuesta del servidor (Timeout alcanzado tras ${ms} ms)`);
      console.log(`Detalle: ${error.message}`);
    } else {
      console.log(`⚠️ Error en la configuración: ${error.message}`);
    }
    console.log("=================================================================");
  }
}

enviarPost();
