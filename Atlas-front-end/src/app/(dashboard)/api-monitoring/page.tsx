'use client';

import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Server,
  ShieldAlert,
  Lock,
  Ban,
  Bell,
  LoaderCircle
} from 'lucide-react'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  Label
} from 'recharts'

import { apiGet, apiPost, ApiError } from '@/lib/api'
import { useEnvironment } from '@/context/EnvironmentContext'
import { toast } from 'sonner'
import type { ApiMonitoringData } from '@/lib/types'

/* -------------------------------------------------------------------------- */
/*                               UI Components                                */
/* -------------------------------------------------------------------------- */

const SectionHeader = React.memo(
  ({ icon, title }: { icon: React.ReactNode; title: string }) => (
    <div className="flex items-center gap-2 px-5 pt-5 mb-4">
      {icon}
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
    </div>
  )
)

SectionHeader.displayName = 'SectionHeader'

const EmptyState = ({ message }: { message: string }) => (
  <div className="flex items-center justify-center h-[300px] text-sm text-slate-500">
    {message}
  </div>
)

/* -------------------------------------------------------------------------- */
/*                                 Utilities                                  */
/* -------------------------------------------------------------------------- */

const truncate = (value: string, len = 12) =>
  value.length > len ? `${value.slice(0, len)}…` : value

const TooltipContent = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-lg">
      <p className="text-slate-200 font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {Number(p.value).toLocaleString()}
        </p>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                           Main Monitoring Page                             */
/* -------------------------------------------------------------------------- */

