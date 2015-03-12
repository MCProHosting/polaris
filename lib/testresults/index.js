var _ = require('lodash');
var fs = require('fs');

/**
 * Parses an array of results into objects.
 * @param  {Array} results
 * @return {Array}
 */
function parse (results) {
    return _.map(results, function (result) {
        var parts = result.split('\t');
        return { date: +parts[0], point: +parts[1] };
    });
}
/**
 * Returns significant figures from the number.
 * @param  {Number} num
 * @param  {Number} figures
 * @return {String}
 */
function sigFigs (num, figures) {
    var delta = Math.pow(10, Math.ceil(Math.log(num) / Math.log(10)) - figures);

    return Math.round(num / delta) * delta;
}

/**
 * Takes an array of test results (from Redis) and outputs a nice
 * html page analysis.
 * @param  {Array} results
 * @return {String}
 */
module.exports.render = function (results) {
    var data = parse(results);
    var template = fs.readFileSync(__dirname + '/template.html', { encoding: 'utf8' });

    return _.template(template)({ data: data });
};

/**
 * Takes an array of results and outputs a short analysis to the
 * console.
 * @param  {Array} results
 */
module.exports.log = function (results) {
    var data = parse(results);
    var maxInData = _.max(data, 'point').point;
    var minInData = _.min(data, 'point').point;

    var range = maxInData - minInData;
    var duplicates = 0, missing = 0;
    for (var i = minInData; i < maxInData; i++) {
        var amt = _.where(data, { point: i }).length;
        if (amt === 0) {
            missing++;
        }
        if (amt > 1) {
            duplicates++;
        }
    }
    console.log(range + ' items of work done total.');
    console.log(
        sigFigs(duplicates, 3) + ' duplicates (%' +
        sigFigs(duplicates / range * 100, 3) + ')'
    );
    console.log(
        sigFigs(missing, 3) + ' missing (%' +
        sigFigs(missing / range * 100, 3) + ')'
    );
};
