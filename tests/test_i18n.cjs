const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '..')
const file = path.join(repo, 'desktop', 'plugin.js')
let source = fs.readFileSync(file, 'utf8')
source = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
source = source.replace('export default {', 'const __plugin = {')
const tested = new Function(
  'atom',
  `${source}\nreturn { EN, RU, LOCALES, windowLabel, detailLabel, reasonLabel, resetLabel, profileLabel };`
)(value => ({ get: () => value, set: () => {} }))
const { EN, LOCALES, windowLabel, detailLabel, reasonLabel, resetLabel, profileLabel } = tested

function resolve(bundle, key) {
  return key.split('.').reduce((current, part) => current && current[part], bundle)
}
function translator(bundle) {
  return (key, ...args) => {
    let value = resolve(bundle, key)
    if (value === undefined || value === null) value = resolve(EN, key)
    if (value === undefined || value === null) throw new Error(`Missing locale key: ${key}`)
    return typeof value === 'function' ? value(...args) : value
  }
}
function keys(bundle, prefix = '') {
  return Object.entries(bundle).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object' ? keys(value, full) : [full]
  })
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const expected = ['ar', 'de', 'en', 'es', 'fr', 'ja', 'ru', 'zh', 'zh-hant']
const actual = Object.keys(LOCALES).sort()
assert(JSON.stringify(actual) === JSON.stringify(expected), `Locale set differs: ${actual}`)
const enKeys = keys(EN).sort()
const used = [...source.matchAll(/\bt\('([^']+)'/g)].map(match => match[1])
const identical = []
for (const locale of expected) {
  const bundle = LOCALES[locale]
  const localeKeys = keys(bundle).sort()
  assert(JSON.stringify(localeKeys) === JSON.stringify(enKeys), `${locale}: locale key set differs`)
  for (const key of new Set(used)) {
    assert(resolve(bundle, key) !== undefined, `${locale}: missing used key ${key}`)
  }
  if (locale === 'en') continue
  for (const key of enKeys) {
    if (resolve(bundle, key) === resolve(EN, key)) identical.push(`${locale}:${key}`)
  }
  const t = translator(bundle)
  const samples = [
    t('app.title'),
    t('actions.refresh'),
    t('windows.currentSession'),
    t('details.balance', 'USD', '3.63'),
    t('reasons.noPublicApi'),
    t('page.meta', '08.11.2026, 03:00', 1.25),
    t('reset.relative', 2, 3, 4),
    profileLabel({ name: 'default', is_default: true, gateway_running: true }, t)
  ]
  for (const sample of samples) {
    assert(typeof sample === 'string' && sample.length > 0, `${locale}: empty formatted sample`)
    assert(!/undefined|null|\[object Object\]/.test(sample), `${locale}: broken interpolation: ${sample}`)
  }
  console.log(`${locale}: ${localeKeys.length} keys; samples ok`)
}
const allowed = new Set([
  ...expected.filter(locale => locale !== 'en').map(locale => `${locale}:plans.pro`),
  'de:windows.chat', 'es:windows.chat', 'fr:windows.chat', 'de:windows.limit',
  'es:windows.minutes', 'fr:windows.minutes', 'fr:windows.session'
])
const untranslated = identical.filter(key => !allowed.has(key))
assert(untranslated.length === 0, `Untranslated English leaves: ${untranslated.join(', ')}`)

const ru = translator(LOCALES.ru)
assert(windowLabel('Monthly coding', ru) === 'Месяц, программирование', 'RU Kimi window failed')
assert(detailLabel('USD 3.63 balance', ru) === 'Баланс: 3.63 USD', 'RU DeepSeek balance failed')
assert(detailLabel('11802 of 12000 left', ru) === 'Осталось 11802 из 12000', 'RU remaining detail failed')
assert(reasonLabel('No public subscription-quota API for this provider.', ru).startsWith('У этого провайдера'), 'RU reason failed')
assert(profileLabel({ name: 'default', is_default: true, gateway_running: true }, ru) === 'основной · запущен', 'RU default profile failed')
assert(resetLabel('2026-11-08T01:00:00Z', translator(EN)).startsWith('resets '), 'EN reset fallback failed')
assert(source.includes("const ID = 'ai-usage-tracker'"), 'Canonical plugin id missing')
assert(!source.includes('ai-usage-tracker-live'), 'Temporary live id leaked into repository')
assert(source.includes('ctx.i18n.register(LOCALES)'), 'Locale registration missing')
assert(source.includes('usePluginI18n(ID)'), 'Reactive translator missing')
console.log(`PASS locales=${actual.length}; keys_per_locale=${enKeys.length}; used_literal_keys=${new Set(used).size}; untranslated=0; canonical_id=ok`)
