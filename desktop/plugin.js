/**
 * AI Usage Tracker — live subscription quota for every AI provider Hermes can
 * route to, per profile, in the Hermes desktop.
 *
 * Scope (deliberately narrow): subscription quota windows only — provider,
 * plan, window, % remaining, reset countdown. No token counting, no cost
 * estimates, no time-window filters.
 *
 * Backend: ~/.hermes/plugins/ai-usage-tracker/dashboard/plugin_api.py
 * Read-only. No secrets ever reach the UI.
 */
import {
  Badge,
  Button,
  Codicon,
  EmptyState,
  ErrorState,
  ROUTES_AREA,
  STATUSBAR_AREAS,
  SIDEBAR_NAV_AREA,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  atom,
  cn,
  haptic,
  host,
  useQuery,
  useValue,
  usePluginI18n
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'ai-usage-tracker'
const ROUTE = '/ai-usage'
const REFRESH_PAGE_MS = 120_000
const REFRESH_CHIP_MS = 300_000

function plural(number, one, few, many) {
  const n = Math.abs(Number(number)) % 100
  const last = n % 10
  if (n > 10 && n < 20) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

const EN = {
  app: { title: 'AI usage' },
  common: { left: 'left' },
  status: { live: 'live quota', none: 'no quota', unavailable: 'unavailable', recent: 'used recently', low: 'low', watch: 'watch' },
  actions: { refresh: 'Refresh', refreshing: 'Refreshing…', retry: 'Retry', unhideAll: 'Unhide all' },
  hidden: {
    button: count => `Hidden ${count}`,
    showing: count => `Showing hidden ${count}`,
    show: count => `Show ${count} hidden provider(s)`,
    hideAgain: 'Hide the hidden providers again',
    showProvider: 'Show this provider again',
    hideProvider: 'Hide this provider',
    unhide: label => `Unhide ${label}`,
    hide: label => `Hide ${label}`
  },
  picker: {
    profile: 'Hermes profile', profilePlaceholder: 'profile…', default: 'default', up: 'up',
    statusBar: 'Status Bar:', chip: 'Status bar chip provider',
    chipTitle: 'Which provider the status-bar chip shows', auto: 'Auto (Lowest %)'
  },
  reset: {
    now: 'resets now',
    relative: (days, hours, minutes) => days
      ? `in ${days}d ${hours}h`
      : hours ? `in ${hours}h ${minutes}m` : minutes ? `in ${minutes}m` : 'in <1m',
    at: (relative, time) => `resets ${relative} · ${time}`
  },
  windows: {
    currentSession: 'Current session', currentWeek: 'Current week', opusWeek: 'Opus week', sonnetWeek: 'Sonnet week',
    session: 'Session', session5h: 'Session (5h)', rolling5h: 'Rolling (5h)', weekly: 'Weekly',
    weeklyTotal: 'Weekly total', weeklyCoding: 'Weekly coding', monthly: 'Monthly',
    monthlyTotal: 'Monthly total', monthlyCoding: 'Monthly coding', premiumRequests: 'Premium requests',
    chat: 'Chat', completions: 'Completions', toolQuota: 'Tool quota', apiKeyQuota: 'API key quota',
    credits: 'Credits', limit: 'Limit', creditLimit: 'Credit Limit', fiveHours: '5h', weeklyLower: 'weekly', minutes: 'min'
  },
  details: {
    unlimited: 'unlimited',
    leftOf: (remaining, total) => `${remaining} of ${total} left`,
    status: value => `status: ${value}`,
    creditsBalance: value => `Credits balance: ${value}`,
    balance: (currency, amount) => `${currency} ${amount} balance`,
    creditsRemaining: value => `Credits remaining: ${value}`,
    apiUsageTotal: value => `API key usage: ${value} total`,
    today: value => `${value} today`, thisWeek: value => `${value} this week`, thisMonth: value => `${value} this month`,
    plan: value => `Plan: ${value}`,
    overage: value => `Overage requests used: ${value}`,
    extraUsage: value => `Extra usage: ${value}`,
    notIncluded: label => `${label}: not included in this plan`,
    resets: value => `resets ${value}`
  },
  plans: { free: 'Free', pro: 'Pro' },
  providers: { chatgpt: 'ChatGPT or Codex Subscription', custom: 'Custom endpoint' },
  reasons: {
    noPublicApi: 'No public subscription-quota API for this provider.',
    notInCatalog: 'Provider not in the Hermes catalog.',
    noCredentials: 'No credentials for this provider in this profile, or its quota probe failed.',
    noClaudeOAuth: 'No Claude Code OAuth credentials in this profile.',
    noApiKey: (provider, variable) => `No ${provider} API key (${variable}) in this profile.`,
    rejected: (provider, error) => `${provider} rejected the API key (${error}).`,
    probeFailed: (provider, error) => `${provider} quota probe failed: ${error}`,
    tierUnsupported: (provider, error) => `${provider} quota not available for this account (${error}).`,
    internalProbe: error => `Probe failed: ${error}`,
    kimiParse: 'Kimi returned no parseable usage windows.',
    zaiParse: 'Z.AI returned no parseable quota limits.',
    opencodeParse: 'OpenCode Go returned no usage windows.',
    minimaxParse: 'MiniMax returned no parseable coding-plan rows.',
    deepseekParse: 'DeepSeek returned no balance rows.',
    copilotParse: 'Copilot returned no quota windows for this account.',
    anthropicOauthOnly: 'Anthropic account limits are only available for OAuth-backed Claude accounts.',
    nousUnavailable: 'Not signed in to Nous Portal, or the portal returned no subscription data.',
    zenUnavailable: 'OpenCode Zen exposes no reachable credits/usage endpoint for this key — it is pay-as-you-go.'
  },
  errors: {
    loadTitle: 'Could not load usage',
    loadDescription: message => `${message} — a "Plugin not found" here means the backend is not enabled for this profile. Enable the plugin for this profile and retry.`,
    stale: message => `Showing the last good response — the refresh failed: ${message}`,
    oldBackend: 'This backend is running an older copy of the plugin (no per-profile data), so the profile picker is hidden — quit and relaunch the Hermes desktop app to load the current backend.',
    pluginNotFound: 'Plugin not found',
    failedToFetch: 'Failed to fetch'
  },
  page: {
    meta: (time, seconds) => `fetched ${time} · probed in ${seconds}s`,
    summaryMulti: (count, live, profile) => `${count} provider(s) in ${profile} · ${live} reporting live quota · switch profile above to inspect another`,
    summarySingle: (count, live) => `${count} provider(s) · ${live} reporting live quota`,
    thisProfile: 'this profile',
    emptyAll: 'Every provider is hidden',
    emptyNone: 'No providers to show',
    emptyRestore: count => `Use "Hidden ${count}" above to bring them back.`,
    emptyNoCredentials: 'This profile has no provider credentials and no recent usage.',
    footer: '✕ on a card hides that provider (persisted, and excluded from the status-bar chip) · quota comes from each provider\'s own API using this profile\'s credentials.'
  },
  chip: {
    pinned: ' (pinned on the AI usage page)',
    aria: detail => `AI usage: ${detail}`,
    loading: 'AI usage…'
  }
}

const RU = {
  ...EN,
  app: { title: 'Лимиты ИИ' },
  common: { left: 'осталось' },
  status: { live: 'лимиты онлайн', none: 'нет лимитов', unavailable: 'недоступно', recent: 'недавно использовался', low: 'мало', watch: 'контроль' },
  actions: { refresh: 'Обновить', refreshing: 'Обновление…', retry: 'Повторить', unhideAll: 'Показать все' },
  hidden: {
    button: count => `Скрыто: ${count}`,
    showing: count => `Скрытые показаны: ${count}`,
    show: count => `Показать скрытых провайдеров: ${count}`,
    hideAgain: 'Снова скрыть провайдеров',
    showProvider: 'Показать провайдера снова',
    hideProvider: 'Скрыть провайдера',
    unhide: label => `Показать ${label}`,
    hide: label => `Скрыть ${label}`
  },
  picker: {
    profile: 'Профиль Hermes', profilePlaceholder: 'профиль…', default: 'основной', up: 'запущен',
    statusBar: 'В статус-баре:', chip: 'Провайдер в статус-баре',
    chipTitle: 'Какой провайдер показывать в статус-баре', auto: 'Авто (минимум %)'
  },
  reset: {
    now: 'сброс сейчас',
    relative: (days, hours, minutes) => days
      ? `через ${days} ${plural(days, 'день', 'дня', 'дней')}${hours ? ` ${hours} ч` : ''}`
      : hours ? `через ${hours} ч ${minutes} мин` : minutes ? `через ${minutes} мин` : 'менее чем через минуту',
    at: (relative, time) => `сброс ${relative} · ${time}`
  },
  windows: {
    currentSession: 'Текущая сессия', currentWeek: 'Текущая неделя', opusWeek: 'Неделя Opus', sonnetWeek: 'Неделя Sonnet',
    session: 'Сессия', session5h: 'Сессия (5 ч)', rolling5h: 'Скользящее окно (5 ч)', weekly: 'Неделя',
    weeklyTotal: 'Неделя, всего', weeklyCoding: 'Неделя, программирование', monthly: 'Месяц',
    monthlyTotal: 'Месяц, всего', monthlyCoding: 'Месяц, программирование', premiumRequests: 'Премиум-запросы',
    chat: 'Чат', completions: 'Автодополнение', toolQuota: 'Лимит инструментов', apiKeyQuota: 'Лимит API-ключа',
    credits: 'Кредиты', limit: 'Лимит', creditLimit: 'Лимит кредитов', fiveHours: '5 ч', weeklyLower: 'неделя', minutes: 'мин'
  },
  details: {
    unlimited: 'Безлимитно',
    leftOf: (remaining, total) => `Осталось ${remaining} из ${total}`,
    status: value => `Статус: ${value}`,
    creditsBalance: value => `Баланс кредитов: ${value}`,
    balance: (currency, amount) => `Баланс: ${amount} ${currency}`,
    creditsRemaining: value => `Кредитов осталось: ${value}`,
    apiUsageTotal: value => `Расход по API-ключу: ${value} всего`,
    today: value => `${value} сегодня`, thisWeek: value => `${value} за неделю`, thisMonth: value => `${value} за месяц`,
    plan: value => `Тариф: ${value}`,
    overage: value => `Дополнительных запросов использовано: ${value}`,
    extraUsage: value => `Дополнительное использование: ${value}`,
    notIncluded: label => `${label}: не входит в тариф`,
    resets: value => `сброс ${value}`
  },
  plans: { free: 'Бесплатный', pro: 'Pro' },
  providers: { chatgpt: 'Подписка ChatGPT / Codex', custom: 'Пользовательский endpoint' },
  reasons: {
    noPublicApi: 'У этого провайдера нет публичного API лимитов подписки.',
    notInCatalog: 'Провайдер отсутствует в каталоге Hermes.',
    noCredentials: 'В этом профиле нет учётных данных или не удалось запросить лимиты.',
    noClaudeOAuth: 'В этом профиле нет OAuth-доступа Claude Code.',
    noApiKey: (provider, variable) => `В этом профиле нет API-ключа ${provider} (${variable}).`,
    rejected: (provider, error) => `${provider} отклонил API-ключ (${error}).`,
    probeFailed: (provider, error) => `Не удалось запросить лимиты ${provider}: ${error}`,
    tierUnsupported: (provider, error) => `Лимиты ${provider} недоступны для этого аккаунта (${error}).`,
    internalProbe: error => `Ошибка запроса: ${error}`,
    kimiParse: 'Kimi вернул лимиты в неизвестном формате.',
    zaiParse: 'Z.AI вернул лимиты в неизвестном формате.',
    opencodeParse: 'OpenCode Go не вернул окна использования.',
    minimaxParse: 'MiniMax вернул данные coding-плана в неизвестном формате.',
    deepseekParse: 'DeepSeek не вернул данные баланса.',
    copilotParse: 'Copilot не вернул лимиты для этого аккаунта.',
    anthropicOauthOnly: 'Лимиты Anthropic доступны только для аккаунтов Claude с OAuth.',
    nousUnavailable: 'Nous Portal не авторизован или не вернул данные подписки.',
    zenUnavailable: 'Для этого ключа OpenCode Zen нет доступного API кредитов — тариф с оплатой по мере использования.'
  },
  errors: {
    loadTitle: 'Не удалось загрузить лимиты',
    loadDescription: message => `${message} — если здесь написано «Plugin not found», backend не включён для этого профиля. Включите плагин и повторите запрос.`,
    stale: message => `Показан последний успешный ответ — обновление не удалось: ${message}`,
    oldBackend: 'Backend запущен со старой версией плагина без данных профилей, поэтому выбор профиля скрыт. Перезапустите Hermes, чтобы загрузить текущую версию.',
    pluginNotFound: 'Плагин не найден',
    failedToFetch: 'Не удалось выполнить запрос'
  },
  page: {
    meta: (time, seconds) => `Обновлено ${time} · запрос занял ${seconds} с`,
    summaryMulti: (count, live, profile) => `${count} ${plural(count, 'провайдер', 'провайдера', 'провайдеров')} · профиль: ${profile} · лимиты доступны у ${live} · другой профиль можно выбрать выше`,
    summarySingle: (count, live) => `${count} ${plural(count, 'провайдер', 'провайдера', 'провайдеров')} · лимиты доступны у ${live}`,
    thisProfile: 'текущий',
    emptyAll: 'Все провайдеры скрыты',
    emptyNone: 'Нет провайдеров',
    emptyRestore: count => `Нажмите «Скрыто: ${count}» выше, чтобы вернуть их.`,
    emptyNoCredentials: 'В этом профиле нет ключей провайдеров и недавнего использования.',
    footer: '✕ на карточке скрывает провайдера (выбор сохраняется, провайдер исключается из статус-бара) · лимиты запрашиваются у API провайдеров с ключами этого профиля.'
  },
  chip: {
    pinned: ' (закреплено на странице «Лимиты ИИ»)',
    aria: detail => `Лимиты ИИ: ${detail}`,
    loading: 'Лимиты ИИ…'
  }
}

function withLocale(base, overrides) {
  const merged = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    const previous = merged[key]
    merged[key] = value && typeof value === 'object' && !Array.isArray(value) && previous && typeof previous === 'object'
      ? { ...previous, ...value }
      : value
  }
  return merged
}

const DE = withLocale(EN, {
  app: { title: 'KI-Nutzung' },
  common: { left: 'übrig' },
  status: { live: 'Live-Kontingent', none: 'kein Kontingent', unavailable: 'nicht verfügbar', recent: 'kürzlich verwendet', low: 'wenig', watch: 'beobachten' },
  actions: { refresh: 'Aktualisieren', refreshing: 'Aktualisierung…', retry: 'Erneut versuchen', unhideAll: 'Alle einblenden' },
  hidden: {
    button: count => `Ausgeblendet: ${count}`,
    showing: count => `Ausgeblendete eingeblendet: ${count}`,
    show: count => `Ausgeblendete Anbieter anzeigen: ${count}`,
    hideAgain: 'Ausgeblendete Anbieter wieder ausblenden',
    showProvider: 'Diesen Anbieter wieder einblenden',
    hideProvider: 'Diesen Anbieter ausblenden',
    unhide: label => `${label} einblenden`,
    hide: label => `${label} ausblenden`
  },
  picker: {
    profile: 'Hermes-Profil', profilePlaceholder: 'Profil…', default: 'Standard', up: 'aktiv',
    statusBar: 'In der Statusleiste:', chip: 'Anbieter in der Statusleiste',
    chipTitle: 'Welcher Anbieter in der Statusleiste angezeigt wird', auto: 'Auto (niedrigster %)'
  },
  reset: {
    now: 'wird jetzt zurückgesetzt',
    relative: (days, hours, minutes) => days
      ? `in ${days} T. ${hours} Std.`
      : hours ? `in ${hours} Std. ${minutes} Min.` : minutes ? `in ${minutes} Min.` : 'in weniger als einer Minute',
    at: (relative, time) => `Zurücksetzung ${relative} · ${time}`
  },
  windows: {
    currentSession: 'Aktuelle Sitzung', currentWeek: 'Aktuelle Woche', opusWeek: 'Opus-Woche', sonnetWeek: 'Sonnet-Woche',
    session: 'Sitzung', session5h: 'Sitzung (5 Std.)', rolling5h: 'Rollierend (5 Std.)', weekly: 'Wöchentlich',
    weeklyTotal: 'Wöchentlich gesamt', weeklyCoding: 'Wöchentlich Coding', monthly: 'Monatlich',
    monthlyTotal: 'Monatlich gesamt', monthlyCoding: 'Monatlich Coding', premiumRequests: 'Premium-Anfragen',
    chat: 'Chat', completions: 'Vervollständigungen', toolQuota: 'Tool-Kontingent', apiKeyQuota: 'API-Schlüssel-Kontingent',
    credits: 'Guthaben', limit: 'Limit', creditLimit: 'Guthabenlimit', fiveHours: '5 Std.', weeklyLower: 'wöchentlich', minutes: 'Min.'
  },
  details: {
    unlimited: 'Unbegrenzt',
    leftOf: (remaining, total) => `${remaining} von ${total} übrig`,
    status: value => `Status: ${value}`,
    creditsBalance: value => `Guthaben: ${value}`,
    balance: (currency, amount) => `Guthaben: ${amount} ${currency}`,
    creditsRemaining: value => `Verbleibendes Guthaben: ${value}`,
    apiUsageTotal: value => `API-Schlüssel-Verbrauch: ${value} insgesamt`,
    today: value => `${value} heute`, thisWeek: value => `${value} diese Woche`, thisMonth: value => `${value} diesen Monat`,
    plan: value => `Tarif: ${value}`,
    overage: value => `Zusätzliche Anfragen verbraucht: ${value}`,
    extraUsage: value => `Zusätzliche Nutzung: ${value}`,
    notIncluded: label => `${label}: nicht im Tarif enthalten`,
    resets: value => `Zurücksetzung ${value}`
  },
  plans: { free: 'Kostenlos', pro: 'Pro' },
  providers: { chatgpt: 'ChatGPT-/Codex-Abo', custom: 'Benutzerdefinierter Endpunkt' },
  reasons: {
    noPublicApi: 'Dieser Anbieter hat keine öffentliche API für Abo-Kontingente.',
    notInCatalog: 'Der Anbieter fehlt im Hermes-Katalog.',
    noCredentials: 'In diesem Profil fehlen Zugangsdaten oder die Kontingentabfrage ist fehlgeschlagen.',
    noClaudeOAuth: 'In diesem Profil ist kein Claude-Code-OAuth-Zugriff vorhanden.',
    noApiKey: (provider, variable) => `In diesem Profil fehlt der API-Schlüssel für ${provider} (${variable}).`,
    rejected: (provider, error) => `${provider} hat den API-Schlüssel abgelehnt (${error}).`,
    probeFailed: (provider, error) => `Kontingentabfrage für ${provider} fehlgeschlagen: ${error}`,
    tierUnsupported: (provider, error) => `Kontingente von ${provider} sind für dieses Konto nicht verfügbar (${error}).`,
    internalProbe: error => `Abfragefehler: ${error}`,
    kimiParse: 'Kimi hat Kontingente in einem unbekannten Format zurückgegeben.',
    zaiParse: 'Z.AI hat Kontingente in einem unbekannten Format zurückgegeben.',
    opencodeParse: 'OpenCode Go hat keine Nutzungsfenster zurückgegeben.',
    minimaxParse: 'MiniMax hat Coding-Tarifdaten in einem unbekannten Format zurückgegeben.',
    deepseekParse: 'DeepSeek hat keine Guthabendaten zurückgegeben.',
    copilotParse: 'Copilot hat keine Kontingente für dieses Konto zurückgegeben.',
    anthropicOauthOnly: 'Anthropic-Kontingente sind nur für Claude-Konten mit OAuth verfügbar.',
    nousUnavailable: 'Nous Portal ist nicht angemeldet oder hat keine Abo-Daten zurückgegeben.',
    zenUnavailable: 'Für diesen OpenCode-Zen-Schlüssel ist keine Guthaben-API erreichbar — Abrechnung nach Nutzung.'
  },
  errors: {
    loadTitle: 'Nutzungsdaten konnten nicht geladen werden',
    loadDescription: message => `${message} — „Plugin not found“ bedeutet, dass das Backend für dieses Profil nicht aktiviert ist. Aktiviere das Plugin und versuche es erneut.`,
    stale: message => `Die letzte erfolgreiche Antwort wird angezeigt — Aktualisierung fehlgeschlagen: ${message}`,
    oldBackend: 'Das Backend verwendet eine ältere Plugin-Version ohne Profildaten, daher ist die Profilauswahl ausgeblendet. Starte Hermes neu, um die aktuelle Version zu laden.',
    pluginNotFound: 'Plugin nicht gefunden',
    failedToFetch: 'Anfrage fehlgeschlagen'
  },
  page: {
    meta: (time, seconds) => `Aktualisiert ${time} · Abfrage dauerte ${seconds} s`,
    summaryMulti: (count, live, profile) => `${count} Anbieter · Profil: ${profile} · Live-Kontingente von ${live} · anderes Profil oben auswählbar`,
    summarySingle: (count, live) => `${count} Anbieter · Live-Kontingente von ${live}`,
    thisProfile: 'dieses Profil',
    emptyAll: 'Alle Anbieter sind ausgeblendet',
    emptyNone: 'Keine Anbieter vorhanden',
    emptyRestore: count => `Oben auf „Ausgeblendet: ${count}“ klicken, um sie zurückzuholen.`,
    emptyNoCredentials: 'Dieses Profil enthält keine Anbieter-Zugangsdaten und keine kürzliche Nutzung.',
    footer: '✕ auf einer Karte blendet den Anbieter aus (wird gespeichert und aus der Statusleiste entfernt) · Kontingente kommen von den APIs der Anbieter mit den Zugangsdaten dieses Profils.'
  },
  chip: {
    pinned: ' (auf der Seite „KI-Nutzung“ angeheftet)',
    aria: detail => `KI-Nutzung: ${detail}`,
    loading: 'KI-Nutzung…'
  }
})

const ES = withLocale(EN, {
  app: { title: 'Uso de IA' },
  common: { left: 'restante' },
  status: { live: 'cuota en vivo', none: 'sin cuota', unavailable: 'no disponible', recent: 'usado recientemente', low: 'bajo', watch: 'vigilar' },
  actions: { refresh: 'Actualizar', refreshing: 'Actualizando…', retry: 'Reintentar', unhideAll: 'Mostrar todo' },
  hidden: {
    button: count => `Ocultos: ${count}`,
    showing: count => `Ocultos visibles: ${count}`,
    show: count => `Mostrar proveedores ocultos: ${count}`,
    hideAgain: 'Ocultar de nuevo los proveedores',
    showProvider: 'Mostrar este proveedor de nuevo',
    hideProvider: 'Ocultar este proveedor',
    unhide: label => `Mostrar ${label}`,
    hide: label => `Ocultar ${label}`
  },
  picker: {
    profile: 'Perfil de Hermes', profilePlaceholder: 'perfil…', default: 'predeterminado', up: 'activo',
    statusBar: 'En la barra de estado:', chip: 'Proveedor en la barra de estado',
    chipTitle: 'Qué proveedor se muestra en la barra de estado', auto: 'Auto (% más bajo)'
  },
  reset: {
    now: 'se restablece ahora',
    relative: (days, hours, minutes) => days
      ? `en ${days} d ${hours} h`
      : hours ? `en ${hours} h ${minutes} min` : minutes ? `en ${minutes} min` : 'en menos de un minuto',
    at: (relative, time) => `se restablece ${relative} · ${time}`
  },
  windows: {
    currentSession: 'Sesión actual', currentWeek: 'Semana actual', opusWeek: 'Semana Opus', sonnetWeek: 'Semana Sonnet',
    session: 'Sesión', session5h: 'Sesión (5 h)', rolling5h: 'Ventana móvil (5 h)', weekly: 'Semanal',
    weeklyTotal: 'Total semanal', weeklyCoding: 'Programación semanal', monthly: 'Mensual',
    monthlyTotal: 'Total mensual', monthlyCoding: 'Programación mensual', premiumRequests: 'Solicitudes premium',
    chat: 'Chat', completions: 'Completados', toolQuota: 'Cuota de herramientas', apiKeyQuota: 'Cuota de clave API',
    credits: 'Créditos', limit: 'Límite', creditLimit: 'Límite de créditos', fiveHours: '5 h', weeklyLower: 'semanal', minutes: 'min'
  },
  details: {
    unlimited: 'Ilimitado',
    leftOf: (remaining, total) => `Quedan ${remaining} de ${total}`,
    status: value => `Estado: ${value}`,
    creditsBalance: value => `Saldo de créditos: ${value}`,
    balance: (currency, amount) => `Saldo: ${amount} ${currency}`,
    creditsRemaining: value => `Créditos restantes: ${value}`,
    apiUsageTotal: value => `Uso de la clave API: ${value} en total`,
    today: value => `${value} hoy`, thisWeek: value => `${value} esta semana`, thisMonth: value => `${value} este mes`,
    plan: value => `Plan: ${value}`,
    overage: value => `Solicitudes adicionales usadas: ${value}`,
    extraUsage: value => `Uso adicional: ${value}`,
    notIncluded: label => `${label}: no incluido en este plan`,
    resets: value => `se restablece ${value}`
  },
  plans: { free: 'Gratis', pro: 'Pro' },
  providers: { chatgpt: 'Suscripción ChatGPT / Codex', custom: 'Endpoint personalizado' },
  reasons: {
    noPublicApi: 'Este proveedor no ofrece una API pública de cuotas de suscripción.',
    notInCatalog: 'El proveedor no está en el catálogo de Hermes.',
    noCredentials: 'No hay credenciales en este perfil o no se pudo consultar la cuota.',
    noClaudeOAuth: 'Este perfil no tiene acceso OAuth a Claude Code.',
    noApiKey: (provider, variable) => `Este perfil no tiene una clave API de ${provider} (${variable}).`,
    rejected: (provider, error) => `${provider} rechazó la clave API (${error}).`,
    probeFailed: (provider, error) => `No se pudo consultar la cuota de ${provider}: ${error}`,
    tierUnsupported: (provider, error) => `La cuota de ${provider} no está disponible para esta cuenta (${error}).`,
    internalProbe: error => `Error de consulta: ${error}`,
    kimiParse: 'Kimi devolvió cuotas en un formato desconocido.',
    zaiParse: 'Z.AI devolvió cuotas en un formato desconocido.',
    opencodeParse: 'OpenCode Go no devolvió ventanas de uso.',
    minimaxParse: 'MiniMax devolvió datos del plan de programación en un formato desconocido.',
    deepseekParse: 'DeepSeek no devolvió datos de saldo.',
    copilotParse: 'Copilot no devolvió cuotas para esta cuenta.',
    anthropicOauthOnly: 'Las cuotas de Anthropic solo están disponibles para cuentas Claude con OAuth.',
    nousUnavailable: 'Nous Portal no ha iniciado sesión o no devolvió datos de suscripción.',
    zenUnavailable: 'Esta clave de OpenCode Zen no tiene una API de créditos accesible: es pago por uso.'
  },
  errors: {
    loadTitle: 'No se pudo cargar el uso',
    loadDescription: message => `${message} — «Plugin not found» significa que el backend no está habilitado para este perfil. Habilita el plugin y vuelve a intentarlo.`,
    stale: message => `Se muestra la última respuesta correcta; la actualización falló: ${message}`,
    oldBackend: 'El backend ejecuta una versión anterior del plugin sin datos por perfil, por eso el selector está oculto. Reinicia Hermes para cargar la versión actual.',
    pluginNotFound: 'Plugin no encontrado',
    failedToFetch: 'No se pudo realizar la solicitud'
  },
  page: {
    meta: (time, seconds) => `Actualizado ${time} · consulta de ${seconds} s`,
    summaryMulti: (count, live, profile) => `${count} proveedores · perfil: ${profile} · ${live} con cuota en vivo · puedes cambiar de perfil arriba`,
    summarySingle: (count, live) => `${count} proveedores · ${live} con cuota en vivo`,
    thisProfile: 'este perfil',
    emptyAll: 'Todos los proveedores están ocultos',
    emptyNone: 'No hay proveedores',
    emptyRestore: count => `Pulsa «Ocultos: ${count}» arriba para mostrarlos de nuevo.`,
    emptyNoCredentials: 'Este perfil no tiene credenciales de proveedores ni uso reciente.',
    footer: '✕ en una tarjeta oculta ese proveedor (se guarda y se excluye de la barra de estado) · las cuotas se obtienen de las API de los proveedores con las credenciales de este perfil.'
  },
  chip: {
    pinned: ' (fijado en la página «Uso de IA»)',
    aria: detail => `Uso de IA: ${detail}`,
    loading: 'Uso de IA…'
  }
})

const FR = withLocale(EN, {
  app: { title: 'Utilisation de l’IA' },
  common: { left: 'restant' },
  status: { live: 'quota en direct', none: 'aucun quota', unavailable: 'indisponible', recent: 'utilisé récemment', low: 'faible', watch: 'à surveiller' },
  actions: { refresh: 'Actualiser', refreshing: 'Actualisation…', retry: 'Réessayer', unhideAll: 'Tout afficher' },
  hidden: {
    button: count => `Masqués : ${count}`,
    showing: count => `Éléments masqués affichés : ${count}`,
    show: count => `Afficher les fournisseurs masqués : ${count}`,
    hideAgain: 'Masquer de nouveau les fournisseurs',
    showProvider: 'Afficher de nouveau ce fournisseur',
    hideProvider: 'Masquer ce fournisseur',
    unhide: label => `Afficher ${label}`,
    hide: label => `Masquer ${label}`
  },
  picker: {
    profile: 'Profil Hermes', profilePlaceholder: 'profil…', default: 'par défaut', up: 'actif',
    statusBar: 'Dans la barre d’état :', chip: 'Fournisseur dans la barre d’état',
    chipTitle: 'Fournisseur affiché dans la barre d’état', auto: 'Auto (% le plus bas)'
  },
  reset: {
    now: 'réinitialisation maintenant',
    relative: (days, hours, minutes) => days
      ? `dans ${days} j ${hours} h`
      : hours ? `dans ${hours} h ${minutes} min` : minutes ? `dans ${minutes} min` : 'dans moins d’une minute',
    at: (relative, time) => `réinitialisation ${relative} · ${time}`
  },
  windows: {
    currentSession: 'Session actuelle', currentWeek: 'Semaine actuelle', opusWeek: 'Semaine Opus', sonnetWeek: 'Semaine Sonnet',
    session: 'Session', session5h: 'Session (5 h)', rolling5h: 'Fenêtre glissante (5 h)', weekly: 'Hebdomadaire',
    weeklyTotal: 'Total hebdomadaire', weeklyCoding: 'Programmation hebdomadaire', monthly: 'Mensuel',
    monthlyTotal: 'Total mensuel', monthlyCoding: 'Programmation mensuelle', premiumRequests: 'Requêtes premium',
    chat: 'Chat', completions: 'Complétions', toolQuota: 'Quota d’outils', apiKeyQuota: 'Quota de clé API',
    credits: 'Crédits', limit: 'Limite', creditLimit: 'Limite de crédits', fiveHours: '5 h', weeklyLower: 'hebdomadaire', minutes: 'min'
  },
  details: {
    unlimited: 'Illimité',
    leftOf: (remaining, total) => `${remaining} sur ${total} restants`,
    status: value => `État : ${value}`,
    creditsBalance: value => `Solde de crédits : ${value}`,
    balance: (currency, amount) => `Solde : ${amount} ${currency}`,
    creditsRemaining: value => `Crédits restants : ${value}`,
    apiUsageTotal: value => `Utilisation de la clé API : ${value} au total`,
    today: value => `${value} aujourd’hui`, thisWeek: value => `${value} cette semaine`, thisMonth: value => `${value} ce mois-ci`,
    plan: value => `Offre : ${value}`,
    overage: value => `Requêtes supplémentaires utilisées : ${value}`,
    extraUsage: value => `Utilisation supplémentaire : ${value}`,
    notIncluded: label => `${label} : non inclus dans cette offre`,
    resets: value => `réinitialisation ${value}`
  },
  plans: { free: 'Gratuit', pro: 'Pro' },
  providers: { chatgpt: 'Abonnement ChatGPT / Codex', custom: 'Endpoint personnalisé' },
  reasons: {
    noPublicApi: 'Ce fournisseur ne propose pas d’API publique pour les quotas d’abonnement.',
    notInCatalog: 'Le fournisseur est absent du catalogue Hermes.',
    noCredentials: 'Aucun identifiant dans ce profil, ou la récupération du quota a échoué.',
    noClaudeOAuth: 'Ce profil ne dispose pas d’un accès OAuth à Claude Code.',
    noApiKey: (provider, variable) => `Aucune clé API ${provider} (${variable}) dans ce profil.`,
    rejected: (provider, error) => `${provider} a rejeté la clé API (${error}).`,
    probeFailed: (provider, error) => `Impossible de récupérer le quota de ${provider} : ${error}`,
    tierUnsupported: (provider, error) => `Le quota de ${provider} n’est pas disponible pour ce compte (${error}).`,
    internalProbe: error => `Erreur de récupération : ${error}`,
    kimiParse: 'Kimi a renvoyé des quotas dans un format inconnu.',
    zaiParse: 'Z.AI a renvoyé des quotas dans un format inconnu.',
    opencodeParse: 'OpenCode Go n’a renvoyé aucune fenêtre d’utilisation.',
    minimaxParse: 'MiniMax a renvoyé les données de l’offre de programmation dans un format inconnu.',
    deepseekParse: 'DeepSeek n’a renvoyé aucune donnée de solde.',
    copilotParse: 'Copilot n’a renvoyé aucun quota pour ce compte.',
    anthropicOauthOnly: 'Les quotas Anthropic sont réservés aux comptes Claude utilisant OAuth.',
    nousUnavailable: 'Nous Portal n’est pas connecté ou n’a renvoyé aucune donnée d’abonnement.',
    zenUnavailable: 'Aucune API de crédits accessible pour cette clé OpenCode Zen — facturation à l’utilisation.'
  },
  errors: {
    loadTitle: 'Impossible de charger l’utilisation',
    loadDescription: message => `${message} — « Plugin not found » signifie que le backend n’est pas activé pour ce profil. Activez le plugin puis réessayez.`,
    stale: message => `Dernière réponse valide affichée — échec de l’actualisation : ${message}`,
    oldBackend: 'Le backend utilise une ancienne version du plugin sans données par profil, le sélecteur est donc masqué. Redémarrez Hermes pour charger la version actuelle.',
    pluginNotFound: 'Plugin introuvable',
    failedToFetch: 'Échec de la requête'
  },
  page: {
    meta: (time, seconds) => `Actualisé ${time} · récupération en ${seconds} s`,
    summaryMulti: (count, live, profile) => `${count} fournisseurs · profil : ${profile} · quotas en direct pour ${live} · changez de profil ci-dessus`,
    summarySingle: (count, live) => `${count} fournisseurs · quotas en direct pour ${live}`,
    thisProfile: 'ce profil',
    emptyAll: 'Tous les fournisseurs sont masqués',
    emptyNone: 'Aucun fournisseur',
    emptyRestore: count => `Cliquez sur « Masqués : ${count} » ci-dessus pour les réafficher.`,
    emptyNoCredentials: 'Ce profil ne contient aucun identifiant de fournisseur ni utilisation récente.',
    footer: '✕ sur une carte masque le fournisseur (choix enregistré et exclu de la barre d’état) · les quotas proviennent des API des fournisseurs avec les identifiants de ce profil.'
  },
  chip: {
    pinned: ' (épinglé sur la page « Utilisation de l’IA »)',
    aria: detail => `Utilisation de l’IA : ${detail}`,
    loading: 'Utilisation de l’IA…'
  }
})

const JA = withLocale(EN, {
  app: { title: 'AI 使用量' },
  common: { left: '残り' },
  status: { live: 'リアルタイム枠', none: '枠なし', unavailable: '利用不可', recent: '最近使用', low: '残りわずか', watch: '注意' },
  actions: { refresh: '更新', refreshing: '更新中…', retry: '再試行', unhideAll: 'すべて表示' },
  hidden: {
    button: count => `非表示: ${count}`,
    showing: count => `非表示も表示中: ${count}`,
    show: count => `非表示のプロバイダーを表示: ${count}`,
    hideAgain: '非表示のプロバイダーを再び隠す',
    showProvider: 'このプロバイダーを再表示',
    hideProvider: 'このプロバイダーを隠す',
    unhide: label => `${label} を再表示`,
    hide: label => `${label} を隠す`
  },
  picker: {
    profile: 'Hermes プロファイル', profilePlaceholder: 'プロファイル…', default: '既定', up: '稼働中',
    statusBar: 'ステータスバー:', chip: 'ステータスバーのプロバイダー',
    chipTitle: 'ステータスバーに表示するプロバイダー', auto: '自動（最低残り %）'
  },
  reset: {
    now: 'まもなくリセット',
    relative: (days, hours, minutes) => days
      ? `${days}日${hours}時間後`
      : hours ? `${hours}時間${minutes}分後` : minutes ? `${minutes}分後` : '1分以内',
    at: (relative, time) => `${relative}にリセット · ${time}`
  },
  windows: {
    currentSession: '現在のセッション', currentWeek: '今週', opusWeek: 'Opus の週間枠', sonnetWeek: 'Sonnet の週間枠',
    session: 'セッション', session5h: 'セッション（5時間）', rolling5h: 'ローリング（5時間）', weekly: '週間',
    weeklyTotal: '週間合計', weeklyCoding: '週間コーディング', monthly: '月間',
    monthlyTotal: '月間合計', monthlyCoding: '月間コーディング', premiumRequests: 'プレミアムリクエスト',
    chat: 'チャット', completions: '補完', toolQuota: 'ツール枠', apiKeyQuota: 'APIキー枠',
    credits: 'クレジット', limit: '上限', creditLimit: 'クレジット上限', fiveHours: '5時間', weeklyLower: '週間', minutes: '分'
  },
  details: {
    unlimited: '無制限',
    leftOf: (remaining, total) => `${total} 中 ${remaining} 残り`,
    status: value => `ステータス: ${value}`,
    creditsBalance: value => `クレジット残高: ${value}`,
    balance: (currency, amount) => `残高: ${amount} ${currency}`,
    creditsRemaining: value => `残りクレジット: ${value}`,
    apiUsageTotal: value => `APIキー使用量: 合計 ${value}`,
    today: value => `今日: ${value}`, thisWeek: value => `今週: ${value}`, thisMonth: value => `今月: ${value}`,
    plan: value => `プラン: ${value}`,
    overage: value => `超過リクエスト使用数: ${value}`,
    extraUsage: value => `追加使用量: ${value}`,
    notIncluded: label => `${label}: このプランには含まれません`,
    resets: value => `リセット: ${value}`
  },
  plans: { free: '無料', pro: 'Pro' },
  providers: { chatgpt: 'ChatGPT / Codex サブスクリプション', custom: 'カスタムエンドポイント' },
  reasons: {
    noPublicApi: 'このプロバイダーにはサブスクリプション枠の公開 API がありません。',
    notInCatalog: 'このプロバイダーは Hermes カタログにありません。',
    noCredentials: 'このプロファイルに認証情報がないか、枠の取得に失敗しました。',
    noClaudeOAuth: 'このプロファイルには Claude Code の OAuth アクセスがありません。',
    noApiKey: (provider, variable) => `このプロファイルには ${provider} の APIキー（${variable}）がありません。`,
    rejected: (provider, error) => `${provider} が APIキーを拒否しました（${error}）。`,
    probeFailed: (provider, error) => `${provider} の枠を取得できませんでした: ${error}`,
    tierUnsupported: (provider, error) => `このアカウントでは ${provider} の枠を利用できません（${error}）。`,
    internalProbe: error => `取得エラー: ${error}`,
    kimiParse: 'Kimi が不明な形式の枠データを返しました。',
    zaiParse: 'Z.AI が不明な形式の枠データを返しました。',
    opencodeParse: 'OpenCode Go が使用期間データを返しませんでした。',
    minimaxParse: 'MiniMax が不明な形式のコーディングプランデータを返しました。',
    deepseekParse: 'DeepSeek が残高データを返しませんでした。',
    copilotParse: 'Copilot がこのアカウントの枠データを返しませんでした。',
    anthropicOauthOnly: 'Anthropic の枠は OAuth 対応の Claude アカウントでのみ利用できます。',
    nousUnavailable: 'Nous Portal にログインしていないか、サブスクリプションデータがありません。',
    zenUnavailable: 'この OpenCode Zen キーで利用できるクレジット API がありません。従量課金です。'
  },
  errors: {
    loadTitle: '使用量を読み込めませんでした',
    loadDescription: message => `${message} —「Plugin not found」は、このプロファイルでバックエンドが有効になっていないことを意味します。プラグインを有効にして再試行してください。`,
    stale: message => `最後に成功した応答を表示しています。更新に失敗しました: ${message}`,
    oldBackend: 'バックエンドがプロファイル別データに対応していない旧バージョンのため、プロファイル選択は非表示です。Hermes を再起動して現在のバージョンを読み込んでください。',
    pluginNotFound: 'プラグインが見つかりません',
    failedToFetch: 'リクエストに失敗しました'
  },
  page: {
    meta: (time, seconds) => `${time} 更新 · 取得時間 ${seconds} 秒`,
    summaryMulti: (count, live, profile) => `プロバイダー ${count} 件 · プロファイル: ${profile} · リアルタイム枠 ${live} 件 · 上部でプロファイルを切り替え`,
    summarySingle: (count, live) => `プロバイダー ${count} 件 · リアルタイム枠 ${live} 件`,
    thisProfile: 'このプロファイル',
    emptyAll: 'すべてのプロバイダーが非表示です',
    emptyNone: '表示するプロバイダーがありません',
    emptyRestore: count => `上部の「非表示: ${count}」を使って再表示できます。`,
    emptyNoCredentials: 'このプロファイルにはプロバイダーの認証情報と最近の使用履歴がありません。',
    footer: 'カードの ✕ でプロバイダーを非表示にします（保存され、ステータスバーからも除外されます）· 枠はこのプロファイルの認証情報を使って各プロバイダーの API から取得します。'
  },
  chip: {
    pinned: '（AI 使用量ページで固定）',
    aria: detail => `AI 使用量: ${detail}`,
    loading: 'AI 使用量…'
  }
})

const ZH = withLocale(EN, {
  app: { title: 'AI 用量' },
  common: { left: '剩余' },
  status: { live: '实时配额', none: '无配额', unavailable: '不可用', recent: '最近使用', low: '不足', watch: '注意' },
  actions: { refresh: '刷新', refreshing: '正在刷新…', retry: '重试', unhideAll: '全部显示' },
  hidden: {
    button: count => `已隐藏：${count}`,
    showing: count => `正在显示隐藏项：${count}`,
    show: count => `显示隐藏的提供商：${count}`,
    hideAgain: '再次隐藏这些提供商',
    showProvider: '重新显示此提供商',
    hideProvider: '隐藏此提供商',
    unhide: label => `显示 ${label}`,
    hide: label => `隐藏 ${label}`
  },
  picker: {
    profile: 'Hermes 配置文件', profilePlaceholder: '配置文件…', default: '默认', up: '运行中',
    statusBar: '状态栏：', chip: '状态栏中的提供商',
    chipTitle: '选择状态栏显示的提供商', auto: '自动（最低剩余 %）'
  },
  reset: {
    now: '现在重置',
    relative: (days, hours, minutes) => days
      ? `${days} 天 ${hours} 小时后`
      : hours ? `${hours} 小时 ${minutes} 分钟后` : minutes ? `${minutes} 分钟后` : '不到 1 分钟后',
    at: (relative, time) => `${relative}重置 · ${time}`
  },
  windows: {
    currentSession: '当前会话', currentWeek: '本周', opusWeek: 'Opus 每周', sonnetWeek: 'Sonnet 每周',
    session: '会话', session5h: '会话（5 小时）', rolling5h: '滚动窗口（5 小时）', weekly: '每周',
    weeklyTotal: '每周总量', weeklyCoding: '每周编程', monthly: '每月',
    monthlyTotal: '每月总量', monthlyCoding: '每月编程', premiumRequests: '高级请求',
    chat: '聊天', completions: '补全', toolQuota: '工具配额', apiKeyQuota: 'API 密钥配额',
    credits: '积分', limit: '限制', creditLimit: '积分限制', fiveHours: '5 小时', weeklyLower: '每周', minutes: '分钟'
  },
  details: {
    unlimited: '无限制',
    leftOf: (remaining, total) => `剩余 ${remaining}，共 ${total}`,
    status: value => `状态：${value}`,
    creditsBalance: value => `积分余额：${value}`,
    balance: (currency, amount) => `余额：${amount} ${currency}`,
    creditsRemaining: value => `剩余积分：${value}`,
    apiUsageTotal: value => `API 密钥用量：总计 ${value}`,
    today: value => `今日 ${value}`, thisWeek: value => `本周 ${value}`, thisMonth: value => `本月 ${value}`,
    plan: value => `套餐：${value}`,
    overage: value => `已使用的额外请求：${value}`,
    extraUsage: value => `额外用量：${value}`,
    notIncluded: label => `${label}：不包含在此套餐中`,
    resets: value => `重置时间 ${value}`
  },
  plans: { free: '免费', pro: 'Pro' },
  providers: { chatgpt: 'ChatGPT / Codex 订阅', custom: '自定义端点' },
  reasons: {
    noPublicApi: '此提供商没有公开的订阅配额 API。',
    notInCatalog: 'Hermes 目录中没有此提供商。',
    noCredentials: '此配置文件没有凭据，或配额查询失败。',
    noClaudeOAuth: '此配置文件没有 Claude Code OAuth 访问权限。',
    noApiKey: (provider, variable) => `此配置文件没有 ${provider} 的 API 密钥（${variable}）。`,
    rejected: (provider, error) => `${provider} 拒绝了 API 密钥（${error}）。`,
    probeFailed: (provider, error) => `无法查询 ${provider} 的配额：${error}`,
    tierUnsupported: (provider, error) => `此账户无法使用 ${provider} 的配额（${error}）。`,
    internalProbe: error => `查询失败：${error}`,
    kimiParse: 'Kimi 返回了未知格式的配额数据。',
    zaiParse: 'Z.AI 返回了未知格式的配额数据。',
    opencodeParse: 'OpenCode Go 未返回用量窗口。',
    minimaxParse: 'MiniMax 返回了未知格式的编程套餐数据。',
    deepseekParse: 'DeepSeek 未返回余额数据。',
    copilotParse: 'Copilot 未返回此账户的配额。',
    anthropicOauthOnly: 'Anthropic 配额仅适用于使用 OAuth 的 Claude 账户。',
    nousUnavailable: 'Nous Portal 未登录，或未返回订阅数据。',
    zenUnavailable: '此 OpenCode Zen 密钥没有可用的积分 API，采用按量付费。'
  },
  errors: {
    loadTitle: '无法加载用量',
    loadDescription: message => `${message} — 此处的“Plugin not found”表示此配置文件未启用后端。请启用插件后重试。`,
    stale: message => `正在显示上次成功的响应，刷新失败：${message}`,
    oldBackend: '后端运行的旧版插件不支持按配置文件读取数据，因此配置文件选择器已隐藏。请重启 Hermes 以加载当前版本。',
    pluginNotFound: '未找到插件',
    failedToFetch: '请求失败'
  },
  page: {
    meta: (time, seconds) => `更新于 ${time} · 查询耗时 ${seconds} 秒`,
    summaryMulti: (count, live, profile) => `${count} 个提供商 · 配置文件：${profile} · ${live} 个有实时配额 · 可在上方切换配置文件`,
    summarySingle: (count, live) => `${count} 个提供商 · ${live} 个有实时配额`,
    thisProfile: '此配置文件',
    emptyAll: '所有提供商均已隐藏',
    emptyNone: '没有可显示的提供商',
    emptyRestore: count => `点击上方的“已隐藏：${count}”可重新显示。`,
    emptyNoCredentials: '此配置文件没有提供商凭据和近期用量。',
    footer: '卡片上的 ✕ 可隐藏提供商（选择会保存，并从状态栏中排除）· 配额通过此配置文件的凭据从各提供商 API 获取。'
  },
  chip: {
    pinned: '（已在 AI 用量页面固定）',
    aria: detail => `AI 用量：${detail}`,
    loading: 'AI 用量…'
  }
})

const ZH_HANT = withLocale(EN, {
  app: { title: 'AI 用量' },
  common: { left: '剩餘' },
  status: { live: '即時配額', none: '無配額', unavailable: '無法使用', recent: '最近使用', low: '不足', watch: '注意' },
  actions: { refresh: '重新整理', refreshing: '正在重新整理…', retry: '重試', unhideAll: '全部顯示' },
  hidden: {
    button: count => `已隱藏：${count}`,
    showing: count => `正在顯示隱藏項目：${count}`,
    show: count => `顯示隱藏的供應商：${count}`,
    hideAgain: '再次隱藏這些供應商',
    showProvider: '重新顯示此供應商',
    hideProvider: '隱藏此供應商',
    unhide: label => `顯示 ${label}`,
    hide: label => `隱藏 ${label}`
  },
  picker: {
    profile: 'Hermes 設定檔', profilePlaceholder: '設定檔…', default: '預設', up: '執行中',
    statusBar: '狀態列：', chip: '狀態列中的供應商',
    chipTitle: '選擇狀態列顯示的供應商', auto: '自動（最低剩餘 %）'
  },
  reset: {
    now: '現在重設',
    relative: (days, hours, minutes) => days
      ? `${days} 天 ${hours} 小時後`
      : hours ? `${hours} 小時 ${minutes} 分鐘後` : minutes ? `${minutes} 分鐘後` : '不到 1 分鐘後',
    at: (relative, time) => `${relative}重設 · ${time}`
  },
  windows: {
    currentSession: '目前工作階段', currentWeek: '本週', opusWeek: 'Opus 每週', sonnetWeek: 'Sonnet 每週',
    session: '工作階段', session5h: '工作階段（5 小時）', rolling5h: '滑動時間窗（5 小時）', weekly: '每週',
    weeklyTotal: '每週總量', weeklyCoding: '每週程式設計', monthly: '每月',
    monthlyTotal: '每月總量', monthlyCoding: '每月程式設計', premiumRequests: '進階請求',
    chat: '聊天', completions: '自動完成', toolQuota: '工具配額', apiKeyQuota: 'API 金鑰配額',
    credits: '點數', limit: '限制', creditLimit: '點數限制', fiveHours: '5 小時', weeklyLower: '每週', minutes: '分鐘'
  },
  details: {
    unlimited: '無限制',
    leftOf: (remaining, total) => `剩餘 ${remaining}，共 ${total}`,
    status: value => `狀態：${value}`,
    creditsBalance: value => `點數餘額：${value}`,
    balance: (currency, amount) => `餘額：${amount} ${currency}`,
    creditsRemaining: value => `剩餘點數：${value}`,
    apiUsageTotal: value => `API 金鑰用量：總計 ${value}`,
    today: value => `今日 ${value}`, thisWeek: value => `本週 ${value}`, thisMonth: value => `本月 ${value}`,
    plan: value => `方案：${value}`,
    overage: value => `已使用的額外請求：${value}`,
    extraUsage: value => `額外用量：${value}`,
    notIncluded: label => `${label}：不包含在此方案中`,
    resets: value => `重設時間 ${value}`
  },
  plans: { free: '免費', pro: 'Pro' },
  providers: { chatgpt: 'ChatGPT / Codex 訂閱', custom: '自訂端點' },
  reasons: {
    noPublicApi: '此供應商沒有公開的訂閱配額 API。',
    notInCatalog: 'Hermes 目錄中沒有此供應商。',
    noCredentials: '此設定檔沒有憑證，或配額查詢失敗。',
    noClaudeOAuth: '此設定檔沒有 Claude Code OAuth 存取權限。',
    noApiKey: (provider, variable) => `此設定檔沒有 ${provider} 的 API 金鑰（${variable}）。`,
    rejected: (provider, error) => `${provider} 拒絕了 API 金鑰（${error}）。`,
    probeFailed: (provider, error) => `無法查詢 ${provider} 的配額：${error}`,
    tierUnsupported: (provider, error) => `此帳戶無法使用 ${provider} 的配額（${error}）。`,
    internalProbe: error => `查詢失敗：${error}`,
    kimiParse: 'Kimi 回傳了未知格式的配額資料。',
    zaiParse: 'Z.AI 回傳了未知格式的配額資料。',
    opencodeParse: 'OpenCode Go 未回傳用量時間窗。',
    minimaxParse: 'MiniMax 回傳了未知格式的程式設計方案資料。',
    deepseekParse: 'DeepSeek 未回傳餘額資料。',
    copilotParse: 'Copilot 未回傳此帳戶的配額。',
    anthropicOauthOnly: 'Anthropic 配額僅適用於使用 OAuth 的 Claude 帳戶。',
    nousUnavailable: 'Nous Portal 未登入，或未回傳訂閱資料。',
    zenUnavailable: '此 OpenCode Zen 金鑰沒有可用的點數 API，採用按量付費。'
  },
  errors: {
    loadTitle: '無法載入用量',
    loadDescription: message => `${message} — 此處的「Plugin not found」表示此設定檔未啟用後端。請啟用外掛後重試。`,
    stale: message => `正在顯示上次成功的回應，重新整理失敗：${message}`,
    oldBackend: '後端執行的舊版外掛不支援依設定檔讀取資料，因此設定檔選擇器已隱藏。請重新啟動 Hermes 以載入目前版本。',
    pluginNotFound: '找不到外掛',
    failedToFetch: '請求失敗'
  },
  page: {
    meta: (time, seconds) => `更新於 ${time} · 查詢耗時 ${seconds} 秒`,
    summaryMulti: (count, live, profile) => `${count} 個供應商 · 設定檔：${profile} · ${live} 個有即時配額 · 可在上方切換設定檔`,
    summarySingle: (count, live) => `${count} 個供應商 · ${live} 個有即時配額`,
    thisProfile: '此設定檔',
    emptyAll: '所有供應商均已隱藏',
    emptyNone: '沒有可顯示的供應商',
    emptyRestore: count => `點擊上方的「已隱藏：${count}」可重新顯示。`,
    emptyNoCredentials: '此設定檔沒有供應商憑證和近期用量。',
    footer: '卡片上的 ✕ 可隱藏供應商（選擇會儲存，並從狀態列中排除）· 配額透過此設定檔的憑證從各供應商 API 取得。'
  },
  chip: {
    pinned: '（已在 AI 用量頁面固定）',
    aria: detail => `AI 用量：${detail}`,
    loading: 'AI 用量…'
  }
})

const AR = withLocale(EN, {
  app: { title: 'استخدام الذكاء الاصطناعي' },
  common: { left: 'متبقٍ' },
  status: { live: 'حصة مباشرة', none: 'لا توجد حصة', unavailable: 'غير متاح', recent: 'مُستخدم مؤخرًا', low: 'منخفض', watch: 'مراقبة' },
  actions: { refresh: 'تحديث', refreshing: 'جارٍ التحديث…', retry: 'إعادة المحاولة', unhideAll: 'إظهار الكل' },
  hidden: {
    button: count => `مخفي: ${count}`,
    showing: count => `العناصر المخفية ظاهرة: ${count}`,
    show: count => `إظهار مزودي الخدمة المخفيين: ${count}`,
    hideAgain: 'إخفاء المزودين مجددًا',
    showProvider: 'إظهار هذا المزود مجددًا',
    hideProvider: 'إخفاء هذا المزود',
    unhide: label => `إظهار ${label}`,
    hide: label => `إخفاء ${label}`
  },
  picker: {
    profile: 'ملف Hermes الشخصي', profilePlaceholder: 'الملف الشخصي…', default: 'الافتراضي', up: 'يعمل',
    statusBar: 'في شريط الحالة:', chip: 'مزود الخدمة في شريط الحالة',
    chipTitle: 'مزود الخدمة الذي يظهر في شريط الحالة', auto: 'تلقائي (أقل نسبة %)'
  },
  reset: {
    now: 'إعادة الضبط الآن',
    relative: (days, hours, minutes) => days
      ? `خلال ${days} يوم ${hours} ساعة`
      : hours ? `خلال ${hours} ساعة ${minutes} دقيقة` : minutes ? `خلال ${minutes} دقيقة` : 'خلال أقل من دقيقة',
    at: (relative, time) => `إعادة الضبط ${relative} · ${time}`
  },
  windows: {
    currentSession: 'الجلسة الحالية', currentWeek: 'الأسبوع الحالي', opusWeek: 'أسبوع Opus', sonnetWeek: 'أسبوع Sonnet',
    session: 'الجلسة', session5h: 'الجلسة (5 ساعات)', rolling5h: 'نافذة متحركة (5 ساعات)', weekly: 'أسبوعي',
    weeklyTotal: 'الإجمالي الأسبوعي', weeklyCoding: 'البرمجة الأسبوعية', monthly: 'شهري',
    monthlyTotal: 'الإجمالي الشهري', monthlyCoding: 'البرمجة الشهرية', premiumRequests: 'طلبات مميزة',
    chat: 'دردشة', completions: 'إكمال', toolQuota: 'حصة الأدوات', apiKeyQuota: 'حصة مفتاح API',
    credits: 'أرصدة', limit: 'الحد', creditLimit: 'حد الأرصدة', fiveHours: '5 ساعات', weeklyLower: 'أسبوعي', minutes: 'دقيقة'
  },
  details: {
    unlimited: 'غير محدود',
    leftOf: (remaining, total) => `المتبقي ${remaining} من ${total}`,
    status: value => `الحالة: ${value}`,
    creditsBalance: value => `الأرصدة المتاحة: ${value}`,
    balance: (currency, amount) => `الرصيد: ${amount} ${currency}`,
    creditsRemaining: value => `الأرصدة المتبقية: ${value}`,
    apiUsageTotal: value => `استخدام مفتاح API: ${value} إجماليًا`,
    today: value => `${value} اليوم`, thisWeek: value => `${value} هذا الأسبوع`, thisMonth: value => `${value} هذا الشهر`,
    plan: value => `الخطة: ${value}`,
    overage: value => `الطلبات الإضافية المستخدمة: ${value}`,
    extraUsage: value => `الاستخدام الإضافي: ${value}`,
    notIncluded: label => `${label}: غير مشمول في هذه الخطة`,
    resets: value => `إعادة الضبط ${value}`
  },
  plans: { free: 'مجاني', pro: 'Pro' },
  providers: { chatgpt: 'اشتراك ChatGPT / Codex', custom: 'نقطة نهاية مخصصة' },
  reasons: {
    noPublicApi: 'لا يوفر هذا المزود واجهة API عامة لحصص الاشتراك.',
    notInCatalog: 'هذا المزود غير موجود في كتالوج Hermes.',
    noCredentials: 'لا توجد بيانات اعتماد في هذا الملف، أو تعذر الاستعلام عن الحصة.',
    noClaudeOAuth: 'لا يتوفر وصول Claude Code عبر OAuth في هذا الملف.',
    noApiKey: (provider, variable) => `لا يوجد مفتاح API لـ ${provider} (${variable}) في هذا الملف.`,
    rejected: (provider, error) => `رفض ${provider} مفتاح API (${error}).`,
    probeFailed: (provider, error) => `تعذر الاستعلام عن حصة ${provider}: ${error}`,
    tierUnsupported: (provider, error) => `حصة ${provider} غير متاحة لهذا الحساب (${error}).`,
    internalProbe: error => `فشل الاستعلام: ${error}`,
    kimiParse: 'أعاد Kimi بيانات الحصة بتنسيق غير معروف.',
    zaiParse: 'أعاد Z.AI بيانات الحصة بتنسيق غير معروف.',
    opencodeParse: 'لم يُعد OpenCode Go نوافذ الاستخدام.',
    minimaxParse: 'أعاد MiniMax بيانات خطة البرمجة بتنسيق غير معروف.',
    deepseekParse: 'لم يُعد DeepSeek بيانات الرصيد.',
    copilotParse: 'لم يُعد Copilot حصصًا لهذا الحساب.',
    anthropicOauthOnly: 'حصص Anthropic متاحة فقط لحسابات Claude التي تستخدم OAuth.',
    nousUnavailable: 'لم يتم تسجيل الدخول إلى Nous Portal، أو لم يُعد بيانات الاشتراك.',
    zenUnavailable: 'لا توجد واجهة API للأرصدة متاحة لمفتاح OpenCode Zen هذا — الدفع حسب الاستخدام.'
  },
  errors: {
    loadTitle: 'تعذر تحميل الاستخدام',
    loadDescription: message => `${message} — تعني «Plugin not found» أن الواجهة الخلفية غير مفعلة لهذا الملف. فعّل الإضافة ثم أعد المحاولة.`,
    stale: message => `يظهر آخر رد ناجح — فشل التحديث: ${message}`,
    oldBackend: 'تعمل الواجهة الخلفية بإصدار قديم من الإضافة بلا بيانات لكل ملف، لذا أُخفي منتقي الملفات. أعد تشغيل Hermes لتحميل الإصدار الحالي.',
    pluginNotFound: 'الإضافة غير موجودة',
    failedToFetch: 'فشل الطلب'
  },
  page: {
    meta: (time, seconds) => `حُدّث ${time} · استغرق الاستعلام ${seconds} ثانية`,
    summaryMulti: (count, live, profile) => `${count} من المزودين · الملف: ${profile} · الحصص المباشرة متاحة لدى ${live} · يمكن تغيير الملف أعلاه`,
    summarySingle: (count, live) => `${count} من المزودين · الحصص المباشرة متاحة لدى ${live}`,
    thisProfile: 'هذا الملف',
    emptyAll: 'كل المزودين مخفيون',
    emptyNone: 'لا يوجد مزودون للعرض',
    emptyRestore: count => `استخدم «مخفي: ${count}» أعلاه لإظهارهم مجددًا.`,
    emptyNoCredentials: 'لا توجد بيانات اعتماد للمزودين أو استخدام حديث في هذا الملف.',
    footer: 'يخفي ✕ على البطاقة المزود (يُحفظ الاختيار ويُستبعد من شريط الحالة) · تُجلب الحصص من واجهات API للمزودين باستخدام بيانات اعتماد هذا الملف.'
  },
  chip: {
    pinned: ' (مثبت في صفحة «استخدام الذكاء الاصطناعي»)',
    aria: detail => `استخدام الذكاء الاصطناعي: ${detail}`,
    loading: 'استخدام الذكاء الاصطناعي…'
  }
})

const LOCALES = { en: EN, ru: RU, de: DE, es: ES, fr: FR, ja: JA, ar: AR, zh: ZH, 'zh-hant': ZH_HANT }

const WINDOW_KEYS = {
  'Current session': 'currentSession', 'Current week': 'currentWeek', 'Opus week': 'opusWeek', 'Sonnet week': 'sonnetWeek',
  Session: 'session', 'Session (5h)': 'session5h', 'Rolling (5h)': 'rolling5h', Weekly: 'weekly',
  'Weekly total': 'weeklyTotal', 'Weekly coding': 'weeklyCoding', Monthly: 'monthly',
  'Monthly total': 'monthlyTotal', 'Monthly coding': 'monthlyCoding', 'Premium requests': 'premiumRequests',
  Chat: 'chat', Completions: 'completions', 'Tool quota': 'toolQuota', 'API key quota': 'apiKeyQuota',
  Credits: 'credits', Limit: 'limit', 'Credit Limit': 'creditLimit'
}

const REASON_KEYS = {
  'No public subscription-quota API for this provider.': 'noPublicApi',
  'Provider not in the Hermes catalog.': 'notInCatalog',
  'No credentials for this provider in this profile.': 'noCredentials',
  'No credentials for this provider in this profile, or its quota probe failed.': 'noCredentials',
  'No Claude Code OAuth credentials in this profile.': 'noClaudeOAuth',
  'Kimi returned no parseable usage windows.': 'kimiParse',
  'Z.AI returned no parseable quota limits.': 'zaiParse',
  'OpenCode Go returned no usage windows.': 'opencodeParse',
  'MiniMax returned no parseable coding-plan rows.': 'minimaxParse',
  'DeepSeek returned no balance rows.': 'deepseekParse',
  'Copilot returned no quota windows for this account.': 'copilotParse',
  'Anthropic account limits are only available for OAuth-backed Claude accounts.': 'anthropicOauthOnly',
  'Not signed in to Nous Portal, or the portal returned no subscription data.': 'nousUnavailable',
  'OpenCode Zen exposes no reachable credits/usage endpoint for this key — it is pay-as-you-go.': 'zenUnavailable'
}

function windowLabel(label, t) {
  const key = WINDOW_KEYS[label]
  if (key) return t(`windows.${key}`)
  if (label?.endsWith(' · 5h')) return `${label.slice(0, -4)} · ${t('windows.fiveHours')}`
  if (label?.endsWith(' · weekly')) return `${label.slice(0, -8)} · ${t('windows.weeklyLower')}`
  if (/^\d+ min$/.test(label || '')) return label.replace(' min', ` ${t('windows.minutes')}`)
  return label
}

function detailLabel(detail, t) {
  if (!detail) return detail
  if (detail === 'unlimited') return t('details.unlimited')
  let match = detail.match(/^(.+) of (.+) left$/)
  if (match) return t('details.leftOf', match[1], match[2])
  match = detail.match(/^status: (.+)$/)
  if (match) return t('details.status', match[1])
  match = detail.match(/^Credits balance: (.+)$/)
  if (match) return t('details.creditsBalance', match[1])
  match = detail.match(/^([A-Z]{3}) (-?[\d.,]+) balance$/)
  if (match) return t('details.balance', match[1], match[2])
  match = detail.match(/^Credits remaining: (.+)$/)
  if (match) return t('details.creditsRemaining', match[1])
  match = detail.match(/^Plan: (.+)$/)
  if (match) return t('details.plan', match[1])
  match = detail.match(/^Overage requests used: (.+)$/)
  if (match) return t('details.overage', match[1])
  match = detail.match(/^Extra usage: (.+)$/)
  if (match) return t('details.extraUsage', match[1])
  match = detail.match(/^(.+): not included in this plan$/)
  if (match) return t('details.notIncluded', windowLabel(match[1], t))
  if (detail.startsWith('API key usage:')) {
    return detail.split(' • ').map(part => {
      const total = part.match(/^API key usage: (.+) total$/)
      if (total) return t('details.apiUsageTotal', total[1])
      const period = part.match(/^(.+) (today|this week|this month)$/)
      if (period) return t(`details.${period[2] === 'today' ? 'today' : period[2] === 'this week' ? 'thisWeek' : 'thisMonth'}`, period[1])
      const reset = part.match(/^resets (.+)$/)
      return reset ? t('details.resets', reset[1]) : part
    }).join(' • ')
  }
  return detail
}

function reasonLabel(reason, t) {
  if (!reason) return reason
  const key = REASON_KEYS[reason]
  if (key) return t(`reasons.${key}`)
  let match = reason.match(/^No (.+) API key \(([^)]+)\) in this profile\.$/)
  if (match) return t('reasons.noApiKey', match[1], match[2])
  match = reason.match(/^(.+) rejected the API key \((.+)\)\.$/)
  if (match) return t('reasons.rejected', match[1], match[2])
  match = reason.match(/^(.+) quota probe failed: (.+)$/)
  if (match) return t('reasons.probeFailed', match[1], match[2])
  match = reason.match(/^(.+) quota not available for this account \((.+)\)\.$/)
  if (match) return t('reasons.tierUnsupported', match[1], match[2])
  match = reason.match(/^Probe failed: (.+)$/)
  if (match) return t('reasons.internalProbe', match[1])
  return reason
}

