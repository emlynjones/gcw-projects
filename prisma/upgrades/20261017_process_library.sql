-- CreateTable
CREATE TABLE "WorkType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ProcessTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "editVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProcessRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "changeSummary" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessRevision_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProcessTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProcessRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    CONSTRAINT "ProcessItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProcessTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessItemRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "completionCriteria" TEXT NOT NULL DEFAULT '',
    "sopUrl" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "estimatedHours" REAL,
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProcessItemRevision_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProcessRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProcessItemRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ProcessItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessItemDependency" (
    "itemRevisionId" TEXT NOT NULL,
    "prerequisiteId" TEXT NOT NULL,

    PRIMARY KEY ("itemRevisionId", "prerequisiteId"),
    CONSTRAINT "ProcessItemDependency_itemRevisionId_fkey" FOREIGN KEY ("itemRevisionId") REFERENCES "ProcessItemRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProcessItemDependency_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "ProcessItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "projectType" TEXT,
    "stage" TEXT,
    "workTypeId" TEXT,
    CONSTRAINT "ProcessRule_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProcessRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProcessRule_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "WorkType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "occurrence" TEXT NOT NULL DEFAULT 'primary',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProcessApplication_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProcessTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProcessApplication_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProcessRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppliedProcessItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "taskId" TEXT,
    "baseline" JSONB NOT NULL,
    CONSTRAINT "AppliedProcessItem_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProcessApplication" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppliedProcessItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ProcessItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AppliedProcessItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessDismissal" (
    "projectId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "templateId"),
    CONSTRAINT "ProcessDismissal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProcessDismissal_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProcessTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "decisions" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessChange_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProcessApplication" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProcessChange_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProcessRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProcessChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Add nullable classification without rebuilding Project or touching existing rows.
ALTER TABLE "Project" ADD COLUMN "workTypeId" TEXT REFERENCES "WorkType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Project_workTypeId_idx" ON "Project"("workTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkType_name_key" ON "WorkType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessRevision_templateId_number_key" ON "ProcessRevision"("templateId", "number");

-- CreateIndex
CREATE INDEX "ProcessItem_templateId_idx" ON "ProcessItem"("templateId");

-- CreateIndex
CREATE INDEX "ProcessItemRevision_itemId_idx" ON "ProcessItemRevision"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessItemRevision_revisionId_itemId_key" ON "ProcessItemRevision"("revisionId", "itemId");

-- CreateIndex
CREATE INDEX "ProcessRule_revisionId_idx" ON "ProcessRule"("revisionId");

-- CreateIndex
CREATE INDEX "ProcessRule_workTypeId_idx" ON "ProcessRule"("workTypeId");

-- CreateIndex
CREATE INDEX "ProcessApplication_templateId_idx" ON "ProcessApplication"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessApplication_projectId_templateId_occurrence_key" ON "ProcessApplication"("projectId", "templateId", "occurrence");

-- CreateIndex
CREATE UNIQUE INDEX "AppliedProcessItem_taskId_key" ON "AppliedProcessItem"("taskId");

-- CreateIndex
CREATE INDEX "AppliedProcessItem_itemId_idx" ON "AppliedProcessItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "AppliedProcessItem_applicationId_itemId_key" ON "AppliedProcessItem"("applicationId", "itemId");

-- CreateIndex
CREATE INDEX "ProcessChange_applicationId_createdAt_idx" ON "ProcessChange"("applicationId", "createdAt");
