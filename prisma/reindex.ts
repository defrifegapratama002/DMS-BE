/**
 * Indeks ulang isi berkas (contentText) semua dokumen dari versi terkininya.
 * Perlu dijalankan sekali untuk dokumen yang diunggah sebelum ekstraksi PDF/DOCX ada.
 * Jalankan: npm run reindex
 */
import 'dotenv/config';
import { prisma } from '../src/config/prisma.js';
import { extractText } from '../src/utils/fileInfo.js';

async function main() {
  const documents = await prisma.document.findMany({
    select: { id: true, title: true, extension: true, currentVersion: true },
  });

  let indexed = 0;
  for (const doc of documents) {
    const version = await prisma.documentVersion.findUnique({
      where: {
        documentId_versionNumber: { documentId: doc.id, versionNumber: doc.currentVersion },
      },
    });
    if (!version) continue;

    const contentText = await extractText(version.s3FileKey, doc.extension);
    // SQL mentah agar updatedAt (@updatedAt) tidak ikut berubah
    await prisma.$executeRaw`UPDATE documents SET content_text = ${contentText} WHERE id = ${doc.id}`;
    if (contentText) indexed += 1;
  }

  console.log(`Reindex selesai: ${indexed} dari ${documents.length} dokumen punya teks terindeks.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
