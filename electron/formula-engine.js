// 安全公式子集引擎：解析与求值 Excel 常用公式，用于写入前的依赖检查与写入后的重算抽验。
// 只支持白名单函数与有限语法，绝不使用 eval；不支持的函数明确报“超出本地重算能力”。

const SUPPORTED_FUNCTIONS = new Set([
  'IF', 'IFERROR', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ABS', 'MAX', 'MIN',
  'SUM', 'AVERAGE', 'COUNT', 'COUNTA'
])
const MAX_RANGE_CELLS = 10000

class FormulaError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}

function tokenize(formula) {
  const tokens = []
  const text = String(formula).replace(/^=/, '')
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (/\s/.test(char)) { index += 1; continue }
    if (/[0-9.]/.test(char)) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(text.slice(index))
      if (!match) throw new FormulaError('#VALUE!', '数字格式无效')
      tokens.push({ type: 'number', value: Number(match[0]) })
      index += match[0].length
      continue
    }
    if (/[A-Za-z_$]/.test(char)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(text.slice(index))
      tokens.push({ type: 'ident', value: match[0] })
      index += match[0].length
      continue
    }
    if (char === '"') {
      const end = text.indexOf('"', index + 1)
      if (end === -1) throw new FormulaError('#VALUE!', '字符串缺少结束引号')
      tokens.push({ type: 'string', value: text.slice(index + 1, end) })
      index = end + 1
      continue
    }
    const two = text.slice(index, index + 2)
    if (['>=', '<=', '<>'].includes(two)) {
      tokens.push({ type: 'op', value: two })
      index += 2
      continue
    }
    if ('+-*/^%(),:=<>'.includes(char)) {
      tokens.push({ type: 'op', value: char })
      index += 1
      continue
    }
    throw new FormulaError('#VALUE!', `无法识别的字符: ${char}`)
  }
  return tokens
}

function parse(formula) {
  const tokens = tokenize(formula)
  let position = 0
  const peek = () => tokens[position]
  const next = () => tokens[position++]
  const expect = (value) => {
    const token = next()
    if (!token || token.value !== value) throw new FormulaError('#VALUE!', `公式缺少 ${value}`)
    return token
  }

  function parseExpr() { return parseComparison() }

  function parseComparison() {
    const left = parseAdditive()
    const token = peek()
    if (token && token.type === 'op' && ['=', '<>', '>', '>=', '<', '<='].includes(token.value)) {
      next()
      return { type: 'compare', op: token.value, left, right: parseAdditive() }
    }
    return left
  }

  function parseAdditive() {
    let left = parseMultiplicative()
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value
      left = { type: 'binary', op, left, right: parseMultiplicative() }
    }
    return left
  }

  function parseMultiplicative() {
    let left = parseUnary()
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value
      left = { type: 'binary', op, left, right: parseUnary() }
    }
    return left
  }

  function parseUnary() {
    const token = peek()
    if (token && token.type === 'op' && (token.value === '-' || token.value === '+')) {
      next()
      const operand = parseUnary()
      return token.value === '-' ? { type: 'neg', operand } : operand
    }
    return parsePower()
  }

  function parsePower() {
    const base = parsePostfix()
    const token = peek()
    if (token && token.type === 'op' && token.value === '^') {
      next()
      return { type: 'binary', op: '^', left: base, right: parseUnary() }
    }
    return base
  }

  function parsePostfix() {
    let node = parsePrimary()
    while (peek() && peek().type === 'op' && peek().value === '%') {
      next()
      node = { type: 'percent', operand: node }
    }
    return node
  }

  function parseCellRef(name) {
    const match = /^\$?([A-Za-z]{1,3})\$?([0-9]+)$/.exec(name)
    if (!match) throw new FormulaError('#NAME?', `无法识别的名称: ${name}`)
    return { type: 'cell', column: match[1].toUpperCase(), row: Number(match[2]) }
  }

  function parsePrimary() {
    const token = next()
    if (!token) throw new FormulaError('#VALUE!', '公式意外结束')
    if (token.type === 'number') return { type: 'number', value: token.value }
    if (token.type === 'string') return { type: 'string', value: token.value }
    if (token.type === 'op' && token.value === '(') {
      const inner = parseExpr()
      expect(')')
      return inner
    }
    if (token.type === 'ident') {
      const name = token.value
      const nextToken = peek()
      if (nextToken && nextToken.type === 'op' && nextToken.value === '(') {
        next()
        const args = []
        if (!(peek() && peek().type === 'op' && peek().value === ')')) {
          args.push(parseExpr())
          while (peek() && peek().type === 'op' && peek().value === ',') {
            next()
            args.push(parseExpr())
          }
        }
        expect(')')
        return { type: 'call', name: name.toUpperCase(), args }
      }
      const cell = parseCellRef(name)
      if (nextToken && nextToken.type === 'op' && nextToken.value === ':') {
        next()
        const endToken = next()
        if (!endToken || endToken.type !== 'ident') throw new FormulaError('#VALUE!', '区域引用缺少结束单元格')
        return { type: 'range', from: cell, to: parseCellRef(endToken.value) }
      }
      return cell
    }
    throw new FormulaError('#VALUE!', `意外的记号: ${token.value}`)
  }

  const ast = parseExpr()
  if (position !== tokens.length) throw new FormulaError('#VALUE!', '公式末尾有多余内容')
  return ast
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return (value.getTime() - Date.UTC(1899, 11, 30)) / 86400000
  const text = String(value).trim()
  const numeric = Number(text)
  if (text !== '' && !Number.isNaN(numeric)) return numeric
  throw new FormulaError('#VALUE!', `非数值: ${value}`)
}

