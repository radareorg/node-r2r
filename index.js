const promiseConcurrency = 8;
const timeoutFuzzed = 120 * 1000;

const co = require('co');
const colors = require('colors/safe');
const promisify = require('util').promisify;
const walk = require('walk').walk;
const fs = require('fs');
const fsWriteFile = promisify(fs.writeFile);
const tmp = require('tmp');
const zlib = require('zlib');
const path = require('path');
const spawn = require('child_process').spawn;
const spawnSync = require('child_process').spawnSync;
const r2promise = require('r2pipe-promise');
const common = require('./lib/common');
const promiseLimit = require('promise-limit');

const limit = promiseLimit(promiseConcurrency);

if (process.env.NOOK !== "0" && (process.env.TRAVIS || process.env.APPVEYOR)) {
  process.env.NOOK = 1;
} else if (process.env.NOOK === "0") {
  delete process.env.NOOK;
}

function newPromise (cb) {
  return limit(_ => new Promise(cb));
}

// support node < 8
if (!String.prototype.padStart) {
  // XXX
  String.prototype.padStart = function padStart (targetLength, padString) {
    targetLength = targetLength >> 0; // floor if number or convert non-number to 0;
    padString = String(padString || ' ');
    if (this.length > targetLength) {
      return String(this);
    }
    targetLength = targetLength - this.length;
    if (targetLength > padString.length) {
      padString += padString.repeat(targetLength / padString.length); // append to original to ensure we are longer than needed
    }
    return padString.slice(0, targetLength) + String(this);
  };
}

// set this to false to avoid creating files
let useScript = true;

/* radare2 binary name */
const r2bin = 'radare2';

class NewRegressions {
  constructor (argv, cb) {
    this.argv = argv;
    this.queue = [];
    this.fixed = [];
    this.report = {
      total: 0,
      success: 0,
      failed: 0,
      broken: 0,
      fixed: 0,
      totaltime: 0
    };
    useScript = !this.argv.c;
    this.verbose = this.argv.verbose || this.argv.v;
    this.interactive = this.argv.interactive || this.argv.i;
    this.debase64 = this.argv.debase64;
    this.format = this.argv.format;
    this.to_eof = this.argv['to-eof'];
    if ((this.debase64 || this.format || this.to_eof) && process.platform === 'win32') {
      // since r2r on Windows modifies tests on-the-fly...
      console.log('Do not run --debase64, --format or --to-eof on Windows!');
      process.exit(1);
    }
    this.promises = [];
    r2promise.open('-').then(r2 => {
      this.r2 = r2;
      cb(null, r2);
    }).catch(e => {
      cb(e);
    });
    this.start = new Date();
  }
  callbackFromPath (from) {
    for (let row of [
      [path.join('db', 'anal'), this.runTest],
      [path.join('db', 'archos'), this.runTest],
      [path.join('db', 'cmd'), this.runTest],
      [path.join('db', 'esil'), this.runTest],
      [path.join('db', 'extras'), this.runTest],
      [path.join('db', 'formats'), this.runTest],
      [path.join('db', 'io'), this.runTest],
      [path.join('db', 'tools'), this.runTest]
    ]) {
      const [txt, cb] = row;
      if (from.indexOf(txt) !== -1) {
        return cb;
      }
    }
    return null;
  }

  quit () {
    const promise = this.r2 !== null
      ? this.r2.quit()
      : new Promise(resolve => resolve());
    this.r2 = null;
    return promise;
  }

  runTestAsm (test, cb) {
    const self = this;
    return newPromise((resolve, reject) => {
      try {
        co(function * () {
          try {
            if (test.args) {
              // yield breaks some tests. wtf
              self.r2.cmd(test.args);
            }
            test.stdout = yield self.r2.cmd(test.cmd);
            return resolve(cb(test));
          } catch (e) {
            return reject(e);
          }
        });
      } catch (e) {
        console.error(e);
        reject(e);
      }
    });
  }

