// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract MortgageLoan {
    // ──────────────────────────── Types ────────────────────────────
    enum LoanStatus { Pending, Active, Completed, Defaulted, Cancelled }

    struct Loan {
        uint256 id;
        address borrower;
        address lender;
        uint256 nftId;
        address nftContract;
        uint256 loanAmount;       // in wei
        uint256 interestRate;     // basis points (e.g. 1000 = 10%)
        uint256 durationMonths;
        uint256 emiAmount;        // monthly payment in wei
        uint256 totalPayable;     // total = principal + interest
        uint256 amountPaid;
        uint256 remainingBalance;
        uint256 emisPaid;
        uint256 nextDueDate;
        uint256 createdAt;
        LoanStatus status;
    }

    // ──────────────────────────── State ────────────────────────────
    uint256 private _nextLoanId;
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) public borrowerLoans;
    mapping(uint256 => bool) public nftLocked; // NFT ID => is locked in a loan

    // ──────────────────────────── Events ───────────────────────────
    event LoanApplied(uint256 indexed loanId, address indexed borrower, uint256 nftId, uint256 amount);
    event LoanFunded(uint256 indexed loanId, address indexed lender);
    event EMIPaid(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 emisPaid);
    event LoanCompleted(uint256 indexed loanId, address indexed borrower);
    event LoanDefaulted(uint256 indexed loanId, address indexed borrower, address indexed lender);
    event LoanCancelled(uint256 indexed loanId, address indexed borrower);

    constructor() {
        _nextLoanId = 1;
    }

    // ──────────────────────────── Core Functions ──────────────────────
    
    /// @notice Borrower applies for a loan using their property NFT as collateral
    /// @param nftContract Address of the PropertyNFT contract
    /// @param nftId Token ID of the property NFT
    /// @param loanAmount Desired loan amount in wei
    /// @param interestRate Annual interest rate in basis points (1000 = 10%)
    /// @param durationMonths Loan duration in months
    function applyLoan(
        address nftContract,
        uint256 nftId,
        uint256 loanAmount,
        uint256 interestRate,
        uint256 durationMonths
    ) external returns (uint256) {
        require(loanAmount > 0, "Loan amount must be > 0");
        require(durationMonths > 0, "Duration must be > 0");
        require(!nftLocked[nftId], "NFT already used as collateral");
        
        // Verify borrower owns the NFT
        IERC721 nft = IERC721(nftContract);
        require(nft.ownerOf(nftId) == msg.sender, "You don't own this NFT");

        // Transfer NFT to this contract as collateral
        nft.transferFrom(msg.sender, address(this), nftId);
        nftLocked[nftId] = true;

        // Calculate EMI and total payable
        // Simple interest: total = principal + (principal * rate * years) / 10000
        uint256 totalInterest = (loanAmount * interestRate * durationMonths) / (12 * 10000);
        uint256 totalPayable = loanAmount + totalInterest;
        uint256 emiAmount = totalPayable / durationMonths;

        uint256 loanId = _nextLoanId++;
        loans[loanId] = Loan({
            id: loanId,
            borrower: msg.sender,
            lender: address(0),
            nftId: nftId,
            nftContract: nftContract,
            loanAmount: loanAmount,
            interestRate: interestRate,
            durationMonths: durationMonths,
            emiAmount: emiAmount,
            totalPayable: totalPayable,
            amountPaid: 0,
            remainingBalance: totalPayable,
            emisPaid: 0,
            nextDueDate: 0,
            createdAt: block.timestamp,
            status: LoanStatus.Pending
        });

        borrowerLoans[msg.sender].push(loanId);
        
        emit LoanApplied(loanId, msg.sender, nftId, loanAmount);
        return loanId;
    }

    /// @notice Lender funds a pending loan (stub for lender side)
    /// @param loanId The loan to fund
    function fundLoan(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Pending, "Loan not pending");
        require(msg.value >= loan.loanAmount, "Insufficient funds");

        loan.lender = msg.sender;
        loan.status = LoanStatus.Active;
        loan.nextDueDate = block.timestamp + 30 days;

        // Send loan amount to borrower
        payable(loan.borrower).transfer(loan.loanAmount);

        // Refund excess
        if (msg.value > loan.loanAmount) {
            payable(msg.sender).transfer(msg.value - loan.loanAmount);
        }

        emit LoanFunded(loanId, msg.sender);
    }

    /// @notice Borrower pays one EMI
    /// @param loanId The loan to pay EMI for
    function payEMI(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "Loan not active");
        require(msg.sender == loan.borrower, "Not the borrower");
        require(msg.value >= loan.emiAmount, "Insufficient EMI amount");

        loan.amountPaid += msg.value;
        loan.remainingBalance = loan.totalPayable > loan.amountPaid 
            ? loan.totalPayable - loan.amountPaid 
            : 0;
        loan.emisPaid += 1;
        loan.nextDueDate = block.timestamp + 30 days;

        // Send EMI to lender
        payable(loan.lender).transfer(msg.value);

        emit EMIPaid(loanId, msg.sender, msg.value, loan.emisPaid);

        // Check if loan is fully paid
        if (loan.remainingBalance == 0 || loan.emisPaid >= loan.durationMonths) {
            _completeLoan(loanId);
        }
    }

    /// @notice Borrower cancels an unfunded loan and receives the collateral back
    /// @param loanId The pending loan to cancel
    function cancelPendingLoan(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Pending, "Loan not pending");
        require(msg.sender == loan.borrower, "Not the borrower");

        loan.status = LoanStatus.Cancelled;
        loan.remainingBalance = 0;
        nftLocked[loan.nftId] = false;

        IERC721(loan.nftContract).transferFrom(address(this), loan.borrower, loan.nftId);

        emit LoanCancelled(loanId, loan.borrower);
    }

    /// @notice View loan details
    function viewLoanDetails(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    /// @notice Get all loan IDs for a borrower
    function getBorrowerLoans(address borrower) external view returns (uint256[] memory) {
        return borrowerLoans[borrower];
    }

    /// @notice Check if a loan is overdue (grace period: 7 days)
    function isOverdue(uint256 loanId) external view returns (bool) {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) return false;
        return block.timestamp > loan.nextDueDate + 7 days;
    }

    /// @notice Trigger default on an overdue loan (can be called by lender)
    function triggerDefault(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "Loan not active");
        require(block.timestamp > loan.nextDueDate + 7 days, "Not yet defaulted");

        loan.status = LoanStatus.Defaulted;
        nftLocked[loan.nftId] = false;

        // Transfer NFT to lender
        IERC721(loan.nftContract).transferFrom(address(this), loan.lender, loan.nftId);

        emit LoanDefaulted(loanId, loan.borrower, loan.lender);
    }

    // ──────────────────────────── Internal ─────────────────────────
    
    function _completeLoan(uint256 loanId) internal {
        Loan storage loan = loans[loanId];
        loan.status = LoanStatus.Completed;
        loan.remainingBalance = 0;
        nftLocked[loan.nftId] = false;

        // Return NFT to borrower
        IERC721(loan.nftContract).transferFrom(address(this), loan.borrower, loan.nftId);

        emit LoanCompleted(loanId, loan.borrower);
    }

    /// @notice Get the next loan ID
    function getNextLoanId() external view returns (uint256) {
        return _nextLoanId;
    }
}
