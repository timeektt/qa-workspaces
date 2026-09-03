/* QAFocusTrap — focus management กลางสำหรับ custom modal ของ qa-workspace
 * custom modal (div backdrop + box) ไม่ได้ focus management ฟรีเหมือน native <dialog> → ต้องทำเอง (design.md §5.8)
 *
 * ใช้งาน: ตอนเปิด modal เรียกครั้งเดียว
 *   QAFocusTrap(boxEl);                       // focus แรก + Tab trap + restore focus (Escape ปล่อยให้ handler เดิม)
 *   QAFocusTrap(boxEl, { onEscape: closeFn }); // + Escape เรียก closeFn (สำหรับ modal ที่ยังไม่มี Escape)
 *
 * คืนอะไร: release() — เรียกเองได้ แต่ปกติ "ไม่ต้อง" เพราะ auto-release เมื่อ box ถูกลบออกจาก DOM
 *   (MutationObserver) → คืน focus ให้ element ที่เปิด modal (trigger) อัตโนมัติทุก close path
 * เพิ่ม role="dialog" + aria-modal="true" ให้กล่องถ้ายังไม่มี
 */
(function () {
  'use strict';
  if (window.QAFocusTrap) return;
  var SEL = 'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  window.QAFocusTrap = function (box, opts) {
    if (!box) return function () {};
    opts = opts || {};
    var prevFocus = document.activeElement;
    if (!box.getAttribute('role')) box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    function focusables() {
      return Array.prototype.filter.call(box.querySelectorAll(SEL), function (el) {
        return el.offsetParent !== null || el === document.activeElement; // เห็นอยู่จริง
      });
    }

    // focus element แรกในกล่อง (ถ้าไม่มี ให้ focus ตัวกล่องเอง)
    var f = focusables();
    if (f.length) { try { f[0].focus({ preventScroll: true }); } catch (e) {} }
    else { if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1'); try { box.focus({ preventScroll: true }); } catch (e) {} }

    function onKey(e) {
      if (e.key === 'Escape' && opts.onEscape) { e.preventDefault(); opts.onEscape(); return; }
      if (e.key !== 'Tab') return;
      var els = focusables();
      if (!els.length) { e.preventDefault(); return; }
      var first = els[0], last = els[els.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || !box.contains(a))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !box.contains(a))) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);

    var released = false;
    function release() {
      if (released) return;
      released = true;
      document.removeEventListener('keydown', onKey, true);
      if (mo) mo.disconnect();
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus({ preventScroll: true }); } catch (e) {} } // คืน focus ให้ trigger
    }

    // auto-release เมื่อ modal ปิด — ครอบทั้ง 2 แบบโดยไม่ต้องแก้ทุกจุดปิด:
    //   (1) create+remove → box หลุด DOM   (2) toggle hidden/.open → box มี display:none (getClientRects ว่าง)
    // ถูกเรียกหลัง modal แสดงแล้ว (box มองเห็น) → mutation แรกที่ทำให้ box หายค่อย release
    function gone() { return !document.contains(box) || box.getClientRects().length === 0; }
    var mo = new MutationObserver(function () { if (gone()) release(); });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });

    return release;
  };
})();
