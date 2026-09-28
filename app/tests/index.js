// Точка входа для `node --test app/tests/`: Node 22+ принимает каталог как модуль
// и ищет в нём index.js. Подгружаем все *.test.mjs этого каталога.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

for (const name of fs.readdirSync(__dirname).filter((n) => /\.test\.mjs$/.test(n)).sort()) {
  import(pathToFileURL(path.join(__dirname, name)).href);
}
