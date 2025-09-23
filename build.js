const fs = require('fs')
const path = require('path')

const src = 'src'
const dest = 'build'

const build = () => {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest)
  fs.readdirSync(src).forEach(file => {
    fs.copyFileSync(path.join(src, file), path.join(dest, file))
  })
  console.log('Build complete')
}

build()

if (process.argv[2] === '--watch') {
  fs.watch(src, () => build())
  console.log('Watching for changes')
}