export default function ApiMonitoringPage() {
  const { environment } = useEnvironment()

  const [data, setData] = useState<ApiMonitoringData | null>(null)
  const [loading, setLoading] = useState(true)

  /* ------------------------------------------------------------------------ */
  /*                               Fetch Data                                 */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        setLoading(true)

        const res = await apiGet<ApiMonitoringData>(
          '/api-monitoring',
          controller.signal
        )

        setData(res)
      } catch (err) {
        if (!(err instanceof DOMException)) {
          toast.error('Failed to load API monitoring data', {
            description:
              err instanceof ApiError ? err.message : 'Unknown error'
          })
        }
      } finally {
        setLoading(false)
      }
    }

    load()

    return () => controller.abort()
  }, [environment])

  /* ------------------------------------------------------------------------ */
  /*                        Transform Backend Data Safely                     */
  /* ------------------------------------------------------------------------ */

  const {
    apiConsumption,
    abusedEndpoints,
    consumers,
    mitigations
  } = useMemo(() => {
    if (!data) {
      return {
        apiConsumption: [],
        abusedEndpoints: [],
        consumers: [],
        mitigations: []
      }
    }

    const apiConsumption =
      data.apiConsumptionByApp?.map((d) => ({
        app: d.app ?? 'Unknown',
        actual: Number(d.actual) || 0,
        limit: Number(d.limit) || 0
      })) ?? []

    const abusedEndpoints =
      data.mostAbusedEndpoints?.map((e, i) => ({
        id: `${e.endpoint}-${i}`,
        endpoint: e.endpoint ?? '/',
        violations: Math.abs(Number(e.violations) || 0),
        severity:
          Number(e.violations) > 100 ? 'critical' : 'high'
      })) ?? []

    const consumers =
      data.topConsumers?.map((c) => ({
        id: `${c.consumer}-${c.application_name}`,
        consumer: c.consumer,
        app: c.application_name,
        calls: Number(c.total_calls) || 0,
        cost: Number(c.average_cost) || 0,
        isOveruse: Boolean(c.is_overuse)
      })) ?? []

    const mitigations =
      data.activeMitigations?.map((m, i) => ({
        id: `${m.target}-${i}`,
        target: m.target,
        offender: m.offender,
        violation: m.violation_type,
        action: m.action ?? 'Notify Team'
      })) ?? []

    return {
      apiConsumption,
      abusedEndpoints,
      consumers,
      mitigations
    }
  }, [data])

  /* ------------------------------------------------------------------------ */
  /*                               Actions                                    */
  /* ------------------------------------------------------------------------ */

  async function handleAction(action: string, target: string) {
    try {
      await apiPost('/api-monitoring/action', {
        action,
        target
      })

      toast.success('Mitigation applied', {
        description: `${action} executed for ${target}`
      })
    } catch (err) {
      toast.error('Action failed', {
        description: err instanceof ApiError ? err.message : 'Unknown error'
      })
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                               Loading                                    */
  /* ------------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <LoaderCircle className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center text-slate-500 p-6">
        No monitoring data available
      </div>
    )
  }

  /* ------------------------------------------------------------------------ */
  /*                                  UI                                      */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="space-y-6 pb-10">

      {/* Page Header */}

      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-100">
          <Activity className="w-5 h-5 text-blue-400" />
          API Monitoring
        </h1>
        <p className="text-xs text-slate-500 mt-1 ml-7">
          Real-time API usage, abuse detection, and mitigation controls
        </p>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/*                              Charts                                */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* API Consumption */}

        <div className="bg-slate-900 border border-slate-800 rounded-xl">

          <SectionHeader
            icon={<Server className="w-4 h-4 text-blue-400" />}
            title="API Consumption vs Limits"
          />

          <div className="px-5 pb-5">

            {apiConsumption.length === 0 ? (
              <EmptyState message="No consumption data available" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={apiConsumption}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />

                  <XAxis
                    dataKey="app"
                    tickFormatter={(v) => truncate(v)}
                    stroke="#475569"
                  />

                  <YAxis stroke="#475569">
                    <Label
                      value="RPM"
                      angle={-90}
                      position="insideLeft"
                    />
                  </YAxis>

                  <Tooltip content={<TooltipContent />} />

                  <Bar dataKey="limit" fill="#334155" />

                  <Bar dataKey="actual">
                    {apiConsumption.map((d, i) => (
                      <Cell
                        key={i}
                        fill={
                          d.actual > d.limit
                            ? '#ef4444'
                            : '#3b82f6'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Abused Endpoints */}

        <div className="bg-slate-900 border border-slate-800 rounded-xl">

          <SectionHeader
            icon={<ShieldAlert className="w-4 h-4 text-red-400" />}
            title="Most Abused API Endpoints"
          />

          <div className="px-5 pb-5">

            {abusedEndpoints.length === 0 ? (
              <EmptyState message="No abused endpoints detected" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={abusedEndpoints}
                  layout="vertical"
                >
                  <CartesianGrid stroke="#1e293b" horizontal={false} />

                  <XAxis type="number" stroke="#475569" />

                  <YAxis
                    type="category"
                    dataKey="endpoint"
                    tickFormatter={(v) => truncate(v, 18)}
                    width={140}
                  />

                  <Tooltip content={<TooltipContent />} />

                  <Bar dataKey="violations">
                    {abusedEndpoints.map((e) => (
                      <Cell
                        key={e.id}
                        fill={
                          e.severity === 'critical'
                            ? '#ef4444'
                            : '#f97316'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/*                              Tables                                */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top Consumers */}

        <div className="bg-slate-900 border border-slate-800 rounded-xl">

          <SectionHeader
            icon={<Server className="w-4 h-4 text-violet-400" />}
            title="Top API Consumers"
          />

          <div className="px-3 pb-3 overflow-x-auto">

            <table className="w-full text-xs">

              <thead className="border-b border-slate-800 text-slate-500 uppercase">
                <tr>
                  <th className="py-2 text-left">Consumer</th>
                  <th>App</th>
                  <th>Calls</th>
                  <th>Cost</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>

              <tbody>
                {consumers.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-800 hover:bg-slate-800/30"
                  >
                    <td className="py-3 font-mono">{c.consumer}</td>
                    <td className="text-blue-400">[{c.app}]</td>
                    <td>{c.calls.toLocaleString()}</td>
                    <td
                      className={
                        c.isOveruse
                          ? 'text-red-400 font-semibold'
                          : ''
                      }
                    >
                      ${c.cost.toLocaleString()}
                    </td>

                    <td className="text-center">
                      <button
                        onClick={() =>
                          handleAction(
                            'Throttle Limits',
                            c.app
                          )
                        }
                        className="text-orange-400 border border-orange-500/50 px-3 py-1 rounded-md hover:bg-orange-500/10"
                      >
                        Throttle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>

            </table>

          </div>
        </div>

        {/* Active Mitigations */}

        <div className="bg-slate-900 border border-slate-800 rounded-xl">

          <SectionHeader
            icon={<ShieldAlert className="w-4 h-4 text-green-400" />}
            title="Active API Mitigations"
          />

          <div className="px-3 pb-3 overflow-x-auto">

            <table className="w-full text-xs">

              <thead className="border-b border-slate-800 text-slate-500 uppercase">
                <tr>
                  <th className="py-2 text-left">Target</th>
                  <th>Violation</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>

              <tbody>
                {mitigations.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-slate-800 hover:bg-slate-800/30"
                  >
                    <td>
                      <div className="text-blue-400">
                        [{m.target}]
                      </div>
                      <div className="text-slate-500 font-mono text-[11px]">
                        {m.offender}
                      </div>
                    </td>

                    <td>{m.violation}</td>

                    <td className="text-center">
                      <button
                        onClick={() =>
                          handleAction(m.action, m.target)
                        }
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md flex items-center gap-1 mx-auto"
                      >
                        <Ban size={12} />
                        {m.action}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>

            </table>

          </div>
        </div>
      </div>
    </div>
  )
}