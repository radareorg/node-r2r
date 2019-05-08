const colors = require('colors/safe');
const jsdiff = require('diff');

module.exports = {
  identity (arg) {
    return arg;
  },
  highlightTrailingWs (colorFunc, text) {
    if (colorFunc == null) {
      colorFunc = this.identity;
    }
    const wsTrailing = /[ \t]+$/gm;
    var curIndex = 0;
    var match;
    while ((match = wsTrailing.exec(text)) !== null) {
      process.stdout.write(colorFunc(text.substring(curIndex, wsTrailing.lastIndex - match[0].length))
                           + colors.bgRed(match[0]));
      curIndex = wsTrailing.lastIndex;
    }
    process.stdout.write(colorFunc(text.substring(curIndex)));
  },
  showDiff (expected, actual) {
    const common = this;
    const changes = jsdiff.diffLines(expected, actual);
    changes.forEach(function (part) {
      const k = part.added ? colors.green : colors.magenta;
      const v = part.value.replace(/[\r\n]*$/, '');
      if (part.added) {
        common.highlightTrailingWs(k, '+' + v.split(/\n/g).join('\n+') + '\n');
      } else if (part.removed) {
        common.highlightTrailingWs(k, '-' + v.split(/\n/g).join('\n-') + '\n');
      } else {
        console.log(' ' + v.split(/\n/g).join('\n '));
      }
    });
  },
  showDiffChars (expected, actual) {
    const changes = jsdiff.diffChars(expected, actual);
    changes.forEach(function (part) {
      const k = part.added ? colors.black.bgGreen
            : colors.white.bold.bgMagenta.strikethrough;
      const v = part.value;
      if (part.added || part.removed) {
        process.stdout.write(k(v));
      } else {
        process.stdout.write(colors.grey(v));
      }
    });
  },
  getSuitableDelim (str) {
    const delims = '\'"%';
    let delim = null;
    for(let i = 0; i < delims.length; i++) {
      if (!str.includes(delims.charAt(i))) {
        delim = delims.charAt(i);
        break;
      }
    }
    if (delim === null) {
      throw new Error("No suitable delim char found from [" + delims + "]");
    }
    return delim;
  }
};
