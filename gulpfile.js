var exec = require('child_process').exec;
const gulp = require('gulp');
const shell = require('gulp-shell');
const vstsBump = require('gulp-vsts-bump');
const fs = require('file-system');
const es = require('event-stream');
const debug = require('gulp-debug');
const del = require('del');
const moment = require('moment');
const inlinesource = require('gulp-inline-source');
const params = require('./build/parameters');
const spawn = require('child_process').spawn;

console.log('Is It a Local Build? ' + params.isRunningOnADO);
function bumpVersion() {
    return gulp.src(['tasks/**/task.json'], { base: './' })
        .pipe(vstsBump({ type: 'patch' }))
        .pipe(gulp.dest('./'));
}

function cleanCoverage() {
    return del('coverage/**', { force: true });
}

function gitAddCommit(done) {
    return shell.task(['git add --a', 'git commit -a -m "[CHORE] Update & Publish"'])(done());
}

function inlineCoverageSource() {
    return gulp.src('./coverage/*.html')
        .pipe(inlinesource({ attribute: false }))
        .pipe(gulp.dest('./coverage/inline-html'));
}

function printVersion(done) {
    let name = require('./package.json').version;

    if (process.env.BUILD_REASON === 'PullRequest') {
        // pull requests will be [version]_[source branch name]
        const branchName = process.env.SYSTEM_PULLREQUEST_SOURCEBRANCH;
        name += '_' + branchName.replace(/refs\/heads\/(feature\/)?/i, '');
    } else if (process.env.BUILD_SOURCEBRANCHNAME) {
        const branchName = process.env.BUILD_SOURCEBRANCH;

        if (branchName !== 'master') {
            // all branches have refs/heads/ - we don't need that
            // we will also remove feature/ if it's there
            name += '_' + branchName.replace(/refs\/heads\/(feature\/)?/i, '');
        }
    }

    // make sure no illegal characters are there
    name = name.replace(/\"|\/|:|<|>|\\|\|\?|\@|\*/g, '_');

    // add YYYYMMDD_HHmm to mark the date and time of this build
    name += `_${moment().format('YYYYMMDD.HHmm')}`;

    console.log('##vso[build.updatebuildnumber]' + name);
    done();
}

function packageExtension(done) {
    var child = exec('tfx extension create --root . --output-path ' + process.env.EXTENSIONDIRECTORY + ' --manifest-globs vss-extension.json --rev-version');
    child.stdout.on('data', function (data) {
        console.log('stdout: ' + data);
    });
    child.stderr.on('data', function (data) {
        console.log('stderr: ' + data);
    });
    child.on('error', function (errors) {
        console.log('Comand Errors: ' + errors);
        error(errors);
    });
    child.on('close', function (code) {
        console.log('closing code: ' + code);
        done(null, code);
    });
}

function publishExtension(done) {
    var child = exec('tfx extension publish --root . --share-with ' + process.env.ORGSHARE +' --token ' + process.env.VSMARKETPLACETOKEN + ' --output-path ' + process.env.EXTENSIONDIRECTORY + ' --manifest-globs vss-extension.json --rev-version');
    child.stdout.on('data', function (data) {
        console.log('stdout: ' + data);
    });
    child.stderr.on('data', function (data) {
        console.log('stderr: ' + data);
    });
    child.on('error', function (errors) {
        console.log('Comand Errors: ' + errors);
        error(errors);
    });
    child.on('close', function (code) {
        console.log('closing code: ' + code);
        done(null, code);
    });
}

function setupCoveragePool() {
    return gulp.src("tasks/**/*.ts").pipe(writeFilenameToFile()).pipe(debug());
}

function sonarQube(done) {
	if (!parms.isRunningOnADO) {
		console.log('Skipping SonarQube analysis for local build...');
		done();
	}
	else {
		let version = require('./package.json').version;
		//standard SonarQube configuration options
		let sonarOptions = {
			"sonar.projectName": "Azure-Bake-ADO",
			"sonar.projectKey": "azure-bake-ado",
			"sonar.typescript.lcov.reportPaths": "coverage/lcov.info",
			"sonar.projectVersion": version,
			//"sonar.cpd.exclusions": "src/index.html, dist/index.html",
			"sonar.coverage.exclusions": "**/*.spec.ts, gulpfile.js, karma.conf.js, protractor.conf.js, **/node_modules/*"
		};

		//get source branch name
		let sourceBranch = (process.env.BUILD_REASON === 'PullRequest') ? process.env.SYSTEM_PULLREQUEST_SOURCEBRANCH : process.env.BUILD_SOURCEBRANCH;
		sourceBranch = sourceBranch.replace(/refs\/heads\//i, '');

		//if running from a pull request, add the target branch option
		if (process.env.BUILD_REASON === 'PullRequest') {
			sonarOptions["sonar.branch.target"] = process.env.SYSTEM_PULLREQUEST_TARGETBRANCH.replace(/refs\/heads\//i, '');
		}

		//if not running on the master branch, add the source branch option
		if (sourceBranch != 'master') {
			sonarOptions["sonar.branch.name"] = sourceBranch
		}

		sonarqubeScanner({
			serverUrl: "https://sonarqube.hchb.com",
			token: argv.sonarToken,
			options: sonarOptions
		}, done);
	}
}

function testNycMocha(done) {
    return shell.task(['nyc mocha --opts test/mocha.opts'])(done());
}

function tfxInstall(done) {
    var child = exec("npm remove tfx-cli && npm install --global tfx-cli");
    child.stdout.on('data', function (data) {
        console.log('stdout: ' + data);
    });
    child.stderr.on('data', function (data) {
        console.log('stderr: ' + data);
    });
    child.on('error', function (errors) {
        console.log('Comand Errors: ' + errors);
        error(errors);
    });
    child.on('close', function (code) {
        console.log('closing code: ' + code);
        done(null, code);
    });
}

function uploadExtension (done) {
    if (true) {
        gulp.series(bumpVersion, publishExtension, gitAddCommit)(done());
    }
    else { done('Failed to Upload Extension'); }
}
function writeFilenameToFile() {
    let output = fs.createWriteStream(__dirname + '/test/app.spec.ts');
    output.write('// I am an automatically generated file. I help ensure that unit tests have accurate code coverage numbers. You can ignore me.\n\n')
    //Return event-stream map to the pipeline
    return es.map((file, cb) => {
        let name = file.history[0];
        if (name) {
            name = name.replace(__dirname + '.').replace(/\\/g, '/');
            output.write('require(\'' + name + '\');\n');
        }
        //Callback signals the operation is done and returns the object to the pipeline
        cb(null, file);
    });
}

exports.coverage = gulp.series(cleanCoverage, setupCoveragePool, testNycMocha);
exports.pretest = gulp.series(cleanCoverage, setupCoveragePool);
exports.analysis = gulp.series(sonarQube);
exports.package = gulp.series(tfxInstall, packageExtension);
exports.publish = gulp.series(tfxInstall, publishExtension);
exports.bump = bumpVersion;
exports.commit = gitAddCommit;
exports.cleancoverage = cleanCoverage;
exports.setupcoveragepool = setupCoveragePool;
exports.inlinecoveragesource = inlineCoverageSource;
exports.packageextension = packageExtension;
exports.printversion = printVersion;
exports.testnycmocha = testNycMocha;
exports.tfxinstall = tfxInstall;
exports.upload = uploadExtension;
