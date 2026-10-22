// 把格式化后的 JSON / 标记语言转成可折叠的树，并回填原文偏移量用于 hover 联动。
import { parseJsonAst, type JsonNode } from './json'
import { parseMarkupAst, type ElementNode } from './markup'
import type { FormatMode } from './run'

export interface FormatTreeNode {
  id: string
  name: string
  kind: string
  preview: string
  start: number
  end: number
  inputStart?: number
  inputEnd?: number
  children?: FormatTreeNode[]
}

const text = (value: string, max = 80): string => {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

const decodeKey = (raw: string): string => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function jsonNode(node: JsonNode, id: string, name: string): FormatTreeNode {
  const start = node.start ?? 0
  const end = node.end ?? start
  if (node.type === 'object') {
    return {
      id,
      name,
      kind: 'object',
      preview: `{ ${node.entries.length} }`,
      start,
      end,
      children: node.entries.map((entry) =>
        jsonNode(entry.value, `${id}/${entry.key}`, decodeKey(entry.key)),
      ),
    }
  }
  if (node.type === 'array') {
    return {
      id,
      name,
      kind: 'array',
      preview: `[ ${node.items.length} ]`,
      start,
      end,
      children: node.items.map((item, index) => jsonNode(item, `${id}/${index}`, String(index))),
    }
  }
  return { id, name, kind: node.type, preview: text(node.raw), start, end }
}

function markupNode(node: ElementNode, id: string): FormatTreeNode {
  const children = node.children.filter(
    (child): child is ElementNode => child.type === 'element',
  )
  const rawText = node.children
    .filter((child) => child.type === 'text' || child.type === 'rawtext')
    .map((child) => (child as { text: string }).text)
    .join(' ')
  return {
    id,
    name: node.name,
    kind: 'element',
    preview: text(node.attrs || rawText),
    start: node.start,
    end: node.end ?? node.start,
    children: children.length
      ? children.map((child, childIndex) => markupNode(child, `${id}/${childIndex}`))
      : undefined,
  }
}

function collectRanges(nodes: FormatTreeNode[], map: Map<string, { start: number; end: number }>): void {
  for (const node of nodes) {
    if (!map.has(node.id)) map.set(node.id, { start: node.start, end: node.end })
    if (node.children) collectRanges(node.children, map)
  }
}

function mergeInputRanges(nodes: FormatTreeNode[], ranges: Map<string, { start: number; end: number }>): void {
  for (const node of nodes) {
    const range = ranges.get(node.id)
    if (range) {
      node.inputStart = range.start
      node.inputEnd = range.end
    }
    if (node.children) mergeInputRanges(node.children, ranges)
  }
}

function jsonTree(text: string): FormatTreeNode[] {
  const root = parseJsonAst(text)
  return [jsonNode(root, '$', '$')]
}

function markupTree(text: string, mode: 'xml' | 'html'): FormatTreeNode[] {
  const { root } = parseMarkupAst(text, mode)
  return root.children
    .filter((child): child is ElementNode => child.type === 'element')
    .map((child, index) => markupNode(child, `/${index}`))
}

export function buildFormatTree(input: string, output: string, mode: FormatMode): FormatTreeNode[] {
  if (mode === 'sql') return []
  let nodes: FormatTreeNode[]
  let inputNodes: FormatTreeNode[]
  if (mode === 'json') {
    nodes = jsonTree(output)
    inputNodes = jsonTree(input)
  } else {
    const markupMode = mode === 'xml' ? 'xml' : 'html'
    nodes = markupTree(output, markupMode)
    inputNodes = markupTree(input, markupMode)
  }
  const ranges = new Map<string, { start: number; end: number }>()
  collectRanges(inputNodes, ranges)
  mergeInputRanges(nodes, ranges)
  return nodes
}

export function findDeepestNode(nodes: FormatTreeNode[], offset: number): FormatTreeNode | null {
  let found: FormatTreeNode | null = null
  for (const node of nodes) {
    if (offset < node.start || offset > node.end) continue
    found = node
    if (node.children) {
      const child = findDeepestNode(node.children, offset)
      if (child) found = child
    }
  }
  return found
}