function errorLabel(error, t) {
  const message = String(error?.message || error || '')
  if (message.includes('Plugin not found')) return t('errors.pluginNotFound')
  if (message.includes('Failed to fetch')) return t('errors.failedToFetch')
  return message
}

function providerLabel(provider, t) {
  if (provider.id === 'openai-codex') return t('providers.chatgpt')
  if (provider.id === 'custom') return t('providers.custom')
  return provider.label
}

function planLabel(plan, t) {
  const key = String(plan || '').toLowerCase()
  return key === 'free' || key === 'pro' ? t(`plans.${key}`) : plan
}


let rest = null
let storage = null
let pendingRefresh = false

// Providers the user has hidden — plugin-scoped, shared by page and chip.
const HIDDEN_KEY = 'hidden-providers-v1'
const $hidden = atom([])

// Selected profile — plugin-scoped, shared by page and chip. Empty means
// "whatever this backend runs as".
const PROFILE_KEY = 'selected-profile-v1'
const $profile = atom('')

// Which provider the status-bar chip watches. Empty = AUTO: the worst remaining
// window across every visible provider (the historical default). A provider id
// pins the chip to that provider's own worst window; the page writes it.
const CHIP_KEY = 'chip-provider-v1'
const AUTO_CHIP = 'auto'
const $chipProvider = atom('')

