#!/usr/bin/env node
'use strict'

var NODE_MAJOR = process.versions.node.split('.').map(Number)[0]
if (NODE_MAJOR < 20) {
  process.stderr.write(
    'StructureClaw requires Node.js >= 20 (current: ' + process.version + ').\n' +
    'Please upgrade: https://nodejs.org/\n'
  )
  process.exit(1)
}

var path = require('path')
var rootDir = path.resolve(__dirname, '..')

require('../scripts/cli/main')
  .main(process.argv.slice(2), { rootDir: rootDir })
  .then(
    function (code) { process.exitCode = code },
    function (err) { process.stderr.write(err.message + '\n'); process.exitCode = 1 }
  )
