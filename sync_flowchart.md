# Flujo de Sincronización (Arquitectura Distribuida)

Este diagrama representa cómo fluye la información desde que haces un cambio en cualquiera de las 11 sucursales hasta que llega a PowerSales, asumiendo el **Enfoque Distribuido** (un worker Node.js corriendo localmente en cada servidor).

```mermaid
flowchart TD
    subgraph Sucursal 1 [Servidor Local - Sucursal 1]
        User1([Usuario / Sistema ERP]) -->|1. Actualiza existencia| DB1[(Base de Datos MySQL)]
        DB1 -->|2. Dispara Trigger| Trigger1[Trigger ERP]
        Trigger1 -->|3. Inserta en tabla Cambios| Cambios1[(Tabla: Cambios)]
        Cambios1 -.->|4. Escribe en| Binlog1[MySQL Binlog]
        
        Binlog1 ==>|5. Lee en tiempo real| Worker1{Worker Node.js}
        
        Worker1 -->|6a. Sincronización exitosa| LocalDB1[(proteo_db: sync_history)]
        Worker1 -->|6b. Si falla| Retry1[Cola de Reintentos Local]
        Retry1 -.-> Worker1
    end

    subgraph Internet / VPN
        Worker1 ==>|7. Envía Payload HTTP POST| PS_API[API de PowerSales]
    end

    %% Representación de otras sucursales
    subgraph Sucursal N [Servidores - Sucursal 2 al 11]
        WorkerN{Worker Node.js N} -.->|Mismo flujo local| PS_API
    end

    %% Estilos
    classDef mysql fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#01579b;
    classDef nodejs fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#1b5e20;
    classDef cloud fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#e65100;
    
    class DB1,Cambios1,LocalDB1 mysql;
    class Worker1,WorkerN nodejs;
    class PS_API cloud;
```

### Explicación del Flujo:
1. **Actualización:** Alguien hace una venta o ajuste en el ERP de la Sucursal 1.
2. **Trigger:** El Trigger de la base de datos detecta el cambio.
3. **Tabla de Cambios:** El trigger inserta el registro pendiente en la tabla `Cambios`.
4. **Binlog:** Al mismo tiempo, MySQL registra silenciosamente esta transacción en su archivo de bajo nivel (*Binlog*).
5. **Worker (CDC):** El programa de Node.js (que está instalado ahí mismo) está escuchando el Binlog. Al detectar el cambio, arma el paquete (Payload).
6. **Historial Local:** El resultado (éxito o error) se guarda localmente en el dashboard de esa misma sucursal.
7. **Envío a la Nube:** Finalmente, el Payload viaja por internet directamente a la API de PowerSales.

Como puedes ver, **la parte más crítica y pesada del trabajo (pasos 1 al 6) se hace sin salir del servidor de la sucursal**, garantizando que nunca se pierdan datos aunque se caiga el internet temporalmente.
