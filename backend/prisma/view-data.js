import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const target = String(process.argv[2] || 'all').trim().toLowerCase();

function printSection(title, rows) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (!rows.length) {
    console.log('No rows found.');
    return;
  }

  console.table(rows);
}

async function main() {
  if (target === 'users' || target === 'borrowers') {
    const rows = await prisma.borrower.findMany({
      orderBy: { id: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        walletAddressDb: true,
        walletAddress: true,
        createdAt: true,
      },
    });
    printSection('USERS', rows);
    return;
  }

  if (target === 'loans') {
    const rows = await prisma.loan.findMany({
      orderBy: { id: 'desc' },
      select: {
        id: true,
        borrowerId: true,
        propertyId: true,
        nftId: true,
        contractLoanId: true,
        loanAmount: true,
        interestRate: true,
        durationMonths: true,
        emiAmount: true,
        totalPayable: true,
        amountPaid: true,
        remainingBalance: true,
        status: true,
        txHash: true,
        createdAt: true,
      },
    });
    printSection('LOANS', rows);
    return;
  }

  const [users, properties, loans, investments, payments, emis] = await Promise.all([
    prisma.borrower.findMany({ orderBy: { id: 'desc' } }),
    prisma.property.findMany({ orderBy: { id: 'desc' } }),
    prisma.loan.findMany({ orderBy: { id: 'desc' } }),
    prisma.investment.findMany({ orderBy: { id: 'desc' } }),
    prisma.payment.findMany({ orderBy: { id: 'desc' } }),
    prisma.emi.findMany({ orderBy: [{ loanId: 'desc' }, { emiIndex: 'asc' }] }),
  ]);

  printSection('USERS', users);
  printSection('PROPERTIES', properties);
  printSection('LOANS', loans);
  printSection('INVESTMENTS', investments);
  printSection('PAYMENTS', payments);
  printSection('EMIS', emis);
}

main()
  .catch((error) => {
    console.error('Prisma view failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
