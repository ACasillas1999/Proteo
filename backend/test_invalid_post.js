require('dotenv').config();
const axios = require('axios');

const ps = axios.create({
  baseURL: 'https://api.dev.powersales.cloud/api/grupoascencio',
  headers: {
    Authorization: 'Bearer 438|RJjhTTLgA6yDcJChu5W8bjfJU6scO0LyEBAOcUyd',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 15000,
});

// A payload missing required fields like Name or BrandId
const invalidPayload = {
  SKU: 'TEST-INVALID-SKU-9999',
  // Name is missing (required)
  ShortName: 'Invalid Test',
  Cost: '100.00',
  IsActive: 1,
  ProductCode: 'TEST-INVALID-SKU-9999',
  // BrandId is missing (required)
};

(async () => {
  try {
    console.log('Sending invalid payload to POST /products...');
    const res = await ps.post('/products', { data: [invalidPayload] });
    console.log('HTTP Status:', res.status);
    console.log('Response body:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('HTTP Request failed:', err.message);
    if (err.response) {
      console.error('Response Status:', err.response.status);
      console.error('Response Body:', JSON.stringify(err.response.data, null, 2));
    }
  } finally {
    process.exit(0);
  }
})();
