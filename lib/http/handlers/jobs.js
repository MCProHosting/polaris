var _ = require('lodash');

module.exports = function (app, polaris) {
    // Endpoint that lists the IDs of all current jobs.
    app.get('/api/v1/jobs', function (req, res) {
        var jobs = _.values(polaris.getJobs);

        res.json(jobs.map(function (job) {
            return {
                id: job.getJob()
            };
        }));
    });

    // Endpoint that gets all the job's ranges
    app.get('/api/v1/jobs/:id', function (req, res) {
        var job = polaris.findJob(req.params.id);

        if (!job) {
            res.json(404, 'Job not found.');
        } else {
            res.json(job.getJob().ranges);
        }
    });
};
