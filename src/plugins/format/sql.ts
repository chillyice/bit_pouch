// SQL 格式化的纯逻辑：词法扫描 + 子句换行 + 括号缩进。
// 不校验语法、不依赖数据库方言，字符串 / 引号标识符 / 注释原样保留。
import type { Locale } from '@/core/types'

export type SqlTokenType =
  | 'space'
  | 'comment'
  | 'string'
  | 'number'
  | 'word'
  | 'keyword'
  | 'operator'
  | 'punct'

export interface SqlToken {
  type: SqlTokenType
  text: string
  start: number
  end: number
}

const KEYWORDS = new Set(
  `SELECT FROM WHERE GROUP BY ORDER HAVING LIMIT OFFSET FETCH INSERT INTO VALUES UPDATE SET DELETE JOIN
  LEFT RIGHT INNER OUTER FULL CROSS NATURAL ON USING UNION ALL DISTINCT AS AND OR NOT NULL IS IN EXISTS
  BETWEEN LIKE ILIKE CASE WHEN THEN ELSE END CREATE ALTER DROP TABLE VIEW INDEX PRIMARY KEY FOREIGN
  REFERENCES DEFAULT CONSTRAINT UNIQUE CHECK WITH RECURSIVE RETURNING ASC DESC TRUE FALSE OVER PARTITION
  WINDOW TRUNCATE REPLACE MERGE BEGIN COMMIT ROLLBACK GRANT REVOKE EXPLAIN ANALYZE VACUUM PRAGMA IF
  ELSEIF DO DECLARE CASCADE RESTRICT ADD COLUMN RENAME TO TYPE DATABASE SCHEMA PROCEDURE FUNCTION
  TRIGGER CURSOR FOR LOOP WHILE CAST INTERVAL NULLS FIRST LAST COLLATE`
    .split(/\s+/)
    .filter(Boolean),
)

const CLAUSES = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH',
  'INSERT', 'UPDATE', 'DELETE', 'SET', 'VALUES', 'RETURNING', 'UNION', 'EXCEPT', 'INTERSECT',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'REPLACE', 'MERGE', 'GRANT', 'REVOKE', 'EXPLAIN',
  'WITH', 'ANALYZE', 'VACUUM', 'PRAGMA', 'BEGIN', 'COMMIT', 'ROLLBACK',
])

const JOIN_MODIFIER = /^(LEFT|RIGHT|INNER|OUTER|FULL|CROSS|NATURAL)$/