function selectChipProvider(id) {
  const value = String(id || '')
  $chipProvider.set(value)
  try {
    storage?.set(CHIP_KEY, value)
  } catch {
    /* in-memory selection still works for this session */
  }
}

function persistHidden(ids) {
  $hidden.set(ids)
  try {
    storage?.set(HIDDEN_KEY, ids)
  } catch {
    /* keep the in-memory list when storage is unavailable */
  }
}

function hideProvider(id) {
  const current = $hidden.get()
  if (!current.includes(id)) persistHidden([...current, id])
}

function unhideProvider(id) {
  persistHidden($hidden.get().filter(value => value !== id))
}

function unhideAll() {
  persistHidden([])
}

function selectProfile(name) {
  const value = String(name || '')
  $profile.set(value)
  try {
    storage?.set(PROFILE_KEY, value)
  } catch {
    /* in-memory selection still works for this session */
  }
}

// ---------------------------------------------------------------- formatters

function fmtLocal(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function resetLabel(iso, t) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const seconds = Math.round((d.getTime() - Date.now()) / 1000)
  if (seconds <= 0) return t('reset.now')
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return t('reset.at', t('reset.relative', days, hours, minutes), fmtLocal(iso))
}

function pct(value) {
  if (value === null || value === undefined) return '—'
  return `${Math.round(Number(value))}%`
}

