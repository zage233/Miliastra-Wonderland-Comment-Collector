/* Official account entry points. Window state must never imply posting permission. */
(() => {
  'use strict'
  const buttons = ['cn', 'os'].map(platform => document.getElementById('account-' + platform))
  const message = document.getElementById('accountMessage')
  if (!message || buttons.some(button => !button)) return
  let key = 'accounts.pending', sequence = 0
  const pending = new Set()
  const render = () => { message.textContent = t(key) }
  async function open(platform, button) {
    if (pending.has(platform)) return
    pending.add(platform); button.disabled = true
    const request = ++sequence
    key = 'accounts.opening'; render()
    try {
      const response = await fetch('/api/accounts/open', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }), signal: AbortSignal.timeout(20000) })
      const result = await response.json()
      if (request !== sequence) return
      key = response.ok && result.ok ? (result.foreground===false?'accounts.attention':result.alreadyOpen ? 'accounts.already' : 'accounts.opened')
        : (['accounts.invalid', 'accounts.unavailable', 'accounts.failed'].includes(result.errorKey) ? result.errorKey : 'accounts.failed')
    } catch { if (request === sequence) key = 'accounts.failed' }
    finally {
      pending.delete(platform); button.disabled = false
      if (request === sequence) render()
    }
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => open(index === 0 ? 'cn' : 'os', button))
    button.disabled = false
  })
  document.getElementById('lang')?.addEventListener('change', render)
  render()
})()