function truthy(value) {
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'boolean') return value
  if (value === null || value === undefined || value === '') return false
  return Boolean(String(value))
}

function expandRange(range, getCell) {
  const fromCol = columnIndex(range.from.column)
  const toCol = columnIndex(range.to.column)
  const fromRow = Math.min(range.from.row, range.to.row)
  const toRow = Math.max(range.from.row, range.to.row)
  const span = (Math.abs(toCol - fromCol) + 1) * (toRow - fromRow + 1)
  if (span > MAX_RANGE_CELLS) throw new FormulaError('#VALUE!', '区域过大，超出本地重算上限')
  const values = []
  for (let column = Math.min(fromCol, toCol); column <= Math.max(fromCol, toCol); column += 1) {
    for (let row = fromRow; row <= toRow; row += 1) {
      values.push(getCell({ column: columnLetters(column), row }))
    }
  }
  return values
}

function columnIndex(letters) {
  let number = 0
  for (const char of letters) number = number * 26 + char.charCodeAt(0) - 64
  return number
}

function columnLetters(index) {
  let value = index
  let letters = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    value = Math.floor((value - 1) / 26)
  }
  return letters
}

function flattenValues(args, getCell) {
  const values = []
  for (const arg of args) {
    const value = evaluateNode(arg, getCell)
    if (value && value.__range) values.push(...value.values)
    else values.push(value)
  }
  return values
}