function toneFor(remaining) {
  if (remaining === null || remaining === undefined) return 'muted'
  if (remaining <= 5) return 'bad'
  if (remaining <= 25) return 'warn'
  return 'good'
}

function statusOf(provider, t) {
  if (provider.quota?.available) return { variant: 'success', label: t('status.live') }
  if (provider.quota?.unavailable_reason) return { variant: 'muted', label: t('status.none') }
  return { variant: 'muted', label: t('status.unavailable') }
}

function profileLabel(row, t) {
  if (!row) return t('picker.profilePlaceholder')
  const name = row.is_default ? t('picker.default') : row.name
  return `${name}${row.gateway_running ? ` · ${t('picker.up')}` : ''}`
}

/** Worst (lowest) remaining percent across visible providers' windows — drives the chip. */
/** One provider's tightest numeric window, or null when it reports none. */
function worstWindowOf(provider) {
  let worst = null
  for (const window of provider?.quota?.windows || []) {
    const remaining = window.remaining_percent
    if (remaining === null || remaining === undefined) continue
    if (worst === null || remaining < worst.remaining) {
      worst = {
        remaining,
        provider: provider.label,
        window: window.label,
        reset_at: window.reset_at || null
      }
    }
  }
  return worst
}

/** AUTO pick: the tightest window across every provider that isn't hidden. */
function worstRemaining(payload, hiddenIds) {
  const hidden = hiddenIds || []
  let worst = null
  for (const provider of payload?.providers || []) {
    if (hidden.includes(provider.id)) continue
    const candidate = worstWindowOf(provider)
    if (candidate && (worst === null || candidate.remaining < worst.remaining)) worst = candidate
  }
  return worst
}