  runTestJson (test, cb) {
    const self = this;
    return newPromise((resolve, reject) => {
      if (test.path) {
        self.r2.cmd('o ' + test.path + '; o-!; aaa')
        .then((_) => {
          self.r2.cmd(test.cmd)
          .then((res) => {
            test.stdout = res;
            resolve(cb(test));
          }).catch(reject);
        }).catch(reject);
      } else {
        self.r2.cmd(test.cmd)
        .then((res) => {
          test.stdout = res;
          resolve(cb(test));
        }).catch(reject);
      }
    });
  }

  runTestFuzz (test, cb) {
    return newPromise((resolve, reject) => {
      try {
        co(function * () {
          const args = ['-c', '?e init', '-qcq', '-A', test.path];
          test.birth = new Date();
          const child = spawnSync(r2bin, args, {timeout: timeoutFuzzed});
          test.death = new Date();
          test.lifetime = test.death - test.birth;
          if (child.error) {
            test.fuzz = true;
            test.expectErr = 'N';
            test.stderr = 'X';
            test.spawnArgs = args;
            test.cmdScript = '';
            return reject(cb(test));
          } else {
            return resolve(cb(test));
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  runTest (test, cb) {
    return newPromise((resolve, reject) => {
      if (this.argv.l) {
        console.log(test.from.replace('db/', ''), test.name);
        return resolve();
      }
      co(function * () {
        const args = [
          '-escr.utf8=0',
          '-escr.color=0',
          '-escr.interactive=0',
          '-N',
          '-Q'
        ];
        if (process.env.APPVEYOR && process.env.ANSICON === undefined) {
          process.env['ANSICON'] = 'True';
        }
        // Append custom r2 args
        if (test.args && test.args.length > 0) {
          args.push(...test.args.split(' '));
        }
        try {
          if (useScript) {
            // TODO much slower than just using -c
            test.tmpScript = yield createTemporaryFile();
            // TODO use yield here
            yield fsWriteFile(test.tmpScript, test.cmdScript);
            args.push('-i', test.tmpScript);
          } else {
            if (!test.cmds && test.cmdScript) {
              test.cmds = test.cmdScript.split('\n');
            }
            args.push('-c', test.cmds.join(';'));
          }
          if (!test.file) {
            test.file = ['-'];
          }
          // Append test binary filename(s)
          args.push(...test.file);
          if (test.oneStream) {
            args.unshift('-escr.onestream=1');
            args.push('2>&1');
          }

          let res = '';
          let ree = '';
          test.spawnArgs = args;

          // Set or unset NOPLUGINS to speedup launch time
          if (test.from.indexOf('extras') !== -1) {
            delete process.env.RABIN2_NOPLUGINS;
            delete process.env.RASM2_NOPLUGINS;
            delete process.env.R2_NOPLUGINS;
          } else {
            process.env.RABIN2_NOPLUGINS = 1;
            process.env.RASM2_NOPLUGINS = 1;
            process.env.R2_NOPLUGINS = 1;
          }

          let childEnv;
          if (test.customEnv !== undefined) {
            childEnv = Object.assign({}, process.env, test.customEnv);
          } else {
            childEnv = process.env;
          }

          const child = spawn(r2bin, args, {shell: !!test.oneStream, env: childEnv});
          test.birth = new Date();
          child.stdout.on('data', data => {
            res += data.toString();
          });
          child.stderr.on('data', data => {
            ree += data.toString();
          });
          child.on('close', data => {
            test.death = new Date();
            try {
              if (test.tmpScript) {
                // TODO use yield
                fs.unlinkSync(test.tmpScript);
                test.tmpScript = null;
              }
            } catch (e) {
              console.error(e);
              // ignore
            }
            test.lifetime = test.death - test.birth;
            test.stdout = res;
            test.stderr = ree;
            resolve(cb(test));
          });
        } catch (e) {
          console.error(e);
          reject(e);
        }
      });
    });
  }

  runTests (source, lines) {
    let test = {from: source};
    const editMode = {
      match: false,
      name: '',
      enabled: false,
      str: ''
    };
    // edit is work in progress. aka not working at all
    if (this.argv.e) {
      editMode.match = true;
      editMode.name = 'cmd_graph';
      process.exit(1);
    }
    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];
      const line = l.trim();

      if (line.length === 0 || line[0] === '#') {
        continue;
      }

      if (editMode.enabled) {
        if (editMode.match) {
          console.log(line);
        }
        if (line === 'RUN') {
          editMode.match = false;
        }
        continue;
      }

      // Execute json tests
      if (source.indexOf('json' + path.sep) !== -1) {
        let tests = parseTestJson(source, line);
        for (let t of tests) {
          this.promises.push(this.runTestJson.bind(this)(t, this.checkTestResult.bind(this)));
        }
        continue;
      }

      // Execute asm tests
      if (source.indexOf('asm') !== -1 && source.indexOf('rasm2') === -1) {
        let tests = parseTestAsm(source, line);
        for (let t of tests) {
          this.promises.push(this.runTestAsm.bind(this)(t, this.checkTestResult.bind(this)));
        }
        continue;
      }

      // Execute normal test
      if (line === 'RUN') {
        const testCallback = this.callbackFromPath(test.from);
        if (testCallback !== null) {
          this.promises.push(testCallback.bind(this)(test, this.checkTestResult.bind(this)));
          test = {from: source};
          continue;
        }
      }

      const eq = l.indexOf('=');

      if (eq === -1) {
        const msg = l === 'EOF' ? 'Unexpected "EOF"' : 'Unknown keyword "' + l + '"';
        this.throwError(msg, i, source);
      }

      const k = l.substring(0, eq);
      const v = l.substring(eq + 1);
      const vt = v.trim();
      switch (k) {
        case 'NAME':
          if (vt.length > 1 && vt.startsWith("'") && vt.endsWith("'")) {
            this.throwError('Don\'t quote test name', i, source);
          }
          test.name = v;
          if (editMode.enabled && editMode.name === v) {
            editMode.match = true;
          }
          break;
        case 'PATH':
          test.path = v;
          break;
        case 'ARGS':
          test.args = v || [];
          break;
        case 'CMDS':
          if (vt.startsWith('<<')) {
            const endString = vt.substring(2);
            if (endString !== 'EOF') {
              this.throwError('End token must be "EOF", got "' + endString + '" instead', i, source);
            }
            let start_i = i;
            test.cmdScript = '';
            i++;
            while (lines[i] !== undefined && !lines[i].startsWith(endString)) {
              test.cmdScript += lines[i] + '\n';
              i++;
            }
            if (lines[i] === undefined) {
              throw new Error('Unexpected end-of-file in CMDS -- did you forget a ' + endString +
                              ' for line ' + (start_i + 1) + ' at ' + source + '?');
            }
            if (endString !== 'EOF') {
              i--;
            }
          } else {
            test.cmdScript = v ? v + '\n' : v;
          }
          test.cmds = test.cmdScript ? test.cmdScript.trim().split('\n') : [];
          break;
        case 'ARCH':
          test.arch = v;
          break;
        case 'BITS':
          test.bits = v;
          break;
        case 'BROKEN':
          test.broken = true;
          break;
        case 'EXPECT':
          test.expect64 = false;
          if (vt.startsWith('<<')) {
            const endString = vt.substring(2);
            if (endString !== 'EOF') {
              this.throwError('End token must be "EOF", got "' + endString + '" instead', i, source);
            }
            let start_i = i;
            test.expectEndString = endString;
            test.expect = '';
            i++;
            while (lines[i] !== undefined && !lines[i].startsWith(endString)) {
              test.expect += lines[i] + '\n';
              i++;
            }
            if (lines[i] === undefined) {
              throw new Error('Unexpected end-of-file in EXPECT -- did you forget a ' + endString +
                              ' for line ' + (start_i + 1) + ' at ' + source + '?');
            }
            if (endString !== 'EOF') {
              i--;
            }
          } else {
            test.expect = v + '\n';
          }
          break;
        case 'EXPECT_ERR':
          if (vt.startsWith('<<')) {
            const endString = vt.substring(2);
            if (endString !== 'EOF') {
              this.throwError('End token must be "EOF", got "' + endString + '" instead', i, source);
            }
            let start_i = i;
            test.expectErrEndString = endString;
            test.expectErr = '';
            i++;
            while (lines[i] !== undefined && !lines[i].startsWith(endString)) {
              test.expectErr += lines[i] + '\n';
              i++;
            }
            if (lines[i] === undefined) {
              throw new Error('Unexpected end-of-file in EXPECT_ERR -- did you forget a ' + endString +
                              ' for line ' + (start_i + 1) + ' at ' + source + '?');
            }
            if (endString !== 'EOF') {
              i--;
            }
          } else {
            test.expectErr = v + (v.length === 0 ? '' : '\n');
          }
          break;
        case 'FILE':
          if (vt.startsWith('<<')) {
            const endString = vt.substring(2);
            if (endString !== 'EOF') {
              this.throwError('End token must be "EOF", got "' + endString + '" instead', i, source);
            }
            let start_i = i;
            test.file = [];
            i++;
            while (lines[i] !== undefined && !lines[i].startsWith(endString)) {
              test.file.push(lines[i]);
              i++;
            }
            if (lines[i] === undefined) {
              throw new Error('Unexpected end-of-file in FILE -- did you forget a ' + endString +
                              ' for line ' + (start_i + 1) + ' at ' + source + '?');
            }
            if (endString !== 'EOF') {
              i--;
            }
          } else {
            test.file = [v === '' ? '-' : v];
          }
          break;
        case 'ONE_STREAM':
          test.oneStream = true;
          break;
        default:
          if (!k.startsWith('$')) {
            this.throwError('Unknown keyword "' + k + '"', i, source);
          }
          const env_k = k.substring(1);
          if (test.customEnv === undefined) {
            test.customEnv = {};
          }
          if (process.env[env_k] === undefined) {
            test.customEnv[env_k] = v;
          }
          break;
      }
    }
    function complete (x) {
      //
    }
    if (Object.keys(test) !== 0) {
      if (test.file && test.cmds) {
        this.promises.push(this.runTest(test, complete));
      }
    }
  }

  runFuzz (dir, files) {
    let test = {};
    for (let f of files) {
      test = {from: dir, name: 'fuzz', path: path.join(dir, f)};
      this.promises.push(this.runTestFuzz.bind(this)(test, this.checkTestResult.bind(this)));
    }
  }

  load (fileName, cb) {
    this.name = fileName;
    const rootPath = path.join(process.cwd());
    const pathName = path.join(rootPath, fileName);
    const blob = fs.readFileSync(pathName);
    // do we really need to support gzipped tests?
    zlib.gunzip(blob, (err, data) => {
      let tests;
      if (err) {
        tests = blob.toString();
      } else {
        tests = data.toString();
      }
      if (process.platform === 'win32') {
        tests = tests.replace(/\/dev\/null/g, 'nul').replace(/\r\n/g, '\n').split('\n');
        for (let i = 0; i < tests.length; i++) {
          if (!tests[i].slice(0, 1).localeCompare('!') ||
              !tests[i].slice(0, 2).localeCompare('"!') ||
              !tests[i].slice(0, 6).localeCompare('CMDS=!') ||
              !tests[i].slice(0, 7).localeCompare('CMDS="!')) {
            tests[i] = tests[i].replace(/\${(\S+?)}/g, '%$1%')
              .replace(/(\\\$)/g, "\$");
          }
        }
      } else {
        tests = tests.split('\n');
      }
      if (this.argv.grep !== undefined) {
        return cb(null, {});
      }
      if (this.argv['to-eof']) {
        let newTests = [];
        let writeTests = false;
        let run_re = /^(CMDS|EXPECT|EXPECT_ERR)=\s*<<(\w+)$/;
        process.stdout.write('Checking for <<KEYWORD and \'..\' in ' + fileName + '...');
        for (let i = 0; i < tests.length; i++) {
          let run_found = tests[i].trim().match(run_re);
          if (run_found && run_found[2] !== 'EOF') {
            writeTests = true;
            let from_kw = run_found[1];
            let to_kw = run_found[2];
            newTests.push(from_kw + '=<<EOF');
            i++;
            while (!tests[i].trimStart().startsWith(to_kw)) {
              newTests.push(tests[i]);
              i++;
            }
            newTests.push('EOF');
            i--;
          } else {
            let single_quote_re = /^(CMDS|EXPECT|EXPECT_ERR)=\s*(')([^']*)(')?.*$/;
            let double_quote_re = /^(EXPECT|EXPECT_ERR)=\s*(")([^"]*)(")?.*$/;
            let percent_quote_re = /^(EXPECT|EXPECT_ERR)=\s*(%)([^%]*)(%)?.*$/;
            let single_end_quote_re = /^([^']*)'.*$/;
            let double_end_quote_re = /^([^"]*)".*$/;
            let percent_end_quote_re = /^([^%]*)%.*$/;
            let line_trimmed = tests[i].trimStart();
            let single_quote_found = line_trimmed.match(single_quote_re);
            let double_quote_found = line_trimmed.match(double_quote_re);
            let percent_quote_found = line_trimmed.match(percent_quote_re);
            if (single_quote_found || double_quote_found || percent_quote_found) {
              writeTests = true;
              let quote_found =
                  single_quote_found ? single_quote_found :
                  (double_quote_found ? double_quote_found : percent_quote_found);
              let kw = quote_found[1];
              let begin_quote = quote_found[2];
              let body = quote_found[3];
              let end_quote_single = quote_found[4];
              newTests.push(kw + '=<<EOF');
              if (end_quote_single === begin_quote) {
                if (body !== '') {
                  newTests.push(body);
                }
              } else {
                newTests.push(body);
                i++;
                let end_quote_re =
                    single_quote_found ? single_end_quote_re :
                    (double_quote_found ? double_end_quote_re : percent_end_quote_re);
                let end_quote_found = tests[i].match(end_quote_re);
                while (!end_quote_found) {
                  newTests.push(tests[i]);
                  i++;
                  end_quote_found = tests[i].match(end_quote_re);
                }
                let end_body = end_quote_found[1];
                if (end_body !== '') {
                  newTests.push(end_body);
                }
              }
              newTests.push('EOF');
            } else {
              newTests.push(tests[i]);
            }
          }
        }
        if (writeTests) {
          fs.writeFileSync(pathName, newTests.join('\n'));
          console.log('EOF\'D');
        } else {
          console.log('OK');
        }
        return cb(null, {});  // TODO: allow fallthrough?
      }
      if (this.argv.debase64) {
        let newTests = [];
        let writeTests = false;
        process.stdout.write('Checking for base64 in ' + fileName + '...');
        for (let i = 0; i < tests.length; i++) {
          let line = tests[i].trim();
          if (line.startsWith('CMDS64=')) {
            writeTests = true;
            line = debase64(line.substring(7)).trimStart().replace(/\n+$/, '');
            newTests.push('CMDS=<<EOF');
            newTests.push(line);
            newTests.push('EOF');
          } else if (line.startsWith('EXPECT64=')) {
            writeTests = true;
            line = debase64(line.substring(9)).replace(/\n+$/, '');
            if (line.startsWith('[') && line.endsWith(']') ||
                line.startsWith('{') && line.endsWith('}')) { // JSON
              newTests.push('EXPECT=<<EOF\n' + line + '\nEOF\n');
            } else {
              newTests.push('EXPECT=<<EOF');
              if (line !== '') {
                newTests.push(line);
              }
              newTests.push('EOF');
            }
          } else if (line.startsWith('CMDS=<<EXPECT64')) {
            writeTests = true;
            newTests.push('CMDS=<<EXPECT');
          } else {
            newTests.push(tests[i]);
          }
        }
        if (writeTests) {
          fs.writeFileSync(pathName, newTests.join('\n'));
          console.log('DEBASE64ED');
        } else {
          console.log('OK');
        }
        if (this.argv.format) {
          tests = newTests;
          // fallthrough
        } else {
          return cb(null, {});
        }
      }
      if (this.argv.format) {
        let newTests = [];
        let writeTests = false;
        let prevLineRUN = false;
        process.stdout.write('Checking format of ' + fileName + '...');
        for (let i = 0; i < tests.length; i++) {
          if (prevLineRUN) {
            prevLineRUN = false;
            if (tests[i].trim() !== '') {
              writeTests = true;
              newTests.push('');
            }
          }
          newTests.push(tests[i]);
          if (tests[i].trim() === 'RUN') {
            prevLineRUN = true;
          }
        }
        if (writeTests) {
          fs.writeFileSync(pathName, newTests.join('\n'));
          console.log('FIXED');
        } else {
          console.log('OK');
        }
        return cb(null, {});
      }
      this.runTests(fileName, tests);
      Promise.all(this.promises).then(res => {
        this.printReport();
        cb(null, res);
      }).catch(err => {
        console.log(err);
        cb(err);
      });
    });
  }

  loadFuzz (dir, cb) {
    console.log('[--]', 'fuzz binaries');
    let fuzzed;
    try {
      fuzzed = fs.readdirSync(dir);
    } catch (e) {
      return cb(e);
    }
    this.runFuzz(dir, fuzzed);
    Promise.all(this.promises).then(res => {
      this.printReport();
      cb(null, res);
    }).catch(err => {
      console.log(err);
      cb(err);
    });
  }

  checkTest (test, cb) {
    if (process.platform === 'win32') {
      /* Delete \r on windows.
       * Note that process.platform is always win32 even on Windows 64 bits */
      if (typeof test.stdout !== 'undefined') { // && test.expect) {
        test.stdout = test.stdout.replace(/\r/g, '');
      }
      if (typeof test.stderr !== 'undefined') {
        test.stderr = test.stderr.replace(/\r/g, '');
      }
    }

    /* Check test output, if it's the same, the test passes */
    if (test.check === undefined) {
      if (test.expect !== undefined) {
        test.expect = removeEndNewline(test.expect);
        test.stdout = removeEndNewline(test.stdout);
        test.stdoutFail = (test.expect64 || test.expect64 === undefined)
          ? test.expect.trim() !== test.stdout.trim()
          : test.expect !== test.stdout;
      } else {
        test.stdoutFail = false;
      }
      if (test.expectErr !== undefined) {
        test.expectErr = removeEndNewline(test.expectErr);
        test.stderr = removeEndNewline(test.stderr);
        test.stderrFail = test.expectErr !== test.stderr;
      } else {
        test.stderrFail = false;
      }
      test.passes = !test.stdoutFail && !test.stderrFail;
    } else {
      test.check(test);
    }

    const status = (test.passes)
      ? (test.broken ? colors.yellow('[FX]') : colors.green('[OK]'))
      : (test.broken ? colors.blue('[BR]') : colors.red('[XX]'));
    this.report.total++;
    if (test.passes) {
      if (test.broken) {
        this.report.fixed++;
        this.fixed.push(test);
      } else {
        this.report.success++;
      }
    } else {
      if (test.broken) {
        this.report.broken++;
      } else {
        this.report.failed++;
      }
    }

    /* Hack to hide undefined */
    if (test.path === undefined) {
      test.path = '';
    }
    if (test.lifetime === undefined) {
      test.lifetime = '';
    }
    if ((process.env.NOOK && status !== colors.green('[OK]')) || !process.env.NOOK) {
      process.stdout.write('\x1b[0K\r' + status + ' ' + test.from + ' ' + colors.yellow(test.name) + ' ' + test.path + ' ' + test.lifetime + (this.verbose ? '\n' : '\r'));
    }
    return test.passes;
  }

  checkTestResult (test, cb) {
    const testHasFailed = !this.checkTest(test);

    if (this.interactive) {
      this.verbose = true;
    }
    if (!this.verbose && (test.broken || test.fixed)) {
      return;
    }
    /* Do not show diff if TRAVIS or APPVEYOR and if test is broken */
    if ((process.env.TRAVIS || process.env.APPVEYOR) && test.broken) {
      return;
    }
    if (testHasFailed) {
      console.log('\n$ r2', test.spawnArgs ? test.spawnArgs.join(' ') : '');
      if (test.cmdScript !== undefined) {
        console.log(test.cmdScript);
      }

      let showHeaders = test.stderrFail;
      if (test.stdoutFail) {
        if (showHeaders) {
          console.log('--> stdout\n');
        }
        common.showDiff(test.expect, test.stdout);
      }
      if (test.stdoutFail && test.stderrFail) {
        console.log();
      }
      if (test.stderrFail && test.fuzz === undefined) {
        if (showHeaders) {
          console.log('--> stderr\n');
        }
        // DEBUG console.log("((((", test.expectErr, ")))(((", test.stderr, ")))");
        common.showDiff(test.expectErr, test.stderr);
      }
      /*
      console.log('===');
      if (test.expect !== null) {
        ///console.log('---');
        console.log(colors.magenta(test.expect.trim()));
      }
      if (test.stdout !== null) {
        // console.log('+++');
        console.log(colors.green(test.stdout.trim()));
      }
*/
      // console.log('===');
      if (test.stdoutFail) {
        if (test.expect64) {
          console.log('EXPECT64=' + base64(test.stdout));
        } else if (test.expect64 !== undefined) {
          common.highlightTrailingWs(null, '\nEXPECT=<<EOF\n' + test.stdout +
                                     (test.stdout === '' || test.stdout.endsWith('\n') ? '' : '\n') + 'EOF\n');
        }
      }
      if (test.fuzz === undefined) {
        if (!test.stdoutFail && test.stderrFail) {
          console.log();
        }
        if (test.stderrFail) {
          if (test.stderr === '' || (test.stderr.match(/\n/g) || []).length > 1) {
            common.highlightTrailingWs(null, '\nEXPECT_ERR=<<EOF\n' + test.stderr +
                                       (test.stderr === '' || test.stderr.endsWith('\n') ? '' : '\n') + 'EOF\n');
          } else {
            common.highlightTrailingWs(null, 'EXPECT_ERR=' + test.stderr);
          }
        }
      }
      if (this.interactive) {
        //        console.log('TODO: interactive thing should happen here');
      }
      this.queue.push(test);
    }
  }

  printReport () {
    this.report.totaltime = new Date() - this.start;
    const r = {
      name: this.name,
      OK: this.report.success,
      BR: this.report.broken,
      XX: this.report.failed,
      FX: this.report.fixed,
      time: this.report.totaltime
    };
    function n (x) {
      return x.toString().padStart(4);
    }
    const name = (typeof this.name === 'string') ? this.name.padStart(30) : '';

    if ((process.env.NOOK && (r.XX || r.FX)) || !process.env.NOOK) {
      console.log('[**]', name + '  ', 'OK', n(r.OK), 'BR', n(r.BR), 'XX', n(r.XX), 'FX', n(r.FX));
    }
  }

  throwError (msg, i, src) {
    throw new Error(msg + ' at line ' + (i + 1) + ' of ' + src);
  }

  fixTest (name, expect, cb) {
  }

  editTest (name, expect, cb) {
  }
}

function createTemporaryFile () {
  return new Promise((resolve, reject) => {
    try {
      tmp.file(function (err, filePath, fd, cleanupCallback) {
        if (err) {
          return reject(err);
        }
        resolve(filePath);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function parseTestJson (source, line) {
  const bins = ['../bins/elf/crackme0x00b', '../bins/pe/version_std.exe', '../bins/elf/bomb', '../bins/mach0/hello-objc'];
  let t = {from: source, broken: false};

  if (line.endsWith(' BROKEN')) {
    t.cmd = line.substring(0, line.length - ' BROKEN'.length).trim();
    t.broken = true;
  } else {
    t.cmd = line;
    t.broken = false;
  }
  t.name = t.cmd;
  t.check = function (test) {
    try {
      if (test.stdout === '') {
        test.passes = true;
      } else {
        JSON.parse(test.stdout);
        test.passes = true;
      }
    } catch (err) {
      test.passes = false;
      if (t.broken) {
        console.error(colors.blue('[BR] ') + t.cmd);
        console.error(test.stdout);
        console.error(err);
      } else {
        console.error(colors.red.bold('[XX] ') + t.cmd);
        console.error(test.stdout);
        console.error(err);
      }
    }
  };

  let tests = [];

  for (b of bins) {
    let newtest = Object.assign({'path': b}, t);
    tests.push(newtest);
  }

  return tests;
}

function parseTestAsm (source, line) {
  /* Parse first argument */
  let r2args = [];
  let args = line.match(/(".*?"|[^"\s]+)+(?=\s*|\s*$)/g);
  if (args.length < 3) {
    console.error(colors.red.bold('[XX]', 'Wrong asm test format in ' + source + ':' + line));
    return [];
  }
  let filetree = source.split(path.sep);
  const filename = filetree[filetree.length - 1].split('_');
  if (filename.length > 3) {
    console.error(colors.red.bold('[XX]', 'Wrong asm filename: ' + source));
    return [];
  } else if (filename.length === 2) {
    r2args.push('e asm.cpu=');
    r2args.push('e asm.bits=' + filename[1]);
  } else if (filename.length === 3) {
    r2args.push('e asm.cpu=' + filename[1]);
    r2args.push('e asm.bits=' + filename[2]);
  }
  r2args.unshift('e asm.arch=' + filename[0]);

  let type = args[0];
  let asm = args[1].split('"').join('');
  let expect = args[2];

  if (args.length >= 4) {
    r2args.push('s ' + args[3]);
  } else {
    r2args.push('s 0');
  }

  /* Generate tests */
  let tests = [];
  for (let c of type) {
    let t = {from: source, broken: false, args: r2args.join(';')};
    t.endianess = false;
    if (type.indexOf('E') !== -1) {
      t.endianess = true;
    }
    switch (c) {
      case 'd':
        t.cmd = 'e cfg.bigendian=' + t.endianess + ';' + 'pad ' + expect;
        t.expect = asm;
        t.name = filename + ': ' + expect + ' => "' + asm + '"' + colors.blue(' (disassemble)');
        tests.push(t);
        break;
      case 'a':
        t.cmd = 'e cfg.bigendian=' + t.endianess + ';' + '"pa ' + asm + '"';
        t.expect = expect;
        t.name = filename + ': "' + asm + '" => ' + expect + colors.blue(' (assemble)');
        tests.push(t);
        break;
      default:
        continue;
    }
    if (type.indexOf('B') !== -1) {
      t.broken = true;
    }
  }
  return tests;
}

function removeEndNewline (str) {
  return str.endsWith('\n') ? str.slice(0, -1) : str;
}

function debase64 (msg) {
  return Buffer.from(msg, 'base64').toString('utf8');
}

function base64 (msg) {
  return Buffer.from(msg).toString('base64');
}

module.exports = NewRegressions;
