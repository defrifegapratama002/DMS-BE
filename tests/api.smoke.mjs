// Uji API backend langsung (tanpa frontend) terhadap server yang sedang hidup.
//   npm run test:api        (butuh: npm run seed)
// Data uji dibuat lalu dihapus permanen di akhir.
const ORIGIN = process.env.API_ORIGIN ?? "http://localhost:5000";
const BASE = `${ORIGIN}/api`;
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  → " + extra : ""}`);
};

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

async function login(email) {
  const r = await call("POST", "/auth/login", { body: { email, password: "Password123!" } });
  return r.data.data;
}

const admin = await login("admin@dms.test");
const emp = await login("karyawan@dms.test");
const auditor = await login("auditor@dms.test");
ok("login admin", !!admin?.accessToken);
ok("login karyawan", !!emp?.accessToken);

// refresh token (bug lama: selalu gagal)
const rt = await call("POST", "/auth/refresh-token", { body: { refreshToken: admin.refreshToken } });
ok("refresh-token", rt.status === 200 && !!rt.data.data?.accessToken, String(rt.status));
const A = rt.data.data?.accessToken ?? admin.accessToken;
const E = emp.accessToken;

const all = await call("GET", "/folders/all", { token: A });
ok("folders/all (admin)", all.status === 200 && all.data.data.length >= 4, `${all.data.data?.length} folder`);
const empFolders = await call("GET", "/folders/all", { token: E });
ok("folders/all (karyawan hanya miliknya)", empFolders.data.data.length === 0);

const keu = all.data.data.find((f) => f.name === "Keuangan");
const docs = await call("GET", `/documents?folderId=${keu.id}&limit=100`, { token: A });
ok("documents by folder", docs.data.data.documents.length === 2, `${docs.data.data.documents.length} dok`);
ok("list berisi documentTags", Array.isArray(docs.data.data.documents[0].documentTags));
const empDocs = await call("GET", `/documents?limit=100`, { token: E });
ok("karyawan hanya lihat APPROVED", empDocs.data.data.documents.every((d) => d.status === "APPROVED"), `${empDocs.data.data.documents.length} dok`);

// upload
const form = new FormData();
form.append("file", new Blob(["halo dunia dms unik " + Date.now()], { type: "text/plain" }), "catatan-rapat.txt");
form.append("title", "Catatan Rapat");
form.append("folderId", keu.id);
const up = await call("POST", "/documents", { token: A, form });
ok("upload", up.status === 201, JSON.stringify(up.data).slice(0, 160));
const doc = up.data.data;
ok("otomatisasi menempel tag 'Baru'", doc?.documentTags?.some((t) => t.tag.name === "Baru"), JSON.stringify(doc?.appliedRules));

// duplikat
const blob = new Blob(["konten duplikat tetap"], { type: "text/plain" });
const f1 = new FormData(); f1.append("file", blob, "a.txt"); f1.append("title", "Dup A"); f1.append("folderId", keu.id);
const f2 = new FormData(); f2.append("file", blob, "b.txt"); f2.append("title", "Dup B"); f2.append("folderId", keu.id);
const f3 = new FormData(); f3.append("file", blob, "b.txt"); f3.append("title", "Dup B"); f3.append("folderId", keu.id); f3.append("allowDuplicate", "true");
const d1 = await call("POST", "/documents", { token: A, form: f1 });
const d2 = await call("POST", "/documents", { token: A, form: f2 });
const d3 = await call("POST", "/documents", { token: A, form: f3 });
ok("duplikat → 409", (d1.status === 201 || d1.status === 409) && d2.status === 409 && d2.data.code === "DUPLICATE_DOCUMENT", `${d1.status}/${d2.status}`);
ok("allowDuplicate → 201", d3.status === 201);

