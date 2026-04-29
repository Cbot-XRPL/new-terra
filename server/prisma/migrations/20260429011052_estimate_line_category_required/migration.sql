/*
  Warnings:

  - Made the column `category` on table `EstimateLine` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "EstimateLine" ALTER COLUMN "category" SET NOT NULL,
ALTER COLUMN "category" SET DEFAULT 'Custom';
