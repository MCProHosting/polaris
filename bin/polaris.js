#!/usr/bin/env node
var program = require('commander');
var pack = require('../package');

var Polaris = require('../lib/polaris');
var serve = require('../lib/http/server');

program
    .version(pack.version)
    .option('-s, --serve [host:port]', 'Runs the web interface and API on the address.')
    .parse(process.argv);

var polaris = new Polaris().boot();
if (program.serve) {
    serve(polaris, program.serve);
}

