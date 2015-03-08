var util = require('util');
var Master = require('../_master');

function TestMaster () {
    Master.apply(this, arguments);
    this._name = 'test';
}
util.inherits(TestMaster, Master);

module.exports = TestMaster;
