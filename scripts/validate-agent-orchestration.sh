#!/usr/bin/env node

const path = require("node:path");

require("./cli/regressions/run-validation")
  .runFromFilename(__filename, path.resolve(__dirname, ".."))
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
