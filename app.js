
let db;
let currentSubjectId = null;
let selectedUnitId = null;
let selectedReviewId = null;

const UNIT_RE = /^\d+-\d+$/;

function $(id){ return document.getElementById(id); }

function parseEntries(text) {
  const parts = text.trim().split(/[,、\s]+/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    let code = p, title = "";
    const m = p.split(/[:：=]/);
    if (m.length >= 2) {
      code = m[0].trim();
      title = m.slice(1).join(":").trim();
    }
    if (!seen.has(code)) {
      out.push({ code, title: title || null });
      seen.add(code);
    }
  }
  return out;
}

async function refreshSubjects(selectId=null) {
  const subs = await listSubjects(db);
  const sel = $("subjectSelect");
  sel.innerHTML = "";
  subs.forEach(s=>{
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  if (subs.length) {
    currentSubjectId = selectId ?? currentSubjectId ?? subs[0].id;
    sel.value = currentSubjectId;
  }
  await refreshAll();
}

async function refreshAll() {
  if (!currentSubjectId) return;
  await refreshDue();
  await refreshUpcoming();
  await refreshUnits();
  await refreshReviews(); // unit selected?
}

async function refreshDue() {
  const tbody = $("dueTable").querySelector("tbody");
  tbody.innerHTML = "";
  const subs = await listSubjects(db);
  const subMap = new Map(subs.map(s=>[s.id, s]));

  const units = await getAll(db, "units");
  const today = new Date(); today.setHours(0,0,0,0);

  const rows = [];
  for (const u of units) {
    const status = await computeUnitStatus(db, u);
    if (status.lastNo === 0) continue;
    const due = new Date(status.nextDue); due.setHours(0,0,0,0);
    if (due <= today) {
      const overdue = Math.max(0, Math.round((today - due)/(1000*60*60*24)));
      rows.push({
        subjectOrder: subMap.get(u.subjectId)?.sortOrder ?? 999,
        subject: subMap.get(u.subjectId)?.name ?? "",
        unitCode: u.unitCode,
        title: u.title ?? "",
        lastNo: status.lastNo,
        lastDate: status.lastDate,
        nextDue: status.nextDue,
        overdue
      });
    }
  }
  rows.sort((a,b)=> a.subjectOrder-b.subjectOrder || b.overdue-a.overdue || a.nextDue.localeCompare(b.nextDue) || a.unitCode.localeCompare(b.unitCode));

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.subject}</td><td>${r.unitCode}</td><td>${escapeHtml(r.title)}</td>
                    <td>${r.lastNo}</td><td>${r.lastDate}</td><td>${r.nextDue}</td><td>${r.overdue}</td>`;
    tbody.appendChild(tr);
  }
}

async function refreshUpcoming() {
  const tbody = $("upcomingTable").querySelector("tbody");
  tbody.innerHTML = "";
  const subs = await listSubjects(db);
  const subMap = new Map(subs.map(s=>[s.id, s]));

  const units = await getAll(db, "units");
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(today); end.setDate(end.getDate()+7);

  const rows = [];
  for (const u of units) {
    const status = await computeUnitStatus(db, u);
    if (status.lastNo === 0) continue;
    const due = new Date(status.nextDue); due.setHours(0,0,0,0);
    if (today <= due && due <= end) {
      rows.push({
        due: status.nextDue,
        subjectOrder: subMap.get(u.subjectId)?.sortOrder ?? 999,
        subject: subMap.get(u.subjectId)?.name ?? "",
        unitCode: u.unitCode,
        title: u.title ?? "",
        lastNo: status.lastNo,
        lastDate: status.lastDate
      });
    }
  }
  rows.sort((a,b)=> a.due.localeCompare(b.due) || a.subjectOrder-b.subjectOrder || a.unitCode.localeCompare(b.unitCode));

  let lastDue = null;
  for (const r of rows) {
    if (r.due !== lastDue) {
      const g = document.createElement("tr");
      g.className = "group";
      g.innerHTML = `<td>${r.due}</td><td colspan="5"></td>`;
      tbody.appendChild(g);
      lastDue = r.due;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td>${r.subject}</td><td>${r.unitCode}</td><td>${escapeHtml(r.title)}</td>
                    <td>${r.lastNo}</td><td>${r.lastDate}</td>`;
    tbody.appendChild(tr);
  }
}

