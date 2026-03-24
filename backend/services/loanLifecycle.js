import db from '../db/database.js';

function roundAmount(value) {
  return Math.round(Number(value || 0) * 1000000) / 1000000;
}

function toIsoDate(date) {
  return date.toISOString();
}

function addDays(date, days) {
  return new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
}

function buildEmiSchedule(loan, firstDueDate = new Date()) {
  const durationMonths = Number(loan.duration_months || 0);
  const totalPayable = Number(loan.total_payable || 0);
  if (!durationMonths || !totalPayable) {
    return [];
  }

  const baseEmiAmount = roundAmount(totalPayable / durationMonths);
  let remaining = roundAmount(totalPayable);

  return Array.from({ length: durationMonths }, (_, index) => {
    const amount = index === durationMonths - 1 ? roundAmount(remaining) : baseEmiAmount;
    remaining = roundAmount(remaining - amount);

    return {
      loanId: loan.id,
      emiIndex: index,
      amount,
      dueDate: toIsoDate(addDays(firstDueDate, 30 * (index + 1))),
      paid: 0,
      status: 'pending',
    };
  });
}

export async function ensureEmiScheduleForLoan(loanId, firstDueDate = new Date()) {
  const loan = await db.prepare(`
    SELECT *
    FROM loans
    WHERE id = ?
  `).get(loanId);

  if (!loan) {
    throw new Error('Loan not found');
  }

  const existingSchedule = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM emis
    WHERE loan_id = ?
  `).get(loanId);

  if ((existingSchedule?.count || 0) > 0) {
    return getEmiSchedule(loanId);
  }

  const schedule = buildEmiSchedule(loan, firstDueDate);
  for (const emi of schedule) {
    await db.prepare(`
      INSERT OR IGNORE INTO emis (
        loan_id,
        emi_index,
        amount,
        due_date,
        paid,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      emi.loanId,
      emi.emiIndex,
      emi.amount,
      emi.dueDate,
      emi.paid,
      emi.status
    );
  }

  return getEmiSchedule(loanId);
}

export async function getEmiSchedule(loanId) {
  return db.prepare(`
    SELECT
      id,
      loan_id,
      emi_index,
      amount,
      due_date,
      paid,
      paid_at,
      tx_hash,
      status,
      created_at
    FROM emis
    WHERE loan_id = ?
    ORDER BY emi_index ASC
  `).all(loanId);
}

export async function markNextEmiPaid(loanId, txHash, paidAt = new Date()) {
  const emi = await db.prepare(`
    SELECT *
    FROM emis
    WHERE loan_id = ?
      AND paid = 0
    ORDER BY emi_index ASC
    LIMIT 1
  `).get(loanId);

  if (!emi) {
    return null;
  }

  const paidAtIso = toIsoDate(paidAt);
  await db.prepare(`
    UPDATE emis
    SET paid = 1,
        paid_at = ?,
        tx_hash = ?,
        status = 'paid'
    WHERE id = ?
  `).run(paidAtIso, txHash, emi.id);

  return {
    ...emi,
    paid: 1,
    paid_at: paidAtIso,
    tx_hash: txHash,
    status: 'paid',
  };
}

export async function getLoanStatusSummary(loanId, borrowerId = null) {
  const params = borrowerId ? [loanId, borrowerId] : [loanId];
  const whereClause = borrowerId ? 'WHERE l.id = ? AND l.borrower_id = ?' : 'WHERE l.id = ?';

  const loan = await db.prepare(`
    SELECT
      l.*,
      b.name AS borrower_name,
      b.email AS borrower_email,
      p.name AS property_name
    FROM loans l
    LEFT JOIN borrowers b ON l.borrower_id = b.id
    LEFT JOIN properties p ON l.property_id = p.id
    ${whereClause}
  `).get(...params);

  if (!loan) {
    return null;
  }

  const emis = await getEmiSchedule(loanId);
  const totalEmis = emis.length;
  const paidEmis = emis.filter((emi) => Number(emi.paid) === 1).length;
  const nextEmi = emis.find((emi) => Number(emi.paid) === 0) || null;
  const isDefaulted = Boolean(
    nextEmi &&
    new Date(nextEmi.due_date).getTime() + (7 * 24 * 60 * 60 * 1000) < Date.now() &&
    loan.status === 'Active'
  );

  return {
    loanId: loan.id,
    status: isDefaulted ? 'Defaulted' : loan.status,
    borrowerName: loan.borrower_name,
    borrowerEmail: loan.borrower_email,
    propertyName: loan.property_name,
    totalEmis,
    paidEmis,
    pendingEmis: totalEmis - paidEmis,
    nextEmi,
    amountPaid: Number(loan.amount_paid || 0),
    remainingBalance: Number(loan.remaining_balance || 0),
    fundedAt: loan.funded_at,
    completedAt: loan.completed_at,
    defaultedAt: loan.defaulted_at,
    verificationStatus: loan.verification_status || 'pending',
  };
}
