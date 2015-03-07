module.exports = {
    log: {
        // Standard log4j log level
        level: 'trace'
    },
    raft: {
        // List of other members of the Raft cluster. It's recommended to have
        // at least four members. These may be other instances on the same
        // node or many instances across separate nodes.
        cluster: [
            'tcp://127.0.0.1:8081',
            'tcp://127.0.0.1:8082',
            'tcp://127.0.0.1:8083',
            'tcp://127.0.0.1:8084',
        ],
        // The address this instance is running under. It does not need
        // to be in the "cluster" array above.
        self: 'tcp://127.0.0.1:8081',
        // See https://github.com/unshiftio/liferaft#configuration for the
        // options list, and http://raftconsensus.github.io/ for what the
        // values actually mean.
        settings: {
            'election min': 2000,
            'election max': 5000,
            'heartbeat': 1000
        }
    }
};
