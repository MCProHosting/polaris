#!/usr/bin/env node
var program = require('commander');
var _ =  require('lodash');
var pack = require('../package');

var Polaris = require('../lib/polaris');
var serve = require('../lib/http/server');
var polaris;

program
    .version(pack.version)
    .option('-s, --serve [host:port]', 'Runs the web interface and API on the address.')
    .option('-c, --chronic', 'Workers suffer from a chronic disease and die after a time.');

//
// Command that starts several polaris instances and runs a test command.
// Workers are dispatched with -c.
//
program
    .command('test')
    .description('Runs a Polaris cluster to test stability.')
    .option('-from, --from [number]', 'Sets the start of the command range.')
    .option('-to, --to [number]', 'Sets the end of the command range.')
    .option('-w, --workers [number]', 'Sets the number of Polaris workers.')
    .action(function (options) {
        var cmd = '"' + process.execPath + '" ' + __dirname + '/polaris run -c';
        var exec = require('child_process').exec;
        var request = require('request');

        _.range(1, +options.workers + 1 ).forEach(function boot (i) {
            exec(
                cmd + (i === 1 ? ' -s 127.0.0.1:3000' : ''),
                { env: { NODE_APP_INSTANCE: i }},
                function(error, stdout, stderr) {
                    if (error !== null) {
                        console.log('stdout: ' + stdout);
                        console.log('stderr: ' + stderr);
                    }

                    boot(i);
                }
            );
        });

        setTimeout(function () {
            request.post('http://127.0.0.1:3000/api/v1/jobs', { form: {
                name: 'test',
                start: options.from,
                end: options.to
            }});
        }, 5000);
    });

//
// Saves test results from redis into the cwd.
//
program
    .command('testresults')
    .description('Saves test results in the cwd')
    .action(function () {
        var redis = require('../lib/db/redis');
        setTimeout(function () {
            redis.getMaster().client.lrange('polarisTest', 0, 1 << 30, function (err, results) {
                var html = require('../lib/testresults')(results);
                require('fs').writeFileSync('results.html', html);
                process.exit(0);
            });
        }, 500);
    });

//
// Standard run of the Polaris instance
//
program
    .command('run')
    .action(run);

program.parse(process.argv);

function run () {
    polaris = new Polaris().boot();

    if (program.serve) {
        serve(polaris, program.serve);
    }

    if (program.chronic) {
        setTimeout(function () {
            throw new Error('Worker died of a chronic condition');
        }, ~~(15 * 1000 + (Math.random() * 60 * 1000)));
    }
}


