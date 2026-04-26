#!/usr/bin/env node
'use strict'

var NODE_MAJOR = process.versions.node.split('.').map(Number)[0]
if (NODE_MAJOR < 20) {
  process.stderr.write(
    'StructureClaw 需要 Node.js >= 20 (当前: ' + process.version + ')。\n' +
    '请升级: https://nodejs.org/\n'
  )
  process.exit(1)
}

var path = require('path')
var rootDir = path.resolve(__dirname, '..')

process.env.SCLAW_PROFILE = 'cn'

require('../scripts/cli/main')
  .main(process.argv.slice(2), { rootDir: rootDir })
  .then(
    function (code) { process.exitCode = code },
    function (err) { process.stderr.write(err.message + '\n'); process.exitCode = 1 }
  )