// file
const file = await call("GET", `/documents/${doc.id}/file`, { token: A });
ok("file inline", file.status === 200 && String(file.data).startsWith("halo dunia"), file.headers.get("content-disposition"));
const dl = await call("GET", `/documents/${doc.id}/file?download=1`, { token: A });
ok("file download", dl.status === 200 && dl.headers.get("content-disposition").startsWith("attachment"));
const noauth = await fetch(`${ORIGIN}/uploads/`);
ok("/uploads statis sudah ditutup", noauth.status === 404, String(noauth.status));

// content, notes, history, similar
const content = await call("GET", `/documents/${doc.id}/content`, { token: A });
ok("content", content.data.data.content?.includes("halo dunia"));
const note = await call("POST", `/documents/${doc.id}/notes`, { token: A, body: { body: "Catatan uji" } });
ok("add note", note.status === 201 && note.data.data.user?.name === "Bunga Admin");
const notes = await call("GET", `/documents/${doc.id}/notes`, { token: A });
ok("list notes", notes.data.data.length === 1);
const delNote = await call("DELETE", `/documents/notes/${note.data.data.id}`, { token: A });
ok("delete note", delNote.status === 200);
const hist = await call("GET", `/documents/${doc.id}/history`, { token: A });
ok("history terisi", hist.data.data.length >= 3, hist.data.data.map((l) => l.action).join(","));
const sim = await call("GET", `/documents/${docs.data.data.documents[0].id}/similar`, { token: A });
ok("similar", sim.status === 200, `${sim.data.data.length} mirip`);

// meta + custom fields + asn
const tags = await call("GET", "/metadata/tags", { token: A });
const fields = await call("GET", "/metadata/custom-fields", { token: A });
ok("custom-fields list", fields.data.data.length === 4);
const meta = await call("PATCH", `/documents/${doc.id}/meta`, {
  token: A,
  body: { tagIds: [tags.data.data[0].id], documentDate: "2025-03-01", asn: 1001, customFields: { [fields.data.data[0].id]: 5000000 } },
});
ok("update meta (tanggal polos, asn angka, customFields)", meta.status === 200 && meta.data.data.asn === "1001", JSON.stringify(meta.data).slice(0, 200));
const fields2 = await call("GET", "/metadata/custom-fields", { token: A });
ok("custom field documentCount", fields2.data.data[0].documentCount === 1);

// move
const legal = all.data.data.find((f) => f.name === "Legal");
const mv = await call("PATCH", `/documents/${doc.id}/move`, { token: A, body: { folderId: legal.id } });
ok("move document", mv.status === 200 && mv.data.data.folderId === legal.id);

// status + catatan alasan
const s1 = await call("PATCH", `/documents/${doc.id}/status`, { token: A, body: { status: "PENDING_REVIEW" } });
const s2 = await call("PATCH", `/documents/${doc.id}/status`, { token: A, body: { status: "DRAFT", reason: "Perlu revisi" } });
ok("submit + reject", s1.status === 200 && s2.status === 200, `${s1.status}/${s2.status} ${s2.data.message ?? ""}`);

// share link + publik
const link = await call("POST", `/shares/documents/${doc.id}/links`, { token: A, body: { access: "VIEWER", expires_in_days: 7 } });
ok("create share link", link.status === 201 && !!link.data.data.token);
const pub = await call("GET", `/public/share/${link.data.data.token}`);
ok("public resolve", pub.status === 200 && pub.data.data.document.title === "Catatan Rapat");
const pubFile = await call("GET", `/public/share/${link.data.data.token}/file`);
ok("public file inline", pubFile.status === 200);
const pubDl = await call("GET", `/public/share/${link.data.data.token}/file?download=1`);
ok("public download ditolak untuk VIEWER", pubDl.status === 403);
const links = await call("GET", `/shares/documents/${doc.id}/links`, { token: A });
ok("list links + accessCount", links.data.data[0].accessCount === 1);
const rev = await call("DELETE", `/shares/links/${link.data.data.id}`, { token: A });
const pub2 = await call("GET", `/public/share/${link.data.data.token}`);
ok("revoke link", rev.status === 200 && pub2.status === 404);

