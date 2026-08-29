/** Browser entry for the Web client and the desktop's read-only file preview. */
const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')

if (new URLSearchParams(location.search).get('dsh_preview') === '1') {
  void import('./desktop-preview.tsx').then(({ mountDesktopPreview }) => { mountDesktopPreview(el) })
} else {
  void import('@deepseek-ai/dsh-client-web').then(({ AppWebEntry }) => { void new AppWebEntry(el).run() })
}
