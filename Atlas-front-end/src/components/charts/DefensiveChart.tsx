/**
 * src/components/charts/DefensiveChart.tsx
 * 
 * Defensive chart components with built-in error handling, data coercion,
 * and proper responsive layout to prevent UI crashes.
 */

import React from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend
} from 'recharts';

// --- Utility Functions ---

const truncateLabel = (label: string | number | undefined, maxLength = 10): string => {
  if (typeof label !== 'string' && typeof label !== 'number') return '';
  const str = String(label);
  return str.length > maxLength ? `${str.substring(0, maxLength)}...` : str;
};

const coerceNumber = (value: any): number => {
  const num = Number(value);
  return isNaN(num) ? 0 : num;
};

const coerceString = (value: any): string => {
  if (value === null || value === undefined) return '';
  return String(value);
};

// --- Enhanced Tooltip with Defensive Parsing ---

interface ChartTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: any;
  fullLabels?: Record<string, string>;
  formatter?: (value: number) => string;
}

export const ChartTooltip: React.FC<ChartTooltipProps> = ({ 
  active, 
  payload, 
  label, 
  fullLabels = {},
  formatter = (v: number) => v.toLocaleString() 
}) => {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0]?.payload || {};
  const dataKey = payload[0]?.dataKey || '';
  const value = coerceNumber(payload[0]?.value);
  const fullLabel = fullLabels[coerceString(label)] || coerceString(label);

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl max-w-xs">
      <p className="font-bold text-slate-200 truncate" title={fullLabel}>
        {fullLabel}
      </p>
      {payload.map((pld: any, index: number) => (
        <p key={index} className="text-slate-300 mt-1" style={{ color: pld.color || '#94a3b8' }}>
          {`${pld.name || dataKey}: ${formatter(value)}`}
        </p>
      ))}
    </div>
  );
};

// --- Defensive Bar Chart Component ---

interface DefensiveBarChartProps {
  data: any[];
  dataKey: string;
  height?: number;
  margin?: any;
  colors?: string[];
  showGrid?: boolean;
  showTooltip?: boolean;
  xAxisProps?: any;
  yAxisProps?: any;
  fullLabels?: Record<string, string>;
  radius?: [number, number, number, number];
}

export const DefensiveBarChart: React.FC<DefensiveBarChartProps> = ({
  data = [],
  dataKey,
  height = 280,
  margin = { top: 5, right: 20, left: 10, bottom: 30 },
  colors = ['#3b82f6', '#ef4444', '#f97316', '#eab308'],
  showGrid = true,
  showTooltip = true,
  xAxisProps = {},
  yAxisProps = {},
  fullLabels = {},
  radius = [4, 4, 0, 0]
}) => {
  // Defensive data processing
  const safeData = Array.isArray(data) ? data.filter(item => item && typeof item === 'object') : [];
  const processedData = safeData.map(item => ({
    ...item,
    [dataKey]: coerceNumber(item[dataKey])
  }));

  if (processedData.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-[280px] text-slate-500 border border-slate-800 rounded-xl">
        <div className="text-center">
          <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-slate-700 flex items-center justify-center">
            <div className="w-4 h-0.5 bg-slate-400"></div>
          </div>
          No data available
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={processedData} margin={margin}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />}
        <XAxis
          dataKey="name"
          stroke="#475569"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: '#334155' }}
          interval={0}
          tickFormatter={(value) => truncateLabel(value, 10)}
          {...xAxisProps}
        />
        <YAxis
          stroke="#475569"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: '#334155' }}
          width={80}
          {...yAxisProps}
        />
        {showTooltip && <Tooltip content={<ChartTooltip fullLabels={fullLabels} />} cursor={{ fill: '#1e293b' }} />}
        <Bar dataKey={dataKey} radius={radius}>
          {processedData.map((entry, index) => (
            <Cell 
              key={`cell-${index}`} 
              fill={colors[index % colors.length]} 
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// --- Defensive Line Chart Component ---

interface DefensiveLineChartProps {
  data: any[];
  lines: Array<{ dataKey: string; color?: string; name?: string }>;
  height?: number;
  margin?: any;
  showGrid?: boolean;
  showTooltip?: boolean;
  xAxisProps?: any;
  yAxisProps?: any;
  fullLabels?: Record<string, string>;
}

export const DefensiveLineChart: React.FC<DefensiveLineChartProps> = ({
  data = [],
  lines,
  height = 280,
  margin = { top: 5, right: 20, left: 10, bottom: 30 },
  showGrid = true,
  showTooltip = true,
  xAxisProps = {},
  yAxisProps = {},
  fullLabels = {}
}) => {
  // Defensive data processing
  const safeData = Array.isArray(data) ? data.filter(item => item && typeof item === 'object') : [];
  const processedData = safeData.map(item => {
    const processed: any = { ...item };
    lines.forEach(line => {
      processed[line.dataKey] = coerceNumber(item[line.dataKey]);
    });
    return processed;
  });

  if (processedData.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-[280px] text-slate-500 border border-slate-800 rounded-xl">
        <div className="text-center">
          <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-slate-700 flex items-center justify-center">
            <div className="w-4 h-0.5 bg-slate-400"></div>
          </div>
          No data available
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={processedData} margin={margin}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />}
        <XAxis
          dataKey="name"
          stroke="#475569"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: '#334155' }}
          interval={0}
          tickFormatter={(value) => truncateLabel(value, 10)}
          {...xAxisProps}
        />
        <YAxis
          stroke="#475569"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: '#334155' }}
          width={80}
          {...yAxisProps}
        />
        {showTooltip && <Tooltip content={<ChartTooltip fullLabels={fullLabels} />} cursor={{ fill: '#1e293b' }} />}
        {lines.map((line, index) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            stroke={line.color || colors[index % colors.length]}
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
            name={line.name || line.dataKey}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

// --- Info Tooltip Component ---

interface InfoTooltipProps {
  text: string;
  className?: string;
}

export const ChartInfoTooltip: React.FC<InfoTooltipProps> = ({ text, className = '' }) => {
  const [open, setOpen] = React.useState(false);
  
  return (
    <div className={`relative inline-flex items-center ml-1 ${className}`}>
      <button 
        onMouseEnter={() => setOpen(true)} 
        onMouseLeave={() => setOpen(false)} 
        onFocus={() => setOpen(true)} 
        onBlur={() => setOpen(false)} 
        className="text-slate-500 hover:text-blue-400 transition-colors" 
        aria-label="More information"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <circle cx="12" cy="12" r="10" strokeWidth="2"/>
          <path d="M12 16v-4M12 8h.01" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 left-5 top-0 w-72 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs text-slate-300 leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
};
