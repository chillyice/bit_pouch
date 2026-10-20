import type { LocalizedText, ToolRun } from '@/core/types'
import { OPS_DOMAINS, OPS_REFERENCES } from './data'

export interface OpsCommand {
  id: string
  title: LocalizedText
  command: string
  note: LocalizedText
  dangerous?: boolean
}

export interface OpsDomain {
  id: string
  title: LocalizedText
  commands: OpsCommand[]
}

export interface OpsReference {
  id: string
  title: LocalizedText
  columns?: LocalizedText[] | null
  rows: Array<Array<string | LocalizedText>>
}

export interface OpsRunData {
  domains: OpsDomain[]
  references: OpsReference[]
  total: number
}

const DOMAINS = OPS_DOMAINS as unknown as OpsDomain[]
const REFERENCES = OPS_REFERENCES as unknown as OpsReference[]

const matches = (command: OpsCommand, needle: string): boolean => {
  if (!needle) return true
  return [command.command, command.title.zh, command.title.en, command.note.zh, command.note.en].some((text) =>
    text.toLowerCase().includes(needle),
  )
}

export const run: ToolRun<OpsRunData> = (input, options) => {
  const needle = String(input ?? '').trim().toLowerCase()
  const domainId = String(options.domain ?? 'all')
  const domains = DOMAINS.filter((domain) => domainId === 'all' || domain.id === domainId)
    .map((domain) => ({ ...domain, commands: domain.commands.filter((command) => matches(command, needle)) }))
    .filter((domain) => domain.commands.length)
  const total = domains.reduce((sum, domain) => sum + domain.commands.length, 0)
  return {
    ok: true,
    output: domains.flatMap((domain) => domain.commands.map((command) => command.command)).join('\n'),
    data: { domains, references: REFERENCES, total },
    stats: { total },
  }
}
