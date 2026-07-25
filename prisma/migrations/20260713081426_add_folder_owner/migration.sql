/*
  Warnings:

  - Added the required column `owner_id` to the `Folder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "owner_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Folder_owner_id_idx" ON "Folder"("owner_id");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
