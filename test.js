// var Readable = require('stream').Readable;
// var rs = Readable();
//
// var c = 97;
// rs._read = function () {
//     rs.push(String.fromCharCode(c++));
//     if (c > 'z'.charCodeAt(0)) rs.push(null);
// };
// process.stdin.pipe(printConsole);


// rs.on('readable', function () {
//     var buf = process.stdin.read();
//     buf = buf.toString();
//     console.log(buf);
// });

// var readline = require('readline');
// var rl = readline.createInterface({
//   input: process.stdin,
//   output: process.stdout,
//   terminal: true
// });
//
// rl.on('line', function(line){
//     console.log('line is: ',line);
// });




// var Writable = require('stream').Writable;
// var ws = Writable();
// ws._write = function (chunk, enc, next) {
//     console.dir(chunk);
//     next();
// };
//
// process.stdin.pipe(ws);





// var x = 'learn_Code/ex4.dSYM/Contents/Info.plist';
// x = x.split('/');
// y = x.splice(-1);
//
// console.log(x);
// console.log(y);




let x = new Date(1484587211894);
console.log(x);
