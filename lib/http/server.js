var log = require('../log');
var bodyParser = require('body-parser');
var express = require('express');

var app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

module.exports = function (polaris, address) {

    require('./handlers/jobs')(app, polaris);

    var parts = address.split(':');
    if (parts.length === 1) {
        parts.push(3000);
    }
    app.listen(+parts[1], parts[0]);
    log.debug('API listening on ' + parts.join(':'));
};
