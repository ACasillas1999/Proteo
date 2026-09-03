require('dotenv').config();
const axios = require('axios');

const ps = axios.create({
  baseURL: process.env.PS_BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.PS_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 15000,
});

const payload = {
  SKU: '10200221505',
  Name: 'PANEL FOTOVOLTAICO 250W POLICRISTALINO CON MICROINVERSOR',
  ShortName: 'PANEL FOTOVOLTAICO 250W POLICRISTALINO CON MICROINVERSOR',
  Description: 'PANEL FOTOVOLTAICO 250W POLICRISTALINO CON MICROINVERSOR',
  DescriptionHTML: 'PANEL FOTOVOLTAICO 250W POLICRISTALINO CON MICROINVERSOR',
  Barcode: null,
  BarCode2: null,
  BarCode3: null,
  Cost: '0',
  IsActive: 1,
  UnitsPerBox: null,
  CasePerPallet: null,
  ConversionFactor: 0,
  ClaveSat: '39121100',
  ProductCode: '10200221505',
  LoyaltyPct: null,
  BrandId: '10200',
  SubBrandId: null,
  LineId: 'IUSA',
  BranchId: 9,
  CategoryId: 1,
  SubCategoryId: null,
  ProductType: null,
  IsPMRequired: null,
  IsDecimal: null
};

(async () => {
  try {
    console.log('Sending payload for 10200221505 to POST /products...');
    const res = await ps.post('/products', { data: [payload] });
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