// ---------------------------------------------------------------- data hooks

function usagePath(profile, refresh) {
  const params = []
  if (profile) params.push(`profile=${encodeURIComponent(profile)}`)
  if (refresh) params.push('refresh=1')
  return params.length ? `/usage?${params.join('&')}` : '/usage'
}

function useUsage(profile, intervalMs) {
  return useQuery({
    queryKey: [ID, 'usage', profile || 'server'],
    queryFn: () => {
      const refresh = pendingRefresh
      pendingRefresh = false
      return rest(usagePath(profile, refresh))
    },
    refetchInterval: intervalMs,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 1,
    // Switching profile must never blank the page or drop the picker.
    placeholderData: previous => previous
  })
}

// ---------------------------------------------------------------- components

function QuotaBar({ window }) {
  const t = usePluginI18n(ID)
  const remaining = window.remaining_percent
  if (remaining === null || remaining === undefined) {
    return jsxs('div', {
      className: 'flex items-baseline gap-2 text-xs',
      children: [
        jsx('span', { className: 'w-28 shrink-0 text-(--ui-text-tertiary)', children: windowLabel(window.label, t) }),
        jsx('span', { className: 'text-(--ui-text-quaternary)', children: detailLabel(window.detail, t) || t('details.unlimited') })
      ]
    })
  }
  const tone = toneFor(remaining)
  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-baseline gap-2 text-xs',
        children: [
          jsx('span', { className: 'w-28 shrink-0 text-(--ui-text-tertiary)', children: windowLabel(window.label, t) }),
          jsx('span', {
            className: cn('font-medium tabular-nums', remaining <= 25 ? 'text-(--ui-text-primary)' : 'text-(--ui-text-secondary)'),
            children: `${pct(remaining)} ${t('common.left')}`
          }),
          window.detail ? jsx('span', { className: 'text-(--ui-text-quaternary)', children: detailLabel(window.detail, t) }) : null,
          resetLabel(window.reset_at, t)
            ? jsx('span', { className: 'text-(--ui-text-quaternary)', children: resetLabel(window.reset_at, t) })
            : null,
          tone === 'bad' || tone === 'warn'
            ? jsx(Badge, { variant: tone === 'bad' ? 'destructive' : 'warn', size: 'xs', children: tone === 'bad' ? t('status.low') : t('status.watch') })
            : null
        ]
      }),
      jsx('div', {
        className: 'h-1.5 w-full overflow-hidden rounded-[2px]',
        style: { background: 'var(--ui-stroke-secondary)' },
        children: jsx('div', {
          className: 'h-full rounded-[2px]',
          style: { width: `${Math.max(1, Math.min(100, remaining))}%`, background: 'var(--ui-accent)' }
        })
      })
    ]
  })
}

