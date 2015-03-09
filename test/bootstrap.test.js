var Polaris = require('../lib/polaris');
var Raft = require('../lib/raft/_base');

beforeEach(function () {
    this.polaris = new Polaris();
    this.raft = this.polaris._raft = new Raft();
    this.raft.LEADER = 'leader';
});
