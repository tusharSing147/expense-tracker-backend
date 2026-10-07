-- Database-level CHECK constraints (BDR section 5.2).
-- Prisma cannot express CHECK constraints, so they live in this hand-edited migration.

ALTER TABLE "Expense" ADD CONSTRAINT expense_amount_positive CHECK (amount > 0);
ALTER TABLE "Budget"  ADD CONSTRAINT budget_limit_positive  CHECK ("limit" > 0);
ALTER TABLE "Budget"  ADD CONSTRAINT budget_month_range     CHECK (month BETWEEN 1 AND 12);
ALTER TABLE "Budget"  ADD CONSTRAINT budget_year_range      CHECK (year BETWEEN 2000 AND 2100);