const isWordStart = (ch: string): boolean => /[A-Za-z_@#]/.test(ch)
const isWord = (ch: string): boolean => /[A-Za-z0-9_$@#]/.test(ch)

export function tokenizeSql(text: string): SqlToken[] {
  const input = String(text ?? '')
  const tokens: SqlToken[] = []
  let i = 0

  const push = (type: SqlTokenType, start: number, end: number): void => {
    tokens.push({ type, text: input.slice(start, end), start, end })
  }

  while (i < input.length) {
    const ch = input[i]
    const start = i

    if (/\s/.test(ch)) {
      while (i < input.length && /\s/.test(input[i])) i++
      push('space', start, i)
      continue
    }

    if (ch === '-' && input[i + 1] === '-') {
      i += 2
      while (i < input.length && input[i] !== '\n') i++
      push('comment', start, i)
      continue
    }

    if (ch === '/' && input[i + 1] === '*') {
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++
      i = Math.min(input.length, i + 2)
      push('comment', start, i)
      continue
    }

    if (ch === "'") {
      i++
      while (i < input.length) {
        if (input[i] === "'") {
          if (input[i + 1] === "'") i += 2
          else {
            i++
            break
          }
        } else if (input[i] === '\\') i += 2
        else i++
      }
      push('string', start, i)
      continue
    }

    if (ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < input.length && input[i] !== quote) i++
      i = Math.min(input.length, i + 1)
      push('string', start, i)
      continue
    }

    if (ch === '[') {
      i++
      while (i < input.length && input[i] !== ']') i++
      i = Math.min(input.length, i + 1)
      push('string', start, i)
      continue
    }

    if (/[0-9]/.test(ch)) {
      i++
      while (i < input.length && /[0-9a-fA-FxX._]/.test(input[i])) i++
      push('number', start, i)
      continue
    }

    if (isWordStart(ch)) {
      i++
      while (i < input.length && isWord(input[i])) i++
      const word = input.slice(start, i)
      push(KEYWORDS.has(word.toUpperCase()) ? 'keyword' : 'word', start, i)
      continue
    }

    const two = input.slice(i, i + 2)
    if (['<=', '>=', '<>', '!=', '||', '&&', '::', ':=', '->', '=>'].includes(two)) {
      i += 2
      push('operator', start, i)
      continue
    }

    if ('=<>+-*/%'.includes(ch)) {
      i++
      push('operator', start, i)
      continue
    }

    if ('(),.;'.includes(ch)) {
      i++
      push('punct', start, i)
      continue
    }

    i++
    push('punct', start, i)
  }

  return tokens
}

const significant = (tokens: SqlToken[]): SqlToken[] => tokens.filter((token) => token.type !== 'space')

const upper = (token: SqlToken): string => (token.type === 'keyword' ? token.text.toUpperCase() : token.text)

const noSpaceBefore = (token: SqlToken): boolean =>
  token.type === 'punct' && [')', ',', ';', '.'].includes(token.text)

const noSpaceAfter = (prev: SqlToken | null): boolean =>
  !!prev && (prev.text === '(' || prev.text === '.' || (prev.type === 'punct' && prev.text === ';'))

function isBlockOpen(tokens: SqlToken[], index: number): boolean {
  for (let k = index + 1; k < tokens.length; k++) {
    const token = tokens[k]
    if (token.type === 'comment') continue
    return token.type === 'keyword' && ['SELECT', 'WITH', 'VALUES', 'TABLE'].includes(token.text.toUpperCase())
  }
  return false
}

export function formatSql(text: string, { indent = '  ', minify = false } = {}): string {
  const all = tokenizeSql(text)
  const tokens = significant(all)

  if (!tokens.length) return ''
  if (minify) return minifySql(tokens)

  let out = ''
  let depth = 0
  const stack: boolean[] = []
  let atLineStart = true
  let prev: SqlToken | null = null
  let afterComma = false

  const pad = (): string => indent.repeat(depth)
  const newline = (): void => {
    out = out.replace(/[ \t]+$/, '')
    if (out && !out.endsWith('\n')) out += '\n'
    atLineStart = true
    afterComma = false
  }
  const write = (value: string, spaceBefore: boolean): void => {
    if (atLineStart) {
      out += pad()
      atLineStart = false
    } else if (spaceBefore) {
      out += ' '
    }
    out += value
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const word = upper(token)

    if (token.type === 'comment') {
      if (token.text.startsWith('--')) {
        if (!atLineStart) newline()
        write(token.text, false)
        newline()
      } else {
        write(token.text, !atLineStart && !noSpaceAfter(prev))
        out += ' '
      }
      prev = token
      continue
    }

    if (token.text === ')') {
      const block = stack.pop() ?? false
      if (block) {
        depth = Math.max(0, depth - 1)
        newline()
      }
      write(')', false)
      prev = token
      continue
    }

    if (token.text === '(') {
      write('(', prev !== null && prev.type !== 'keyword' ? false : !noSpaceAfter(prev))
      const block = isBlockOpen(tokens, index)
      stack.push(block)
      if (block) {
        depth++
        newline()
      }
      prev = token
      continue
    }

    if (token.text === ',') {
      write(',', false)
      out += ' '
      prev = token
      afterComma = true
      continue
    }

    if (token.text === ';') {
      write(';', false)
      prev = token
      newline()
      continue
    }

    const clause = token.type === 'keyword' && CLAUSES.has(word)
    const joinModifier = token.type === 'keyword' && JOIN_MODIFIER.test(word)
    const joinWord = token.type === 'keyword' && word === 'JOIN'
    const attachedJoin =
      joinWord && prev?.type === 'keyword' && JOIN_MODIFIER.test(prev.text.toUpperCase())
    if ((clause || joinModifier || joinWord) && !atLineStart && !attachedJoin) {
      newline()
    }

    const spaceBefore = prev !== null && !atLineStart && !afterComma && !noSpaceBefore(token) && !noSpaceAfter(prev)
    write(word, spaceBefore)
    prev = token
    afterComma = false
  }

  return out.replace(/[ \t]+$/gm, '').trim()
}

function minifySql(tokens: SqlToken[]): string {
  let out = ''
  let prev: SqlToken | null = null
  for (const token of tokens) {
    if (token.type === 'comment') {
      if (token.text.startsWith('--')) continue
      out += token.text
      prev = token
      continue
    }
    const word = upper(token)
    if (!prev) {
      out += word
    } else if (noSpaceBefore(token) || noSpaceAfter(prev) || prev.text === ',') {
      out += word
    } else if (token.text === '(' && (prev.type === 'word' || prev.text === ')')) {
      out += word
    } else {
      out += ` ${word}`
    }
    prev = token
  }
  return out
}

const MESSAGES: Record<string, { zh: string; en: string }> = {
  empty: { zh: '内容为空', en: 'Input is empty' },
}

export function sqlErrorMessage(code: string, locale: Locale): string {
  return MESSAGES[code]?.[locale] ?? (locale === 'zh' ? 'SQL 格式化失败' : 'Failed to format SQL')
}

export interface SqlHighlightToken {
  type: 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'operator' | 'punct'
  text: string
}

/** 语法着色：复用词法结果，空白合并成 plain。 */
export function tokenizeSqlHighlight(text: string): SqlHighlightToken[] {
  return tokenizeSql(text).map((token): SqlHighlightToken => {
    if (token.type === 'space' || token.type === 'word') return { type: 'plain', text: token.text }
    return { type: token.type, text: token.text }
  })
}

export const SAMPLE_SQL = `select u.id,u.name,count(o.id) as orders from users u left join orders o on o.user_id=u.id where u.active=1 and o.created_at>='2024-01-01' group by u.id,u.name having count(o.id)>2 order by orders desc limit 10;`