function callFunction(ast, getCell) {
  const name = ast.name
  if (!SUPPORTED_FUNCTIONS.has(name)) throw new FormulaError('#NAME?', `函数 ${name} 超出本地重算能力`)
  switch (name) {
    case 'IF': {
      if (ast.args.length !== 3) throw new FormulaError('#VALUE!', 'IF 需要 3 个参数')
      return truthy(evaluateNode(ast.args[0], getCell))
        ? evaluateNode(ast.args[1], getCell)
        : evaluateNode(ast.args[2], getCell)
    }
    case 'IFERROR': {
      if (ast.args.length !== 2) throw new FormulaError('#VALUE!', 'IFERROR 需要 2 个参数')
      try {
        return evaluateNode(ast.args[0], getCell)
      } catch (error) {
        if (error instanceof FormulaError) return evaluateNode(ast.args[1], getCell)
        throw error
      }
    }
    case 'ROUND':
    case 'ROUNDUP':
    case 'ROUNDDOWN': {
      if (ast.args.length < 1 || ast.args.length > 2) throw new FormulaError('#VALUE!', `${name} 参数数量无效`)
      const value = toNumber(evaluateNode(ast.args[0], getCell))
      const digits = ast.args[1] !== undefined ? toNumber(evaluateNode(ast.args[1], getCell)) : 0
      const factor = 10 ** digits
      if (name === 'ROUND') return Math.round(value * factor) / factor
      if (name === 'ROUNDUP') return (value < 0 ? -1 : 1) * Math.ceil(Math.abs(value) * factor) / factor
      return (value < 0 ? -1 : 1) * Math.floor(Math.abs(value) * factor) / factor
    }
    case 'ABS': return Math.abs(toNumber(evaluateNode(ast.args[0], getCell)))
    case 'MAX':
    case 'MIN': {
      const numbers = flattenValues(ast.args, getCell).filter((value) => typeof value === 'number' || (!Number.isNaN(Number(value)) && value !== '' && value !== null && value !== undefined)).map(toNumber)
      if (numbers.length === 0) return 0
      return name === 'MAX' ? Math.max(...numbers) : Math.min(...numbers)
    }
    case 'SUM': {
      const values = flattenValues(ast.args, getCell)
      let total = 0
      for (const value of values) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue
        total += toNumber(value)
      }
      return total
    }
    case 'AVERAGE': {
      const numbers = flattenValues(ast.args, getCell)
        .filter((value) => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean')
        .map(toNumber)
      if (numbers.length === 0) throw new FormulaError('#DIV/0!')
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    }
    case 'COUNT':
      return flattenValues(ast.args, getCell).filter((value) => {
        if (typeof value === 'number' || value instanceof Date) return true
        if (typeof value !== 'string') return false
        return value.trim() !== '' && !Number.isNaN(Number(value.trim()))
      }).length
    case 'COUNTA':
      return flattenValues(ast.args, getCell).filter((value) => value !== null && value !== undefined && value !== '').length
    default:
      throw new FormulaError('#NAME?', `函数 ${name} 超出本地重算能力`)
  }
}

function evaluateNode(ast, getCell) {
  switch (ast.type) {
    case 'number': return ast.value
    case 'string': return ast.value
    case 'percent': return toNumber(evaluateNode(ast.operand, getCell)) / 100
    case 'neg': return -toNumber(evaluateNode(ast.operand, getCell))
    case 'cell': return getCell({ column: ast.column, row: ast.row })
    case 'range': return { __range: true, values: expandRange(ast, getCell) }
    case 'compare': {
      const left = evaluateNode(ast.left, getCell)
      const right = evaluateNode(ast.right, getCell)
      let result
      try {
        const a = toNumber(left)
        const b = toNumber(right)
        result = ast.op === '=' ? a === b : ast.op === '<>' ? a !== b : ast.op === '>' ? a > b : ast.op === '>=' ? a >= b : ast.op === '<' ? a < b : a <= b
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error
        const a = String(left ?? '').toLowerCase()
        const b = String(right ?? '').toLowerCase()
        result = ast.op === '=' ? a === b : ast.op === '<>' ? a !== b : ast.op === '>' ? a > b : ast.op === '>=' ? a >= b : ast.op === '<' ? a < b : a <= b
      }
      return result ? 1 : 0
    }
    case 'binary': {
      const left = toNumber(evaluateNode(ast.left, getCell))
      const right = toNumber(evaluateNode(ast.right, getCell))
      switch (ast.op) {
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        case '/':
          if (right === 0) throw new FormulaError('#DIV/0!')
          return left / right
        case '^': return left ** right
        default: throw new FormulaError('#VALUE!', `不支持的运算: ${ast.op}`)
      }
    }
    case 'call': return callFunction(ast, getCell)
    default: throw new FormulaError('#VALUE!', '公式结构无效')
  }
}

function evaluateFormula(formula, getCell) {
  return evaluateNode(parse(formula), getCell)
}

function analyzeFormula(formula) {
  const ast = parse(formula)
  const cellRefs = []
  const rangeSpans = []
  const functions = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'cell') cellRefs.push(node)
    else if (node.type === 'range') { cellRefs.push(node.from, node.to); rangeSpans.push(node) }
    else if (node.type === 'call') functions.push(node.name)
    for (const key of ['left', 'right', 'operand', 'from', 'to']) if (node[key]) visit(node[key])
    if (Array.isArray(node.args)) node.args.forEach(visit)
  }
  visit(ast)
  const unsupported = functions.filter((name) => !SUPPORTED_FUNCTIONS.has(name))
  return { ast, cellRefs, rangeSpans, functions, unsupported }
}

module.exports = {
  SUPPORTED_FUNCTIONS,
  FormulaError,
  analyzeFormula,
  evaluateFormula,
  columnIndex,
  columnLetters
}
