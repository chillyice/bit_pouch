import { describe, expect, it } from 'vitest'
import {
  compileUserPlugin,
  normalizeToolResult,
  USER_PLUGIN_MAX_CODE,
  UserPluginError,
} from './userPlugins'

const PLUGIN_CODE = `return {
  manifest: {
    id: 'demo-upper',
    name: { zh: '大写', en: 'Upper' },
    description: { zh: '把输入转成大写', en: 'Uppercase the input' },
    category: 'text',
    keywords: ['upper'],
  },
  run(input) {
    return { ok: true, output: input.toUpperCase(), stats: { chars: input.length } }
  },
}`

function expectPluginError(code: string, run: () => unknown): void {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(UserPluginError)
  expect((caught as UserPluginError).code).toBe(code)
}

describe('compileUserPlugin', () => {
  it('compiles a function-body plugin and fills manifest defaults', () => {
    const plugin = compileUserPlugin(PLUGIN_CODE, new Set())

    expect(plugin.manifest.id).toBe('demo-upper')
    expect(plugin.manifest.icon).toBe('wrench')
    expect(plugin.manifest.version).toBe('0.1.0')
    expect(plugin.manifest.runtime).toBe('main')
    expect(plugin.manifest.platforms).toEqual(['web', 'desktop', 'mobile'])
    expect(plugin.manifest.offline).toBe(true)
    expect(plugin.manifest.order).toBe(100)
    expect(plugin.run('abc', {}, { locale: 'zh' })).toEqual({
      ok: true,
      output: 'ABC',
      stats: { chars: 3 },
    })
  })

  it('accepts export default syntax', () => {
    const code = PLUGIN_CODE.replace(/^return /, 'export default ')
    const plugin = compileUserPlugin(code, new Set())
    expect(plugin.manifest.id).toBe('demo-upper')
  })

  it('rejects ids reserved by built-in tools', () => {
    expectPluginError('PLUGIN_ID_CONFLICT', () => compileUserPlugin(PLUGIN_CODE, new Set(['demo-upper'])))
  })

  it('rejects invalid JavaScript', () => {
    expectPluginError('PLUGIN_SYNTAX', () => compileUserPlugin('return {', new Set()))
  })

  it('rejects a script that throws while initializing', () => {
    expectPluginError('PLUGIN_EVAL', () => compileUserPlugin('throw new Error("boom")', new Set()))
  })

  it('rejects an empty script', () => {
    expectPluginError('PLUGIN_EXPORT', () => compileUserPlugin('   ', new Set()))
  })

  it('rejects a value without run()', () => {
    expectPluginError(
      'PLUGIN_RUN',
      () =>
        compileUserPlugin(
          `return { manifest: { id: 'x', name: { zh: 'x', en: 'x' }, description: { zh: 'x', en: 'x' }, category: 'text' } }`,
          new Set(),
        ),
    )
  })

  it('rejects an invalid manifest', () => {
    expectPluginError(
      'PLUGIN_MANIFEST',
      () =>
        compileUserPlugin(
          `return { manifest: { id: 'Bad Id' }, run() { return '' } }`,
          new Set(),
        ),
    )
  })

  it('rejects oversized code', () => {
    const code = `return { manifest: { id: 'big', name: { zh: 'x', en: 'x' }, description: { zh: 'x', en: 'x' }, category: 'text' }, run() { return '' } } // ${'x'.repeat(USER_PLUGIN_MAX_CODE)}`
    expectPluginError('PLUGIN_TOO_LARGE', () => compileUserPlugin(code, new Set()))
  })
})

describe('normalizeToolResult', () => {
  it('accepts a plain string', () => {
    expect(normalizeToolResult('hello')).toEqual({ ok: true, output: 'hello' })
  })

  it('stringifies primitive values', () => {
    expect(normalizeToolResult(42)).toEqual({ ok: true, output: '42' })
    expect(normalizeToolResult(false)).toEqual({ ok: true, output: 'false' })
    expect(normalizeToolResult(null)).toEqual({ ok: true, output: '' })
  })

  it('keeps output, stats and data', () => {
    expect(
      normalizeToolResult({ ok: true, output: 'x', stats: { a: 1, b: 'two', bad: {} }, data: { id: 1 } }),
    ).toEqual({
      ok: true,
      output: 'x',
      stats: { a: 1, b: 'two' },
      data: { id: 1 },
    })
  })

  it('passes structured errors through', () => {
    expect(normalizeToolResult({ ok: false, error: { code: 'BAD_INPUT', message: 'nope' } })).toEqual({
      ok: false,
      error: { code: 'BAD_INPUT', message: 'nope' },
    })
  })

  it('rejects objects without a boolean ok', () => {
    expect(normalizeToolResult({ output: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'PLUGIN_RESULT' },
    })
  })

  it('rejects non-primitive output', () => {
    expect(normalizeToolResult({ ok: true, output: { nested: true } })).toMatchObject({
      ok: false,
      error: { code: 'PLUGIN_RESULT' },
    })
  })
})
