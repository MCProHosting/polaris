var util = require('util');

function InvalidJob(message) {
    Error.call(this);
    this.message = message;
}
util.inherits(InvalidJob, Error);


module.exports = {
    InvalidJob: InvalidJob
};
