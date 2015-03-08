var Raft = require('../lib/raft/axon');
var config = require('config');
var raft = new Raft(config.get('raft.self'), config.get('raft.cluster')).boot();

raft.on('data', function () {
    console.log(arguments);
});
raft.on('leader', function () {
    console.log('leader');
});
raft.on('follower', function () {
    console.log('follower');
});
raft.on('initialized', function () {
    console.log('initialized');
});
raft.on('error', function (err) {
    console.error(err);
});

raft.on('greet', function (data) {
    console.log('We have been greeted!', data);
});

setInterval(function () {
    raft.writeTo(raft.LEADER, 'greet', { hello: 'world' });
}, 3000);
