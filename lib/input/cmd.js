const util = require('../util');

module.exports = function parseCmd(test, lines) {
  var tests = [];
  const delims = /['"%]/;
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    const line = l.trim();
    if (line.length === 0 || line[0] === '#') {
      continue;
    }
    if (line === 'RUN') {
      tests.push(test);
      test = util.newTest(test.source);
      continue;
    }
    const eq = l.indexOf('=');
    if (eq === -1) {
      throw new Error('Invalid database: ' + l);
    }
    const k = l.substring(0, eq);
    const v = l.substring(eq + 1);
    const vt = v.trim();
    switch (k) {
      case 'NAME':
        test.name = v;
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
          test.cmdScript = '';
          i++;
          while (!lines[i].startsWith(endString)) {
            test.cmdScript += lines[i] + '\n';
            i++;
          }
          i--;
        } else {
          const delim = vt.charAt(0);
          if (delims.test(delim)) {
            const startDelim = v.indexOf(delim);
            let endDelim = v.indexOf(delim, startDelim + 1);
            if (endDelim == -1) {
              test.cmdScript = v.substring(startDelim + 1) + "\n";
              i++;
              while ((endDelim = lines[i].indexOf(delim)) == -1) {
                test.cmdScript += lines[i] + '\n';
                i++;
              }
              test.cmdScript += lines[i].substring(0, endDelim);
            } else {
              test.cmdScript = v.substring(startDelim + 1, endDelim) + "\n";
            }
          } else {
            test.cmdScript = v ? v + "\n" : v;
          }
        }
        test.cmds = test.cmdScript ? test.cmdScript.trim().split('\n') : [];
        break;
      case 'CMDS64':
        test.cmdScript = debase64(v);
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
          test.expectEndString = endString;
          test.expect = '';
          i++;
          while (lines[i] !== undefined && !lines[i].startsWith(endString)) {
            test.expect += lines[i] + '\n';
            i++;
          }
          if (lines[i] === undefined) {
            throw new Error('Unexpected EOF in EXPECT -- did you forget a ' + endString + '?');
          }
           i--;
        } else {
          const delim = vt.charAt(0);
          if (delims.test(delim)) {
            test.expectDelim = delim;
            const startDelim = v.indexOf(delim);
            let endDelim = v.indexOf(delim, startDelim + 1);
            if (endDelim == -1) {
              test.expect = v.substring(startDelim + 1) + "\n";
              i++;
              while ((endDelim = lines[i].indexOf(delim)) == -1) {
                test.expect += lines[i] + '\n';
                i++;
              }
              test.expect += lines[i].substring(0, endDelim);
            } else {
              test.expect = v.substring(startDelim + 1, endDelim);  // No newline added
            }
          } else {
            test.expect = v + "\n";
          }
        }
        break;
      case 'EXPECT64':
        test.expect = debase64(v);
        test.expect64 = true;
        break;
      case 'EXPECT_ERR':
        if (vt.startsWith('<<')) {
          const endString = vt.substring(2);
          test.expectErrEndString = endString;
          test.expectErr = '';
          i++;
          while (lines[i] !== undefined && !lines[i].startsWith(endString)) {
            test.expectErr += lines[i] + '\n';
            i++;
          }
          if (lines[i] === undefined) {
            throw new Error('Unexpected EOF in EXPECT_ERR -- did you forget a ' + endString + '?');
          }
          i--;
        } else {
          const delim = vt.charAt(0);
          if (delims.test(delim)) {
            test.expectErrDelim = delim;
            const startDelim = v.indexOf(delim);
            let endDelim = v.indexOf(delim, startDelim + 1);
            if (endDelim == -1) {
              test.expectErr = v.substring(startDelim + 1) + "\n";
              i++;
              while ((endDelim = lines[i].indexOf(delim)) == -1) {
                test.expectErr += lines[i] + '\n';
                i++;
              }
              test.expectErr += lines[i].substring(0, endDelim);
            } else {
              test.expectErr = v.substring(startDelim + 1, endDelim);  // No newline added
            }
          } else {
            test.expectErr = v + "\n";
          }
        }
        break;
      case 'EXPECT_ERR64':
        test.expect = debase64(v);
        break;
      case 'FILE':
        test.file = v;
        break;
      default:
        throw new Error('Invalid database, key =('+ k+ ')');
    }
  }
  if (Object.keys(test) !== 0) {
    if (test.file && test.cmds) {
      this.promises.push(this.runTest(test));
    }
  }
  return tests;
}

// move to util?
function debase64 (msg) {
  return Buffer.from(msg, 'base64').toString('utf8');
}

function base64 (msg) {
  return Buffer.from(msg).toString('base64');
}
