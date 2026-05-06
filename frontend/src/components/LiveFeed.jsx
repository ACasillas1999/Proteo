import { AnimatePresence, motion } from 'framer-motion';

export default function LiveFeed({ events }) {
  const syncEvents = events.filter(e => e.event === 'sync_ok' || e.event === 'sync_error');

  return (
    <div>
      <div className="section-title">
        📡 Feed en Vivo
        <span>{syncEvents.length} eventos</span>
      </div>
      <div className="live-feed">
        {syncEvents.length === 0 && (
          <p className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>
            Esperando eventos…
          </p>
        )}
        <AnimatePresence initial={false}>
          {syncEvents.map((evt, i) => (
            <motion.div
              key={`${evt.ts}-${i}`}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="live-item"
              style={{
                borderColor: evt.event === 'sync_ok'
                  ? 'rgba(0,255,136,.25)'
                  : 'rgba(255,71,87,.25)',
              }}
            >
              <div className="live-item__tabla">{evt.data?.tabla}</div>
              <div className="live-item__ms">
                {evt.event === 'sync_ok'
                  ? <span style={{ color: 'var(--green)' }}>{evt.data?.ms}ms</span>
                  : <span style={{ color: 'var(--red)' }}>ERR</span>
                }
              </div>
              <div className="live-item__clave">{evt.data?.clave}</div>
              {evt.event === 'sync_error' && (
                <div className="live-item__error">{evt.data?.error}</div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
