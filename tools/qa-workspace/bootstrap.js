/* bootstrap.js — standalone: เปิดหน้า Jira ตรงๆ (แทน enterJira() ของ workspace เดิม)
   เรียก init ของทั้ง 2 แท็บหลัง DOM พร้อม — โหลด meta/pending + wiring ปุ่ม/แท็บ */
document.addEventListener('DOMContentLoaded', () => {
  if (window.initJiraIntake) window.initJiraIntake();
  if (window.initJiraReject) window.initJiraReject();
});