async function refreshUnits() {
  const tbody = $("unitsTable").querySelector("tbody");
  tbody.innerHTML = "";
  const units = await listUnitsBySubject(db, currentSubjectId);

  for (const u of units) {
    const status = await computeUnitStatus(db, u);
    const tr = document.createElement("tr");
    tr.dataset.unitId = u.id;
    tr.innerHTML = `<td>${u.unitCode}</td><td>${escapeHtml(u.title||"")}</td>
                    <td>${status.lastNo}</td><td>${status.lastDate}</td><td>${status.nextDue}</td>`;
    tr.onclick = async () => {
      selectedUnitId = u.id;
      $("unitCode").value = u.unitCode;
      $("unitTitle").value = u.title || "";
      $("unitDate").valueAsDate = new Date();
      $("unitReviewNo").value = "";
      selectedReviewId = null;
      await refreshReviews();
      highlightSelectedUnit();
    };
    tbody.appendChild(tr);
  }
  highlightSelectedUnit();
}

function highlightSelectedUnit() {
  const rows = $("unitsTable").querySelectorAll("tbody tr");
  rows.forEach(r=> r.style.outline = (Number(r.dataset.unitId)===selectedUnitId) ? "2px solid #7aa2ff" : "none");
}

async function refreshReviews() {
  const tbody = $("reviewsTable").querySelector("tbody");
  tbody.innerHTML = "";
  selectedReviewId = null;
  $("editReviewNo").value = "";
  $("editReviewDate").value = "";

  if (!selectedUnitId) return;
  const revs = await listReviewsByUnit(db, selectedUnitId);
  for (const r of revs) {
    const tr = document.createElement("tr");
    tr.dataset.reviewId = r.id;
    tr.innerHTML = `<td>${r.id}</td><td>${r.reviewNo}</td><td>${r.doneDate}</td>`;
    tr.onclick = () => {
      selectedReviewId = r.id;
      $("editReviewNo").value = r.reviewNo;
      $("editReviewDate").value = r.doneDate;
      highlightSelectedReview();
    };
    tbody.appendChild(tr);
  }
}