// share ke user + pencarian user
const us = await call("GET", "/users/search?q=andi", { token: A });
ok("users/search", us.data.data.length === 1 && us.data.data[0].email === "karyawan@dms.test");
const sh = await call("POST", `/shares/documents/${doc.id}/share`, { token: A, body: { user_id: us.data.data[0].id, access_level: "VIEWER" } });
ok("share ke karyawan", sh.status === 201 || sh.status === 200);
const empView = await call("GET", `/documents/${doc.id}`, { token: E });
ok("karyawan bisa lihat dokumen yang dibagikan", empView.status === 200 && empView.data.data.userAccess.canDownload === false);
const empDl = await call("GET", `/documents/${doc.id}/file?download=1`, { token: E });
ok("VIEWER tidak bisa unduh", empDl.status === 403);

// search
const sr = await call("GET", "/search?q=halo dunia", { token: A });
ok("search isi berkas", sr.data.data.some((r) => r.kind === "document" && r.snippet), JSON.stringify(sr.data.data[0] ?? null).slice(0, 160));
const sr2 = await call("GET", "/search?q=keuangan", { token: A });
ok("search folder + dokumen", sr2.data.data.some((r) => r.kind === "folder") && sr2.data.data.some((r) => r.kind === "document"));

// workflows
const wf = await call("POST", "/workflows", { token: A, body: { name: "Uji", trigger: "upload", match_extensions: ["PDF"] } });
ok("create workflow", wf.status === 201 && wf.data.data.matchExtensions[0] === "pdf", JSON.stringify(wf.data).slice(0, 160));
const wfm = await call("POST", `/workflows/${wf.data.data.id}/move`, { token: A, body: { direction: "up" } });
const wfl = await call("GET", "/workflows", { token: A });
ok("move workflow up", wfm.status === 200 && wfl.data.data[0].id === wf.data.data.id);
await call("DELETE", `/workflows/${wf.data.data.id}`, { token: A });
const wfEmp = await call("GET", "/workflows", { token: E });
ok("workflow admin-only", wfEmp.status === 403);

// stats
const st = await call("GET", "/stats/dashboard", { token: A });
ok("stats", st.status === 200 && st.data.data.activitySeries.length === 7 && st.data.data.byStatus.DRAFT >= 1, JSON.stringify({ ...st.data.data, recentDocuments: undefined, pendingReview: undefined, activitySeries: undefined }).slice(0, 300));

// audit untuk auditor
const au = await call("GET", "/activity-logs?limit=5", { token: auditor.accessToken });
ok("auditor bisa baca audit log", au.status === 200 && au.data.data.length > 0);

// trash
const del = await call("DELETE", `/documents/${doc.id}`, { token: A });
const tr = await call("GET", "/documents/trash", { token: A });
ok("trash", del.status === 200 && tr.data.data.some((d) => d.id === doc.id && d.folder?.name));
const rs = await call("POST", `/documents/${doc.id}/restore`, { token: A });
ok("restore", rs.status === 200);

// folder: siklus & hapus folder berisi
const sub = all.data.data.find((f) => f.name === "Laporan Tahunan");
const cyc = await call("PATCH", `/folders/${keu.id}/move`, { token: A, body: { parentFolderId: sub.id } });
ok("cegah siklus folder", cyc.status === 400, cyc.data.message);
const delF = await call("DELETE", `/folders/${keu.id}`, { token: A });
ok("folder berisi dokumen tidak bisa dihapus", delF.status === 400, delF.data.message);

// bersihkan dokumen uji
for (const id of [doc.id, d1.data.data?.id, d3.data.data?.id].filter(Boolean)) {
  await call("DELETE", `/documents/${id}`, { token: A });
  await call("DELETE", `/documents/${id}/purge`, { token: A });
}

console.log(`\n${pass} lolos, ${fail} gagal`);
process.exit(fail ? 1 : 0);