function ProviderCard({ provider, isHidden }) {
  const t = usePluginI18n(ID)
  const status = statusOf(provider, t)
  const windows = provider.quota?.windows || []
  const details = provider.quota?.details || []

  return jsxs('div', {
    className: cn(
      'flex flex-col gap-2 rounded-[5px] border border-(--ui-stroke-secondary) p-3',
      isHidden && 'opacity-60'
    ),
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('span', { className: 'text-sm font-medium', children: providerLabel(provider, t) }),
          provider.quota?.plan
            ? jsx(Badge, { variant: 'muted', size: 'xs', children: planLabel(provider.quota.plan, t) })
            : null,
          jsx(Badge, { variant: status.variant, size: 'xs', children: status.label }),
          provider.active
            ? jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: t('status.recent') })
            : null,
          jsx('span', { className: 'flex-1' }),
          jsx('button', {
            type: 'button',
            title: isHidden ? t('hidden.showProvider') : t('hidden.hideProvider'),
            'aria-label': isHidden ? t('hidden.unhide', providerLabel(provider, t)) : t('hidden.hide', providerLabel(provider, t)),
            className: 'shrink-0 px-1 text-(--ui-text-quaternary) hover:text-(--ui-text-secondary)',
            onClick: () => {
              haptic('tap')
              if (isHidden) unhideProvider(provider.id)
              else hideProvider(provider.id)
            },
            children: jsx(Codicon, { name: isHidden ? 'eye' : 'close' })
          })
        ]
      }),
      windows.map((window, index) => jsx(QuotaBar, { window }, index)),
      !provider.quota?.available && provider.quota?.unavailable_reason
        ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: reasonLabel(provider.quota.unavailable_reason, t) })
        : null,
      details.map((detail, index) =>
        jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: detailLabel(detail, t) }, index)
      )
    ]
  })
}

