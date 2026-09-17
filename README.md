# DMS-BE

Backend Secure DMS — Express 5 + Prisma 7 + PostgreSQL. Dipakai frontend
[DMS-FE](https://github.com/rafidhiaas/DMS-FE) lewat BFF Next.js (`/api/bff/*`).

## Menjalankan

```bash
cp .env.example .env          # isi DATABASE_URL + JWT_SECRET + JWT_REFRESH_SECRET (min. 32 karakter)
npm install
npm run db:migrate            # prisma migrate deploy + prisma generate
npm run seed                  # akun demo 4 peran + metadata + folder/dokumen contoh (idempoten)
npm run reindex               # (opsional) indeks ulang isi berkas dokumen lama — PDF/DOCX/teks
npm run dev                   # http://localhost:5000
npm run test:api              # 47 cek endpoint terhadap server yang hidup (butuh seed)
```

Akun demo (password `Password123!`): `super@dms.test` (SUPER_ADMIN), `admin@dms.test` (COMPANY_ADMIN),
`auditor@dms.test` (AUDITOR), `karyawan@dms.test` (EMPLOYEE).

**Tanpa PostgreSQL terpasang?** Paket npm [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres)
menjalankan PostgreSQL portabel tanpa install/admin:
`new EmbeddedPostgres({ databaseDir, user: "postgres", password: "password", port: 5432, persistent: true })`.

## Aturan akses (`src/utils/access.ts`)

| Peran | Folder | Dokumen |
|---|---|---|
| SUPER_ADMIN, COMPANY_ADMIN | kelola semua | kelola semua, approve/reject/arsip, Sampah semua user |
| AUDITOR | baca semua | baca semua (read-only), audit log + ekspor CSV |
| EMPLOYEE | miliknya | miliknya, yang dibagikan kepadanya, dan yang berstatus APPROVED |

Share: `VIEWER` lihat saja · `DOWNLOADER` + unduh · `EDITOR` + ubah/versi baru.
Berkas **tidak** disajikan statis — hanya lewat `GET /api/documents/:id/file` (cek izin + audit unduhan).

## Endpoint

Semua respons `{ success, data, pagination? }` (camelCase), kecuali `/api/shares` lama (`{ shares }` / `{ share }`).

| Modul | Endpoint |
|---|---|
| Auth | `POST /auth/register · login · refresh-token · logout`, `GET /auth/me`, `PATCH /auth/me` (ubah nama sendiri), `POST /auth/change-password` (wajib sandi lama; sesi lain dicabut) |
| Folder | `GET /folders` (tree 3 tingkat), `GET /folders/all` (datar, semua tingkat), `POST /folders`, `PATCH /folders/:id/rename · move`, `DELETE /folders/:id` |
| Dokumen | `GET /documents?folderId&status&search&page&limit`, `POST /documents` (multipart `file,title,folderId,description,allowDuplicate`), `GET · PATCH · DELETE /documents/:id`, `PATCH /documents/:id/move · meta · status`, `POST /documents/bulk-meta` |
| Berkas & versi | `GET /documents/:id/file?version=&download=1`, `GET · POST /documents/:id/versions`, `GET /documents/:id/content · history · similar` |
| Sampah | `GET · DELETE /documents/trash`, `POST /documents/:id/restore`, `DELETE /documents/:id/purge` |
| Catatan | `GET · POST /documents/:id/notes`, `DELETE /documents/notes/:noteId` |
| Share | `GET /shares/shared-with-me`, `GET · POST /shares/documents/:id/share`, `PATCH · DELETE /shares/:shareId` |
| Tautan publik | `GET · POST /shares/documents/:id/links`, `DELETE /shares/links/:linkId`, **publik:** `GET /public/share/:token`, `GET /public/share/:token/file` |
| Metadata | `/metadata/tags · document-types · correspondents · custom-fields` (GET, POST, PATCH `/:id`, DELETE `/:id`) |
| Otomatisasi | `GET · POST /workflows`, `PATCH · DELETE /workflows/:id`, `POST /workflows/:id/move` — dievaluasi saat unggah & status berubah (`src/lib/automation.ts`) |
| Pencarian | `GET /search?q=&limit=` — folder + dokumen (judul, deskripsi, ASN, tag, tipe, pihak, **isi berkas**: txt/csv/md/json, PDF berlapis teks, DOCX — diekstrak saat unggah, `src/utils/fileInfo.ts`; PDF hasil scan butuh OCR, belum ada) |
| Statistik | `GET /stats/dashboard?days=7` |
| Pengguna | `GET /users/search?q=` (semua peran), `GET · POST /users`, `GET · PATCH · DELETE /users/:id`, `POST /users/:id/reset-password` |
| Audit | `GET /activity-logs` (admin + auditor), `/activity-logs/me`, `/stats`, `/export` (CSV) |

Unggah berkas identik (SHA-256 sama) → `409 { code: "DUPLICATE_DOCUMENT", data: { existing } }`;
kirim `allowDuplicate=true` untuk tetap mengunggah.