function highlightSelectedReview() {
  const rows = $("reviewsTable").querySelectorAll("tbody tr");
  rows.forEach(r=> r.style.outline = (Number(r.dataset.reviewId)===selectedReviewId) ? "2px solid #7aa2ff" : "none");
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function toast(msg){ $("log").textContent = msg; setTimeout(()=>{$("log").textContent="";}, 3000); }

async function init() {
  db = await openDb();
  await seedDefaultSubjects(db);

  // set today for date inputs
  const todayStr = new Date().toISOString().slice(0,10);
  $("unitDate").value = todayStr;

  await refreshSubjects();

  // PWA SW register（PWA要件のひとつ）
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }

  $("subjectSelect").onchange = async (e) => {
    currentSubjectId = Number(e.target.value);
    selectedUnitId = null;
    selectedReviewId = null;
    await refreshAll();
  };

  $("addSubjectBtn").onclick = async () => {
    const name = prompt("追加する教科名を入力（例：相続税法）");
    if (!name) return;
    try { await addSubject(db, name); await refreshSubjects(); }
    catch(e){ alert(e.message); }
  };

  $("subjectUpBtn").onclick = async () => {
    if (!currentSubjectId) return;
    await moveSubject(db, Number(currentSubjectId), -1);
    await refreshSubjects(Number(currentSubjectId));
  };
  $("subjectDownBtn").onclick = async () => {
    if (!currentSubjectId) return;
    await moveSubject(db, Number(currentSubjectId), +1);
    await refreshSubjects(Number(currentSubjectId));
  };

  $("recordTodayBtn").onclick = async () => {
    const entries = parseEntries($("todayInput").value);
    if (!entries.length) return toast("入力が空やで");
    const overwrite = $("overwriteTitle").checked;

    for (const it of entries) {
      if (!UNIT_RE.test(it.code)) { toast(`形式エラー: ${it.code}`); continue; }
      const unitId = await getOrCreateUnit(db, Number(currentSubjectId), it.code);
      if (it.title) {
        const units = await getAll(db, "units");
        const u = units.find(x=>x.id===unitId);
        if (u && (!u.title || overwrite)) {
          await updateUnitTitle(db, unitId, it.title);
        }
      }
      const doneDate = new Date().toISOString().slice(0,10);
      // 重複日付防止（unique index by_unit_date）
      try{
        const nextNo = await getNextReviewNo(db, unitId);
        await insertReview(db, unitId, nextNo, doneDate);
      } catch(e){
        // 既に同日記録など
      }
    }

    $("todayInput").value = "";
    toast("記録したで");
    await refreshAll();
  };

  $("addOrRecordBtn").onclick = async () => {
    if (!currentSubjectId) return;
    const code = $("unitCode").value.trim();
    const title = $("unitTitle").value.trim();
    const doneDate = $("unitDate").value;
    const overwrite = $("overwriteTitle2").checked;
    const rnoInput = $("unitReviewNo").value;

    if (!UNIT_RE.test(code)) return alert("単元コードは 1-1 形式（数字-数字）やで");
    if (!doneDate) return alert("学習日を入れてな");

    const unitId = await getOrCreateUnit(db, Number(currentSubjectId), code);

    if (title) {
      const units = await getAll(db, "units");
      const u = units.find(x=>x.id===unitId);
      if (u && (!u.title || overwrite)) await updateUnitTitle(db, unitId, title);
    }

    let reviewNo = null;
    if (rnoInput) {
      reviewNo = Number(rnoInput);
      if (!Number.isInteger(reviewNo) || reviewNo <= 0) return alert("回数は正の整数やで");
      // 回数重複チェック
      const revs = await listReviewsByUnit(db, unitId);
      if (revs.some(r=>r.reviewNo===reviewNo)) return alert(`回数 ${reviewNo} は既にあるで（編集か再採番してな）`);
    } else {
      reviewNo = await getNextReviewNo(db, unitId);
    }

    try {
      await insertReview(db, unitId, reviewNo, doneDate);
    } catch(e) {
      return alert("同じ学習日/回数が既にあるっぽいで（重複防止）");
    }

    selectedUnitId = unitId;
    toast(`追加/記録: ${code} ${doneDate} ${reviewNo}回目`);
    await refreshAll();
  };

  $("deleteUnitBtn").onclick = async () => {
    if (!selectedUnitId) return alert("削除する単元を一覧から選んでな");
    if (!confirm("この単元を削除（履歴も全部削除）してええ？")) return;
    await deleteUnit(db, selectedUnitId);
    selectedUnitId = null;
    selectedReviewId = null;
    await refreshAll();
  };

  $("updateReviewBtn").onclick = async () => {
    if (!selectedUnitId || !selectedReviewId) return alert("編集する履歴を選んでな");
    const newNo = Number($("editReviewNo").value);
    const newDate = $("editReviewDate").value;
    if (!Number.isInteger(newNo) || newNo <= 0) return alert("回数は正の整数やで");
    if (!newDate) return alert("学習日を入れてな");

    const revs = await listReviewsByUnit(db, selectedUnitId);
    if (revs.some(r=>r.id!==selectedReviewId && r.reviewNo===newNo)) return alert(`回数 ${newNo} が既にあるで`);
    if (revs.some(r=>r.id!==selectedReviewId && r.doneDate===newDate)) return alert(`学習日 ${newDate} が既にあるで`);

    await updateReview(db, selectedReviewId, selectedUnitId, newNo, newDate);
    toast("編集したで");
    await refreshAll();
  };

  $("deleteReviewBtn").onclick = async () => {
    if (!selectedReviewId) return alert("削除する履歴を選んでな");
    if (!confirm("この復習履歴を削除してええ？")) return;
    await deleteReview(db, selectedReviewId);
    selectedReviewId = null;
    toast("削除したで");
    await refreshAll();
  };

  $("renumberBtn").onclick = async () => {
    if (!selectedUnitId) return alert("再採番する単元を選んでな");
    if (!confirm("この単元の履歴を日付順に1..nへ再採番してええ？")) return;
    await renumberReviews(db, selectedUnitId);
    toast("再採番したで");
    await refreshAll();
  };

  // Export / Import
  $("exportBtn").onclick = async () => {
    const data = await exportJson(db);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `study-sync-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  $("importFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (!confirm("インポートします。この端末のデータは上書きされます。ええ？")) return;
      await importJsonOverwrite(db, data);
      toast("インポート完了");
      selectedUnitId = null;
      selectedReviewId = null;
      await refreshSubjects();
    } catch(err) {
      alert("インポート失敗: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  $("wipeBtn").onclick = async () => {
    if (!confirm("この端末のデータを全消去するで。ほんまにええ？")) return;
    await clearAll(db);
    await seedDefaultSubjects(db);
    selectedUnitId = null;
    selectedReviewId = null;
    await refreshSubjects();
    toast("全消去したで");
  };
}

window.addEventListener("load", init);
