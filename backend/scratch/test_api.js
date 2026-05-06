const axios = require('axios');
const fs = require('fs');

async function testApi() {
  const url = 'https://api.dev.powersales.cloud/api/grupoascencio/products';
  // We need to get the token from .env or somewhere.
  // We can read it from config or .env
  require('dotenv').config({ path: '../.env' });
  const token = process.env.PS_TOKEN;

  if (!token) {
    console.error('No PS_TOKEN found in .env');
    process.exit(1);
  }

  const payload = {
    data: [
      {
        SKU: "TEST-001",
        Name: "Test Product",
        BrandId: "BR-10",
        SubBrandId: "SBR-01",
        CategoryId: "CAT-04",
        SubCategoryId: "SCAT-02",
        LineId: "LIN-02",
        BranchId: "BRANCH-001"
      }
    ]
  };

  try {
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    });
    console.log('SUCCESS:', res.status, res.data);
  } catch (err) {
    console.error('ERROR STATUS:', err.response?.status);
    console.error('ERROR DATA:', err.response?.data);
  }
}

testApi();
