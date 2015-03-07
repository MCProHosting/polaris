var config = require('config');
var bunyan = require('bunyan');

var logger = bunyan.createLogger({
    name: 'polaris',
    streams: [
        { level: config.get('log.level'), stream: process.stdout }
    ],
    level: 'info'
});

module.exports = logger;
