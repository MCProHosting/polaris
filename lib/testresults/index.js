var _ = require('lodash');
var fs = require('fs');

/**
 * Takes an array of test results (from Redis) and outputs a nice
 * html page analysis.
 * @param  {Array} results
 * @return {String}
 */
module.exports = function (results) {
    var data = _.map(results, function (result) {
        var parts = result.split('\t');
        return { date: +parts[0], point: ~~result[1] };
    });

    var template = fs.readFileSync(__dirname + '/template.html', { encoding: 'utf8' });

    return _.template(template)({ data: data });
};
