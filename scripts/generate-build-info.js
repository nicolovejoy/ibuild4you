const fs = require('fs')
const path = require('path')

const now = new Date()
const formatted = now.toLocaleString('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const buildInfo = { buildTime: formatted }
const outPath = path.join(__dirname, '..', 'lib', 'build-info.json')

fs.writeFileSync(outPath, JSON.stringify(buildInfo, null, 2) + '\n')
console.log(`Build info written: ${formatted}`)
