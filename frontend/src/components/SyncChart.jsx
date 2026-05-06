import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

export default function SyncChart({ data }) {
  return (
    <div>
      <div className="section-title">📈 Sincronizaciones últimas 24h</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="hora"
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
            }}
          />
          <Line
            type="monotone"
            dataKey="ok"
            name="OK"
            stroke="var(--green)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--green)' }}
          />
          <Line
            type="monotone"
            dataKey="error"
            name="Error"
            stroke="var(--red)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--red)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
