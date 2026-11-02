'use client'

import { copy } from '@/lib/copy'
import { BRIEF_MODELS } from '@/lib/agent/model-choices'

// Per-brief agent model dropdown for the Setup tab (#189). '' means Default
// (follow the app-wide setting); the parent saves that as null.
export function AgentModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor="agent-model" className="text-sm font-medium text-gray-700 block mb-1.5">{copy.agentModel.label}</label>
      <select
        id="agent-model"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
      >
        <option value="">{copy.agentModel.default}</option>
        {BRIEF_MODELS.map((m) => (
          <option key={m} value={m}>{copy.agentModel.options[m]}</option>
        ))}
      </select>
      <p className="text-xs text-gray-400 mt-1">{copy.agentModel.help}</p>
    </div>
  )
}
