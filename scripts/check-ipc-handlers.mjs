import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = 'e4a24e8280755e300b4337226de49da396bc1095'
const relativePath = 'src/main/index.ts'
const baseSource = execFileSync('git', ['show', `${base}:${relativePath}`], { encoding: 'utf8' })
const workingSource = readFileSync(resolve(relativePath), 'utf8')

function handlerNames(source) {
  return [...source.matchAll(/ipcMain\.handle\s*\(\s*(['"])([^'"]+)\1/g)].map((match) => match[2])
}

const baseHandlers = handlerNames(baseSource)
const currentHandlers = handlerNames(workingSource)
const currentSet = new Set(currentHandlers)
const missing = [...new Set(baseHandlers)].filter((name) => !currentSet.has(name))
const added = [...new Set(currentHandlers)].filter((name) => !new Set(baseHandlers).has(name))

console.log(`Base handlers: ${baseHandlers.length}`)
console.log(`Working handlers: ${currentHandlers.length}`)
console.log(`Added handlers: ${added.length}${added.length ? ` (${added.join(', ')})` : ''}`)
if (missing.length) {
  console.error(`Missing base handlers (${missing.length}): ${missing.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('Missing base handlers: 0')
}