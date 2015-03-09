var _ = require('lodash');

module.exports = function (app, polaris) {
    // Endpoint that lists the IDs of all current jobs.
    app.get('/api/v1/jobs', function (req, res) {
        var jobs = _.values(polaris.getJobs());

        res.json(jobs.map(function (job) {
            return {
                id: job.getJob().getId()
            };
        }));
    });

    // Endpoint that gets all the job's ranges
    app.get('/api/v1/jobs/:id', function (req, res) {
        var job = polaris.findJob(req.params.id);

        if (!job) {
            res.status(404).json('Job not found.');
        } else {
            res.json(job.getJob().getRanges());
        }
    });

    // Endpoint to start a new job manually
    app.post('/api/v1/jobs', function (req, res) {
        polaris.createJob(req.body.name, req.body);
        res.status(200).json('Job started.');
    });
};
