// ── departments ──────────────────────────────────────────────────────
// The HQ tower's floors: each floor is a department. Built-ins cover the
// common crews (general / coding / marketing / testing); the user can add
// custom departments — the building grows a floor per department.
//
// Persistence (localStorage):
//   terrarium.departments  — custom departments only (builtins merge in)
//   terrarium.deptAgents   — { agentId: deptId } explicit assignment map
// Change events: 'terrarium:departments-updated' (+ storage for cross-view).
//
// Assignment precedence: explicit map → domain match → 'general'.

import { useEffect, useMemo, useState } from 'react'
import type { Agent, AgentDomain } from '@shared/types'

export interface Department {
  id: string
  name: string
  /** accent hue — floor band + UI chip color */
  hue: number
  /** agent domains auto-collected into this department */
  domains?: AgentDomain[]
  builtin?: boolean
}

export const BUILTIN_DEPARTMENTS: Department[] = [
  { id: 'general', name: 'General', hue: 210, domains: ['general'], builtin: true },
  { id: 'coding', name: 'Coding', hue: 155, domains: ['frontend', 'backend'], builtin: true },
  { id: 'marketing', name: 'Marketing', hue: 25, domains: ['marketing'], builtin: true },
  { id: 'testing', name: 'Testing', hue: 275, domains: [], builtin: true }
]

const DEPTS_KEY = 'terrarium.departments'
const ASSIGN_KEY = 'terrarium.deptAgents'
const EVENT = 'terrarium:departments-updated'
const ALL_DOMAINS: AgentDomain[] = [
  'frontend',
  'backend',
  'marketing',
  'design',
  'research',
  'legal',
  'general'
]

export const DEPARTMENT_DOMAINS = ALL_DOMAINS

const AUTO_HUES = [330, 190, 95, 45, 15, 300, 130, 230]

// ── persistence ──────────────────────────────────────────────────────

function loadCustoms(): Department[] {
  try {
    const raw = localStorage.getItem(DEPTS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (d): d is Department =>
          !!d && typeof d === 'object' && typeof d.id === 'string' && typeof d.name === 'string'
      )
      .map((d) => ({ ...d, builtin: false }))
  } catch {
    return []
  }
}

function persist(customs: Department[]) {
  try {
    localStorage.setItem(DEPTS_KEY, JSON.stringify(customs))
    window.dispatchEvent(new CustomEvent(EVENT))
    window.dispatchEvent(new StorageEvent('storage', { key: DEPTS_KEY }))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function loadAssignMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ASSIGN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function persistAssignMap(map: Record<string, string>) {
  try {
    localStorage.setItem(ASSIGN_KEY, JSON.stringify(map))
    window.dispatchEvent(new CustomEvent(EVENT))
    window.dispatchEvent(new StorageEvent('storage', { key: ASSIGN_KEY }))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// ── queries ──────────────────────────────────────────────────────────

export function loadDepartments(): Department[] {
  const customs = loadCustoms()
  // drop customs colliding with builtin ids
  return [...BUILTIN_DEPARTMENTS, ...customs.filter((c) => !BUILTIN_DEPARTMENTS.some((b) => b.id === c.id))]
}

export function createDepartment(name: string, hue?: number, domains: AgentDomain[] = []): Department {
  const customs = loadCustoms()
  const dept: Department = {
    id: `dept-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: name.trim() || 'Department',
    hue: hue ?? AUTO_HUES[customs.length % AUTO_HUES.length],
    domains,
    builtin: false
  }
  persist([...customs, dept])
  return dept
}

export function removeDepartment(id: string): void {
  const dept = loadDepartments().find((d) => d.id === id)
  if (!dept || dept.builtin) return
  persist(loadCustoms().filter((d) => d.id !== id))
  // free its explicit members → they fall back to domain/general
  const map = loadAssignMap()
  let dirty = false
  for (const k of Object.keys(map)) {
    if (map[k] === id) {
      delete map[k]
      dirty = true
    }
  }
  if (dirty) persistAssignMap(map)
}

/** Explicit assignment — pass null to clear back to auto. */
export function setAgentDepartment(agentId: string, deptId: string | null): void {
  const map = loadAssignMap()
  if (deptId) map[agentId] = deptId
  else delete map[agentId]
  persistAssignMap(map)
}

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function deptForAgent(agent: Agent, depts: Department[]): Department {
  const map = loadAssignMap()
  const explicit = map[agent.id] ? depts.find((d) => d.id === map[agent.id]) : undefined
  if (explicit) return explicit
  const byDomain = depts.find((d) => d.domains?.includes(agent.domain))
  if (byDomain) return byDomain
  const general = depts.find((d) => d.id === 'general')
  if (general) return general
  return depts[hashId(agent.id) % Math.max(1, depts.length)] ?? BUILTIN_DEPARTMENTS[0]
}

export function agentsForDept(agents: Agent[], deptId: string, depts: Department[]): Agent[] {
  return agents.filter((a) => deptForAgent(a, depts).id === deptId)
}

// ── hooks ────────────────────────────────────────────────────────────

export function useDepartments(): Department[] {
  const [depts, setDepts] = useState<Department[]>(loadDepartments)
  useEffect(() => {
    const refresh = () => setDepts(loadDepartments())
    window.addEventListener(EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return depts
}

/** deptId → agents[] map, recomputed on agents/departments/assignments change */
export function useDeptMap(agents: Agent[]): { depts: Department[]; byDept: Record<string, Agent[]> } {
  const depts = useDepartments()
  // subscribe to assignment edits too (same event)
  const [assignMap, setAssignMap] = useState<Record<string, string>>(loadAssignMap)
  useEffect(() => {
    const refresh = () => setAssignMap(loadAssignMap())
    window.addEventListener(EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return useMemo(() => {
    const byDept: Record<string, Agent[]> = {}
    for (const d of depts) byDept[d.id] = []
    for (const a of agents) {
      const explicit = assignMap[a.id] ? depts.find((d) => d.id === assignMap[a.id]) : undefined
      const dept =
        explicit ??
        depts.find((d) => d.domains?.includes(a.domain)) ??
        depts.find((d) => d.id === 'general') ??
        depts[0]
      if (dept) (byDept[dept.id] ??= []).push(a)
    }
    return { depts, byDept }
  }, [agents, depts, assignMap])
}
