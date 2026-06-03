'use strict';
const router = require('express').Router();

// Mock data en memoria
let pricelists = [
  {
    "Name": "Precio_Lista",
    "IsActive": 0,
    "IsDefault": 0,
    "PriceListNumber": "Precio_Lista",
    "CreatedBy": 1,
    "CreatedDate": "2025-06-07 00:00:00",
    "ModifiedBy": 82,
    "ModifiedDate": "2025-07-09 15:12:03"
  }
];

let pricelistsDetails = [
  {
    "ProductId": "SKU",
    "PriceListId": "Precio_Lista",
    "Cost": "0.00",
    "Price": "89.90",
    "IsActive": 1
  }
];

// GET /api/grupoascencio/pricelists
router.get('/pricelists', (req, res) => {
  res.json({ data: pricelists });
});

// POST /api/grupoascencio/pricelists
router.post('/pricelists', (req, res) => {
  const payload = req.body;
  if (payload && payload.data) {
    if (Array.isArray(payload.data)) {
        pricelists = pricelists.concat(payload.data);
    } else {
        pricelists.push(payload.data);
    }
  } else {
    pricelists.push(payload);
  }
  res.status(201).json({ ok: true, message: 'Pricelist guardada', data: payload });
});

// GET /api/grupoascencio/pricelistsdetails
router.get('/pricelistsdetails', (req, res) => {
  res.json({ data: pricelistsDetails });
});

// POST /api/grupoascencio/pricelistsdetails
router.post('/pricelistsdetails', (req, res) => {
  const payload = req.body;
  if (payload && payload.data) {
    if (Array.isArray(payload.data)) {
        pricelistsDetails = pricelistsDetails.concat(payload.data);
    } else {
        pricelistsDetails.push(payload.data);
    }
  } else {
    pricelistsDetails.push(payload);
  }
  res.status(201).json({ ok: true, message: 'Pricelist details guardados', data: payload });
});

module.exports = router;
