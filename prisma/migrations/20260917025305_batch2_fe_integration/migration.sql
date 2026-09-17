-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "original_name" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "content_text" TEXT;

-- CreateTable
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "access" "AccessLevel" NOT NULL DEFAULT 'VIEWER',
    "expires_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL,
    "trigger_status" "DocumentStatus",
    "match_folder_id" TEXT,
    "match_extensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match_title_contains" TEXT NOT NULL DEFAULT '',
    "assign_tag_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assign_type_id" TEXT,
    "assign_correspondent_id" TEXT,
    "assign_status" "DocumentStatus",
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- CreateIndex
CREATE INDEX "share_links_document_id_idx" ON "share_links"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_name_key" ON "custom_fields"("name");

-- CreateIndex
CREATE INDEX "document_versions_checksum_idx" ON "document_versions"("checksum");

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
