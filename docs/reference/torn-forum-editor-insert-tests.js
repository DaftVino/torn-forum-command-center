// TFCC #58 insert-route tests (docs/reference/torn-forum-editor-findings-2026-10-09.md).
// The OWNER pastes this whole file into DevTools Console on a forum thread page
// they opened themselves. Pasting it runs nothing; it only defines tfccTest.
// Then, with Torn's reply editor visible and EMPTY, run one test at a time:
//   tfccTest('A')   press Torn's Reset, then   tfccTest('B')   Reset   tfccTest('C')
// Each test writes a short sample into the owner's own unsent reply editor and
// logs what the editor now holds. None clicks Post, submits a form, navigates
// or sends a request. Never run by automation; not part of the userscript.
//
//   A  synthetic paste of plain HTML. Expected to lose the styles, as check 3a
//      did. Needs no page globals, so a sandboxed userscript could do it.
//   B  the same paste, marked as TinyMCE-internal content
//      ('<!-- x-tinymce/html -->'), which TinyMCE exempts from its paste style
//      filter. Also needs no page globals.
//   C  TinyMCE's own insertContent. Needs the page's tinymce global, which a
//      Tampermonkey script with grants reaches only through unsafeWindow.
function tfccTest(which) {
  var SAMPLE = '<p style="text-align: center;"><span style="color: var(--te-text-color-red);">red</span> '
    + '<span style="font-size: 18px;">big</span> <span style="text-decoration: underline;">under</span> '
    + '<strong>bold</strong></p>';
  var b = document.querySelector('#editor-wrapper .editor-content.mce-content-body');
  if (!b) { console.log('TFCC ' + which + ': no editor body'); return; }
  b.focus();
  if (which === 'A' || which === 'B') {
    var dt = new DataTransfer();
    dt.setData('text/html', (which === 'B' ? '<!-- x-tinymce/html -->' : '') + SAMPLE);
    dt.setData('text/plain', 'red big under bold');
    b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  } else if (which === 'C') {
    var ed = window.tinymce && window.tinymce.get(b.id);
    if (!ed) { console.log('TFCC C: no tinymce editor for ' + b.id); return; }
    ed.focus();
    ed.insertContent(SAMPLE);
  } else { console.log('TFCC: run tfccTest with A, B or C'); return; }
  setTimeout(function () {
    var html = b.innerHTML;
    var kept = ['text-align', 'te-text-color-red', 'font-size: 18px', 'underline', '<strong>']
      .map(function (k) { return '  ' + k + ': ' + (html.indexOf(k) >= 0 ? 'kept' : 'LOST'); });
    var src = b.parentNode && b.parentNode.querySelector('textarea');
    console.log('TFCC test ' + which + '\n' + kept.join('\n')
      + '\n  code view mirror updated: ' + (src ? (src.value.indexOf('bold') >= 0) : 'no textarea')
      + '\n' + html);
  }, 400);
}
