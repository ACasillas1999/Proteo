'use strict';

/**
 * Campos de mapeo para pedidos (webhook `orders` de PowerSales).
 * A diferencia de articulo/articuloalm/cliente, la tabla destino en Magic
 * no está fija — se elige dinámicamente en el UI de Mapeo (routes/mapeo.js
 * expone /tables y /columns/:table para eso). Aquí solo se listan los
 * campos disponibles del payload; el sync() hacia Magic es fase siguiente.
 *
 * type: 'erpColumn' → se mapea a una columna de la tabla que el usuario elija.
 */

// Nivel raíz de `datos` en el webhook de orden (ver routes/webhooks.js, entidad 'orders')
const PS_FIELDS_CABECERA = [
  { field: 'OrderNumber',       type: 'erpColumn', required: true,  label: 'Folio del pedido' },
  { field: 'OrderDate',         type: 'erpColumn', required: false, label: 'Fecha de pedido' },
  { field: 'DeliveryDate',      type: 'erpColumn', required: false, label: 'Fecha de entrega' },
  { field: 'DeliveryDateReal',  type: 'erpColumn', required: false, label: 'Fecha de entrega real' },
  { field: 'TotalQty',          type: 'erpColumn', required: false, label: 'Cantidad total' },
  { field: 'TotalTax',          type: 'erpColumn', required: false, label: 'Impuesto total' },
  { field: 'TotalAmount',       type: 'erpColumn', required: false, label: 'Monto total' },
  { field: 'Payment',           type: 'erpColumn', required: false, label: 'Pago' },
  { field: 'PaymentType',       type: 'erpColumn', required: false, label: 'Tipo de pago' },
  { field: 'OrderType',         type: 'erpColumn', required: false, label: 'Tipo de pedido' },
  { field: 'TypeSend',          type: 'erpColumn', required: false, label: 'Tipo de entrega' },
  { field: 'StatusId',          type: 'erpColumn', required: false, label: 'Id de estatus' },
  { field: 'StatusName',        type: 'erpColumn', required: false, label: 'Nombre de estatus' },
  { field: 'Comments',          type: 'erpColumn', required: false, label: 'Comentarios' },
  { field: 'CreatedDate',       type: 'erpColumn', required: false, label: 'Fecha de creación' },
  { field: 'ModifiedDate',      type: 'erpColumn', required: false, label: 'Fecha de modificación' },
  { field: 'UniqueId',          type: 'erpColumn', required: false, label: 'ID Único de PowerSales (UniqueId)' },
  { field: 'PurchaseOrderNumber', type: 'erpColumn', required: false, label: 'Orden de Compra / Referencia' },
  { field: 'details_promo.0.order.PurchaseOrderNumber', type: 'erpColumn', required: false, label: 'Orden de Compra (Anidado Promo)' },
  
  // Identificadores y datos anidados del Cliente
  { field: 'CustomerId.CustomerNumber', type: 'erpColumn', required: false, label: 'Cliente — CustomerNumber (de tu ERP)' },
  { field: 'CustomerId.Name',           type: 'erpColumn', required: false, label: 'Cliente — Nombre' },
  { field: 'CustomerId.TIN',            type: 'erpColumn', required: false, label: 'Cliente — RFC / TIN' },
  { field: 'CustomerId.Address1',       type: 'erpColumn', required: false, label: 'Cliente — Dirección 1' },
  { field: 'CustomerId.Id',             type: 'erpColumn', required: false, label: 'Cliente — Id interno PowerSales' },
  
  // Identificadores y datos anidados del Vendedor / Rep
  { field: 'RepId.EmployeeNumber',      type: 'erpColumn', required: false, label: 'Vendedor — EmployeeNumber (de tu ERP)' },
  { field: 'RepId.UserName',            type: 'erpColumn', required: false, label: 'Vendedor — Usuario' },
  { field: 'RepId.FirstName',           type: 'erpColumn', required: false, label: 'Vendedor — Nombre' },
  { field: 'RepId.Id',                  type: 'erpColumn', required: false, label: 'Vendedor — Id interno PowerSales' },
  
  // Identificadores y datos anidados de la Ruta
  { field: 'RouteId.RouteNumber',       type: 'erpColumn', required: false, label: 'Ruta — RouteNumber (de tu ERP)' },
  { field: 'RouteId.Name',              type: 'erpColumn', required: false, label: 'Ruta — Nombre' },
  { field: 'RouteId.Warehouse',         type: 'erpColumn', required: false, label: 'Ruta — Almacén' },
  { field: 'RouteId.Id',                type: 'erpColumn', required: false, label: 'Ruta — Id interno PowerSales' },
];

// Cada elemento del arreglo `details[]` (no `details_promo`, que duplica info anidada)
const PS_FIELDS_DETALLE = [
  // No viene en cada renglón — se copia del OrderNumber de la cabecera al insertar,
  // para relacionar cada renglón con su pedido. Mapear a la columna FK de la tabla de renglones.
  { field: 'OrderNumber',    type: 'erpColumn', required: false, label: 'Folio del pedido (relación con cabecera)' },
  { field: 'ProductId',      type: 'erpColumn', required: true,  label: 'SKU / Código de producto' },
  { field: 'ProductCode',    type: 'erpColumn', required: false, label: 'Código de producto' },
  { field: 'QtyOrdered',     type: 'erpColumn', required: false, label: 'Cantidad pedida' },
  { field: 'QtyDelivered',   type: 'erpColumn', required: false, label: 'Cantidad entregada' },
  { field: 'QtyPicked',      type: 'erpColumn', required: false, label: 'Cantidad surtida' },
  { field: 'Price',          type: 'erpColumn', required: false, label: 'Precio' },
  { field: 'SubTotalAmount', type: 'erpColumn', required: false, label: 'Subtotal' },
  { field: 'Discount1',      type: 'erpColumn', required: false, label: 'Descuento 1' },
  { field: 'Discount2',      type: 'erpColumn', required: false, label: 'Descuento 2' },
  { field: 'Discount3',      type: 'erpColumn', required: false, label: 'Descuento 3' },
  { field: 'Discount1pct',   type: 'erpColumn', required: false, label: '% Descuento 1' },
  { field: 'Discount2pct',   type: 'erpColumn', required: false, label: '% Descuento 2' },
  { field: 'Discount3pct',   type: 'erpColumn', required: false, label: '% Descuento 3' },
  { field: 'Taxes1',         type: 'erpColumn', required: false, label: 'Impuesto 1' },
  { field: 'Taxes2',         type: 'erpColumn', required: false, label: 'Impuesto 2' },
  { field: 'Taxes3',         type: 'erpColumn', required: false, label: 'Impuesto 3' },
  { field: 'TotalDiscount',  type: 'erpColumn', required: false, label: 'Descuento total' },
  { field: 'TotalTaxes',     type: 'erpColumn', required: false, label: 'Impuestos totales' },
  { field: 'TotalAmount',    type: 'erpColumn', required: false, label: 'Monto total del renglón' },
  { field: 'Warehouse',      type: 'erpColumn', required: false, label: 'Almacén (nombre)' },
  { field: 'WarehouseId',    type: 'erpColumn', required: false, label: 'Almacén (Id)' },
  { field: 'Comments',       type: 'erpColumn', required: false, label: 'Comentarios' },
  { field: 'CreatedDate',    type: 'erpColumn', required: false, label: 'Fecha de creación' },
  { field: 'ModifiedDate',   type: 'erpColumn', required: false, label: 'Fecha de modificación' },
];

module.exports = { PS_FIELDS_CABECERA, PS_FIELDS_DETALLE };