function ProfilePicker({ profiles, value, onSelect }) {
  const t = usePluginI18n(ID)
  if (!profiles.length) return null
  return jsxs(Select, {
    value: value || undefined,
    onValueChange: onSelect,
    children: [
      jsx(SelectTrigger, {
        className: 'h-6 w-44 text-[0.6875rem]',
        'aria-label': t('picker.profile'),
        children: jsx(SelectValue, { placeholder: t('picker.profilePlaceholder') })
      }),
      jsx(SelectContent, {
        children: profiles.map(row => jsx(SelectItem, { value: row.name, children: profileLabel(row, t) }, row.name))
      })
    ]
  })
}

/** Picks which provider the status-bar chip watches. AUTO_CHIP keeps the
 *  historical behaviour (worst window across all visible providers); hidden
 *  providers aren't offered because the chip skips them either way. */
function ChipPicker({ providers, value, onSelect }) {
  const t = usePluginI18n(ID)
  return jsxs(Select, {
    value: value || AUTO_CHIP,
    onValueChange: next => {
      haptic('tap')
      onSelect(next === AUTO_CHIP ? '' : next)
    },
    children: [
      jsx(SelectTrigger, {
        className: 'h-6 w-56 text-[0.6875rem]',
        title: t('picker.chipTitle'),
        'aria-label': t('picker.chip'),
        children: jsx(SelectValue, {})
      }),
      jsx(SelectContent, {
        children: [
          jsx(SelectItem, { value: AUTO_CHIP, children: t('picker.auto') }, AUTO_CHIP),
          ...providers.map(provider =>
            jsx(SelectItem, { value: provider.id, children: providerLabel(provider, t) }, provider.id)
          )
        ]
      })
    ]
  })
}

