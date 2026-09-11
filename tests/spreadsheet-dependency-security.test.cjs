/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const uploader = fs.readFileSync('src/components/studio/ExcelUploader.tsx', 'utf8')

test('spreadsheet upload no longer ships the vulnerable xlsx package', () => {
  assert.equal(packageJson.dependencies.xlsx, undefined)
  assert.equal(packageJson.dependencies['read-excel-file'], '9.3.10')
  assert.equal(packageJson.dependencies['write-excel-file'], '4.1.1')
  assert.doesNotMatch(uploader, /from ["']xlsx["']/)
  assert.match(uploader, /read-excel-file\/browser/)
  assert.match(uploader, /write-excel-file\/browser/)
})

test('spreadsheet upload accepts only the supported xlsx format', () => {
  assert.match(uploader, /accept="\.xlsx,application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet"/)
  assert.match(uploader, /旧版 \.xls 请先另存为 \.xlsx/)
  assert.doesNotMatch(uploader, /application\/vnd\.ms-excel/)
})
