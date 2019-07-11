#!/usr/bin/env node

const fabricator = require('../lib/index')
const chalk = require('chalk')
require('dotenv').config()

const levelColors = {
  debug: 'gray',
  info: 'white',
  warn: 'yellow',
  error: 'red'
}

const debugOut = {
  write: function (data) {
    const entry = JSON.parse(data)
    const levelColor = levelColors[entry.level]
    console.log(`${chalk[levelColor](entry.time)} - ${chalk[levelColor](entry.level)} ${entry.message}`)
  }
}

require('yargs') // eslint-disable-line no-unused-expressions
  .usage('$0 <command> [options]')
  .command(require('../lib/commands/init')(fabricator, debugOut))
  .command(require('../lib/commands/create')(fabricator, debugOut))
  .demandCommand(1, 'A command is required.')
  .help()
  .version()
  .argv