function PageHeader({ profiles, profile, setProfile, chipProviders, chipProvider, setChipProvider, isFetching, refetch, meta, hiddenCount, showHidden, setShowHidden }) {
  const t = usePluginI18n(ID)
  return jsxs('div', {
    className: 'flex flex-wrap items-center gap-2',
    children: [
      jsx('span', { className: 'text-sm font-medium', children: t('app.title') }),
      jsx('span', {
        className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
        children: meta || ''
      }),
      jsx('span', { className: 'flex-1' }),
      hiddenCount > 0
        ? jsxs(Button, {
            variant: 'ghost',
            title: showHidden ? t('hidden.hideAgain') : t('hidden.show', hiddenCount),
            onClick: () => {
              haptic('tap')
              setShowHidden(!showHidden)
            },
            children: [
              jsx(Codicon, { name: 'eye' }),
              jsx('span', { children: showHidden ? t('hidden.showing', hiddenCount) : t('hidden.button', hiddenCount) })
            ]
          })
        : null,
      showHidden && hiddenCount > 0
        ? jsx(Button, {
            variant: 'text',
            onClick: () => {
              haptic('tap')
              unhideAll()
            },
            children: t('actions.unhideAll')
          })
        : null,
      jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: t('picker.statusBar') }),
      jsx(ChipPicker, { providers: chipProviders, value: chipProvider, onSelect: setChipProvider }),
      jsx(ProfilePicker, { profiles, value: profile, onSelect: setProfile }),
      jsxs(Button, {
        variant: 'secondary',
        onClick: () => {
          haptic('tap')
          pendingRefresh = true
          refetch()
        },
        disabled: isFetching,
        children: [jsx(Codicon, { name: 'refresh' }), jsx('span', { children: isFetching ? t('actions.refreshing') : t('actions.refresh') })]
      })
    ]
  })
}

function UsagePage() {
  const t = usePluginI18n(ID)
  const [showHidden, setShowHidden] = useState(false)
  const hiddenIds = useValue($hidden)
  const selected = useValue($profile)
  const { data, error, isFetching, refetch } = useUsage(selected, REFRESH_PAGE_MS)

  const chipProvider = useValue($chipProvider)
  const profiles = data?.profiles || []
  const shownProfile = selected || data?.profile || ''
  const header = jsx(PageHeader, {
    profiles,
    profile: shownProfile,
    setProfile: selectProfile,
    chipProviders: (data?.providers || []).filter(provider => !hiddenIds.includes(provider.id)),
    chipProvider,
    setChipProvider: selectChipProvider,
    isFetching,
    refetch,
    hiddenCount: hiddenIds.length,
    showHidden,
    setShowHidden,
    meta: data ? t('page.meta', fmtLocal(data.generated_at), data.probe_seconds) : null
  })

  // The header (profile picker + refresh) renders in EVERY state.
  if (error && !data) {
    return jsxs('div', {
      className: 'flex flex-col gap-3 p-4',
      children: [
        header,
        jsx(ErrorState, {
          title: t('errors.loadTitle'),
          description: t('errors.loadDescription', errorLabel(error, t)),
          children: jsx(Button, { variant: 'secondary', onClick: () => refetch(), children: t('actions.retry') })
        })
      ]
    })
  }
  if (!data) {
    return jsxs('div', {
      className: 'flex flex-col gap-3 p-4',
      children: [
        header,
        jsx(Skeleton, { className: 'h-6 w-48' }),
        jsx(Skeleton, { className: 'h-24 w-full' }),
        jsx(Skeleton, { className: 'h-24 w-full' })
      ]
    })
  }

  const providers = data.providers || []
  const visible = providers.filter(provider => !hiddenIds.includes(provider.id))
  const hiddenProviders = providers.filter(provider => hiddenIds.includes(provider.id))
  const live = visible.filter(provider => provider.quota?.available).length

  return jsxs(ScrollArea, {
    className: 'h-full',
    children: jsxs('div', {
      className: 'flex flex-col gap-3 p-4',
      children: [
        header,
        error && data
          ? jsx('div', {
              className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
              children: t('errors.stale', errorLabel(error, t))
            })
          : null,
        // A backend started before this plugin version still serves the old
        // payload shape (no per-profile data) — say so instead of silently
        // rendering a page with no picker.
        data.profiles
          ? null
          : jsx('div', {
              className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
              children: t('errors.oldBackend')
            }),
        jsx('div', {
          className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
          children: profiles.length > 1
            ? t('page.summaryMulti', providers.length, live, shownProfile === 'default' ? t('picker.default') : shownProfile || t('page.thisProfile'))
            : t('page.summarySingle', providers.length, live)
        }),
        jsx(Separator, {}),
        jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            visible.map((provider, index) => jsx(ProviderCard, { provider }, index)),
            showHidden
              ? hiddenProviders.map((provider, index) => jsx(ProviderCard, { provider, isHidden: true }, `hidden-${index}`))
              : null,
            visible.length === 0
              ? jsx(EmptyState, {
                  title: providers.length ? t('page.emptyAll') : t('page.emptyNone'),
                  description: providers.length
                    ? t('page.emptyRestore', hiddenProviders.length)
                    : t('page.emptyNoCredentials')
                })
              : null
          ]
        }),
        jsx('div', {
          className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
          children: t('page.footer')
        })
      ]
    })
  })
}

function UsageChip() {
  const t = usePluginI18n(ID)
  const hiddenIds = useValue($hidden)
  const selected = useValue($profile)
  const pinnedId = useValue($chipProvider)
  const { data } = useUsage(selected, REFRESH_CHIP_MS)

  // A pin only wins while it resolves to a visible provider with a numeric
  // window; hidden, absent for this profile, or quota-less falls back to AUTO
  // instead of blanking the chip.
  const visible = (data?.providers || []).filter(provider => !(hiddenIds || []).includes(provider.id))
  const pinned = pinnedId ? visible.find(provider => provider.id === pinnedId) : null
  const worst = (pinned ? worstWindowOf(pinned) : null) || worstRemaining(data, hiddenIds)
  const tone = toneFor(worst ? worst.remaining : null)
  const detail = worst
    ? [worst.provider, worst.window ? windowLabel(worst.window, t) : null, resetLabel(worst.reset_at, t)]
        .filter(Boolean)
        .join(' · ')
    : t('app.title')

  return jsx('button', {
    type: 'button',
    title: `${detail}${pinned ? t('chip.pinned') : ''}`,
    'aria-label': t('chip.aria', detail),
    className: 'px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
    onClick: () => {
      haptic('tap')
      host.navigate(ROUTE)
    },
    children: jsxs('span', {
      className: 'inline-flex items-center gap-1.5',
      children: [
        jsx('span', {
          'aria-hidden': true,
          className: 'inline-block size-1.5 rounded-full',
          style: {
            background:
              tone === 'bad'
                ? 'var(--ui-accent)'
                : tone === 'warn'
                  ? 'var(--ui-text-secondary)'
                  : 'var(--ui-text-quaternary)'
          }
        }),
        jsx('span', { children: worst ? `${pct(worst.remaining)} · ${worst.provider}` : data ? t('app.title') : t('chip.loading') })
      ]
    })
  })
}

export default {
  id: ID,
  name: 'AI Usage Tracker',
  register(ctx) {
    rest = ctx.rest
    storage = ctx.storage
    ctx.i18n.register(LOCALES)
    const registerNav = () => ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: ROUTE, label: ctx.i18n.t('app.title'), codicon: 'graph' }
    })
    registerNav()
    ctx.i18n.onLocaleChange(registerNav)
    try {
      const saved = storage?.get(HIDDEN_KEY, [])
      if (Array.isArray(saved)) $hidden.set(saved.filter(value => typeof value === 'string'))
    } catch {
      /* a malformed stored list must not block the plugin from loading */
    }
    try {
      const savedChip = storage?.get(CHIP_KEY, '')
      if (typeof savedChip === 'string') $chipProvider.set(savedChip)
    } catch {
      /* fall through to AUTO */
    }
    try {
      const savedProfile = storage?.get(PROFILE_KEY, '')
      if (typeof savedProfile === 'string' && savedProfile) {
        $profile.set(savedProfile)
      } else {
        // First run: default to the profile the app itself is on.
        const active = host.state.profile?.get?.()
        if (typeof active === 'string' && active) $profile.set(active)
      }
    } catch {
      /* fall through to the backend's own profile */
    }

    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: ROUTE },
      render: () => jsx(UsagePage, {})
    })

    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 125,
      render: () => jsx(UsageChip, {})
    })
  }
}
