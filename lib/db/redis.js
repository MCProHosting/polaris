var config = require('config');
var fantastico = require('redis-fantastico');

fantastico.create(config.get('redis'));
fantastico.instance.initialize();

module.exports = fantastico.instance;
