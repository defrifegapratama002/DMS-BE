/**
 * Data awal development: akun demo per peran + metadata + folder & dokumen contoh.
 * Idempoten — aman dijalankan berulang.   Jalankan: npm run seed
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/config/prisma.js';

export const DEMO_PASSWORD = 'Password123!';

const USERS = [
  { email: 'super@dms.test', name: 'Raka Superadmin', role: 'SUPER_ADMIN' },
  { email: 'admin@dms.test', name: 'Bunga Admin', role: 'COMPANY_ADMIN' },
  { email: 'auditor@dms.test', name: 'Dodi Auditor', role: 'AUDITOR' },
  { email: 'karyawan@dms.test', name: 'Andi Karyawan', role: 'EMPLOYEE' },
] as const;

const TAGS = [
  { name: 'Penting', color: '#dc2626' },
  { name: 'Keuangan', color: '#16a34a' },
  { name: 'Kontrak', color: '#2563eb' },
  { name: 'Rahasia', color: '#7c3aed' },
  { name: '2025', color: '#64748b' },
  { name: 'Baru', color: '#ea580c' },
];
const TYPES = ['Laporan', 'Kontrak', 'Surat', 'Anggaran'];
const CORRESPONDENTS = ['PT Mitra Sejahtera', 'Bank Nusantara', 'Kantor Pajak Pratama'];
const FIELDS = [
  { name: 'Nilai kontrak', type: 'money', options: [] as string[] },
  { name: 'Berlaku hingga', type: 'date', options: [] },
  { name: 'Departemen', type: 'select', options: ['Keuangan', 'Legal', 'SDM', 'Operasional'] },
  { name: 'Dokumen rahasia', type: 'boolean', options: [] },
];

const SAMPLE_DOCS = [
  {
    folder: 'Keuangan',
    title: 'Laporan Keuangan Q1 2025',
    file: 'laporan-keuangan-q1-2025.md',
    tags: ['Keuangan', '2025'],
    type: 'Laporan',
    correspondent: 'Bank Nusantara',
    status: 'APPROVED',
    body: '# Laporan Keuangan Q1 2025\n\nPendapatan naik 12% dibanding kuartal sebelumnya.\nBeban operasional stabil. Arus kas positif.\n',
  },
  {
    folder: 'Keuangan',
    title: 'Rencana Anggaran 2025',
    file: 'rencana-anggaran-2025.csv',
    tags: ['Keuangan', 'Penting'],
    type: 'Anggaran',
    correspondent: null,
    status: 'PENDING_REVIEW',
    body: 'pos,anggaran,realisasi\nOperasional,500000000,120000000\nPemasaran,200000000,45000000\nSDM,350000000,90000000\n',
  },
  {
    folder: 'Legal',
    title: 'Kontrak Kerja Sama PT Mitra Sejahtera',
    file: 'kontrak-mitra-sejahtera.txt',
    tags: ['Kontrak', 'Rahasia'],
    type: 'Kontrak',
    correspondent: 'PT Mitra Sejahtera',
    status: 'DRAFT',
    body: 'PERJANJIAN KERJA SAMA\n\nPihak pertama dan PT Mitra Sejahtera sepakat bekerja sama selama 24 bulan.\nNilai kontrak Rp 1.250.000.000.\n',
  },
] as const;

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, active: true },
      create: { ...u, passwordHash },
    });
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@dms.test' } });

  for (const t of TAGS)
    await prisma.tag.upsert({ where: { name: t.name }, update: {}, create: t });
  for (const name of TYPES)
    await prisma.documentType.upsert({ where: { name }, update: {}, create: { name } });
  for (const name of CORRESPONDENTS)
    await prisma.correspondent.upsert({ where: { name }, update: {}, create: { name } });
  for (const f of FIELDS)
    await prisma.customField.upsert({ where: { name: f.name }, update: {}, create: f });

  if ((await prisma.workflowRule.count()) === 0) {
    const baru = await prisma.tag.findUniqueOrThrow({ where: { name: 'Baru' } });
    await prisma.workflowRule.create({
      data: {
        name: 'Tandai unggahan baru',
        trigger: 'upload',
        assignTagIds: [baru.id],
        sortOrder: 0,
      },
    });
  }

  // Folder & dokumen contoh (milik Bunga Admin) — hanya bila belum ada folder sama sekali.
  if ((await prisma.folder.count()) === 0) {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    fs.mkdirSync(uploadDir, { recursive: true });

    const folders = new Map<string, string>();
    for (const name of ['Keuangan', 'Legal', 'SDM']) {
      const folder = await prisma.folder.create({ data: { name, ownerId: admin.id } });
      folders.set(name, folder.id);
    }
    await prisma.folder.create({
      data: { name: 'Laporan Tahunan', ownerId: admin.id, parentFolderId: folders.get('Keuangan')! },
    });

    for (const d of SAMPLE_DOCS) {
      const filePath = path.join(uploadDir, `seed-${d.file}`);
      fs.writeFileSync(filePath, d.body, 'utf8');
      const size = fs.statSync(filePath).size;
      const extension = path.extname(d.file).slice(1);
      const tags = await prisma.tag.findMany({ where: { name: { in: [...d.tags] } } });
      const type = await prisma.documentType.findUnique({ where: { name: d.type } });
      const correspondent = d.correspondent
        ? await prisma.correspondent.findUnique({ where: { name: d.correspondent } })
        : null;

      await prisma.document.create({
        data: {
          title: d.title,
          description: '',
          extension,
          sizeBytes: BigInt(size),
          folderId: folders.get(d.folder)!,
          uploadedBy: admin.id,
          status: d.status,
          documentDate: new Date(),
          documentTypeId: type?.id ?? null,
          correspondentId: correspondent?.id ?? null,
          contentText: d.body,
          documentTags: { create: tags.map((t) => ({ tagId: t.id })) },
          versions: {
            create: {
              versionNumber: 1,
              s3FileKey: filePath,
              fileSize: BigInt(size),
              mimeType: 'text/plain',
              checksum: crypto.createHash('sha256').update(d.body).digest('hex'),
              originalName: d.file,
              uploadedBy: admin.id,
              changelog: 'Initial upload',
            },
          },
        },
      });
    }
  }

  console.log('Seed selesai. Akun demo (password sama untuk semua):', DEMO_PASSWORD);
  for (const u of USERS) console.log(`  ${u.role.padEnd(14)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
