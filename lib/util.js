const path = require('path');

module.exports = {
  newTest: newTest,
  sortUniq: sortUniq
};

function newTest(fileName) {
  const test = {
    source: fileName,
    type: 'cmd'
  }
  if (fileName.indexOf('asm') !== -1 && fileName.indexOf('rasm2') === -1) {
    test.type = 'asm';
  }
  if (fileName.indexOf('bins/') !== -1) {
    test.type = 'bin';
    test.name = path.basename(fileName);
  }
  return test;
}

function sortUniq(arr) {
  return arr.sort().filter(function(elem, index, arr) {
    return index == arr.length - 1 || arr[index + 1] != elem
  })
}
