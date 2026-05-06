'use strict';
const axios = require('axios');

const ps = axios.create({
  baseURL: process.env.PS_BASE_URL,
  headers: {
    Authorization:  `Bearer ${process.env.PS_TOKEN}`,
    'Content-Type': 'application/json',
    Accept:         'application/json',
  },
  timeout: 15_000,
});

// Normaliza errores HTTP para mensajes legibles
ps.interceptors.response.use(
  res => res,
  err => {
    if (err.response) {
      const { status, data } = err.response;
      const body = typeof data === 'object' ? JSON.stringify(data) : String(data);
      return Promise.reject(new Error(`${status} ${body}`));
    }
    return Promise.reject(err);
  }
);

module.exports = ps;
