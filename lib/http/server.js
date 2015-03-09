var log = require('../log');
var express = require('express');
var app = express();

module.exports = function (polaris, address) {

    require('./handlers/jobs')(app, polaris);

    var parts = address.split(':');
    if (parts.length === 1) {
        parts.push(3000);
    }
    app.listen(+parts[1], parts[0]);
    log.debug('API listening on ' + parts.join(':'));
};
