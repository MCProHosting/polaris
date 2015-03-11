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
    },
    job: {
        // Number of times to retry an "ensured" job range before marking
        // it as failed and writing an error log.
        retries: 5,
        // How frequently instances communicate status updates to each other.
        heartbeat: 1000,
        // How to to wait after the last update before we mark a job as
        // "stale" and reassign it to a different node.
        staleTimeout: 2000,
    },
    redis: {
        // Options for redis-fantastico as seen in
        // https://github.com/MCProHosting/redis-fantastico
        check_interval: 10000,
        host: 'localhost',
        port: 6379,
        options: {}
    }
};
